// Assistant router: bounded tool loop (OpenAI-compatible function calling) with a JSON-intent
// fallback for providers without tools, and a deterministic keyword mode when no model is available.
//
// Guarantees:
//   • a booking/time/money question gets server data BEFORE the model writes an answer
//     (deterministic prefetch + tool_choice="required" on the first call when nothing was prefetched);
//   • the model never chooses tenant or SQL: tools are fixed RPCs scoped by the request;
//   • owner tools are not offered to a client conversation and are refused if requested anyway;
//   • at most MAX_ITERATIONS model calls per message.
import { z } from 'zod';
import { hoursText, plural, servicesText, slotsText, statsText } from './format.ts';
import { detectIntent } from './keyword.ts';
import { jsonRouterPrompt, systemPrompt } from './prompts.ts';
import { executeTool, openAiTools, resolveService, type ToolContext } from './tools.ts';
import type { AssistantBackend, AssistantReply, OwnerStats, Scope, TenantInfo, ToolCallRecord, ToolResult } from './types.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ChatCompletionLike {
  choices: { message: { role: string; content: string | null; tool_calls?: ChatMessage['tool_calls'] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** The subset of the OpenAI SDK the router needs (lets tests inject a scripted model). */
export interface ChatClient {
  chat: { completions: { create(params: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<ChatCompletionLike> } };
}

export interface RunOptions {
  scope: Scope;
  tenant: TenantInfo;
  backend: AssistantBackend;
  history: { role: 'user' | 'assistant'; content: string }[];
  llm: ChatClient | null;
  model: string;
  mode?: 'auto' | 'tools' | 'json';
  maxIterations?: number;
  timeoutMs?: number;
}

export const MAX_ITERATIONS = 4;
const RESULT_LIMIT = 6000;

function clip(s: string) {
  return s.length > RESULT_LIMIT ? `${s.slice(0, RESULT_LIMIT)}…(обрезано)` : s;
}

export function isToolsUnsupported(e: unknown): boolean {
  const err = e as { status?: number; message?: string; error?: { message?: string } };
  const msg = `${err?.message ?? ''} ${err?.error?.message ?? ''}`;
  return [400, 404, 422, 501].includes(err?.status ?? 0) && /tool|function/i.test(msg);
}

/** Deterministic text answer from a tool result (keyword mode / AI unavailable). */
export function templateAnswer(tenant: TenantInfo, scope: Scope, name: string | undefined, r: ToolResult | undefined): string {
  if (!name || !r) {
    return scope === 'owner'
      ? 'Могу подсказать записи на день или неделю и статистику: спросите «Что у меня завтра?» или «Сколько денег получено на неделе?».'
      : `Подскажу цены, свободное время и как нас найти. Например: «Когда ближайшее окно?» или «Сколько стоит ${tenant.services[0]?.name.toLowerCase() ?? 'услуга'}?». Телефон: ${tenant.phone}.`;
  }
  if (!r.ok) return `Не получилось получить данные. Позвоните в студию: ${tenant.phone}.`;
  const d = r.data as Record<string, unknown>;
  switch (name) {
    case 'studio_info':
      return `${tenant.name}: ${tenant.address}. Телефон ${tenant.phone}. Часы работы: ${hoursText(tenant)}.${tenant.cancellation_policy ? ` ${tenant.cancellation_policy}` : ''}`;
    case 'list_services': {
      const names = new Set(((d.services as { name: string }[]) ?? []).map((s) => s.name));
      return `Услуги и цены:\n${servicesText(tenant, tenant.services.filter((s) => names.has(s.name)))}`;
    }
    case 'find_free_slots': {
      if (d.nearest_by_service) {
        const rows = (d.nearest_by_service as { service: string; nearest: string | null }[]).map(
          (x) => `• ${x.service}: ${x.nearest ?? 'нет свободного времени'}`,
        );
        return `Ближайшее свободное время:\n${rows.join('\n')}\nВыберите услугу, и я покажу больше вариантов.`;
      }
      const svc = resolveService(tenant, d.service as string).service;
      const free = (d.free as { starts_at: string }[]) ?? [];
      return svc
        ? slotsText(tenant, svc, free.map((f) => ({ starts_at: f.starts_at, local_day: '', local_time: '' })))
        : 'Уточните, пожалуйста, услугу.';
    }
    case 'owner_bookings': {
      const label = String(d.label ?? '');
      const list = ((d.bookings as Record<string, unknown>[]) ?? []).filter((b) => b.status !== 'cancelled');
      if (list.length === 0) return `${label}: записей нет.`;
      return (
        `${label}: ${list.length} ${plural(list.length, 'запись', 'записи', 'записей')}.\n` +
        list.map((b) => `• ${b.starts} — ${b.service}, ${b.client} (${b.car}), ${b.resource}`).join('\n')
      );
    }
    case 'owner_stats':
      return statsText(d as unknown as OwnerStats);
    default:
      return 'Готово.';
  }
}

export async function runAssistant(o: RunOptions): Promise<AssistantReply> {
  const ctx: ToolContext = { scope: o.scope, backend: o.backend, tenant: o.tenant, slots: [] };
  const tools: ToolCallRecord[] = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  const lastUser = [...o.history].reverse().find((m) => m.role === 'user')?.content ?? '';

  // 1) Deterministic prefetch: if the question is about time/bookings/prices/money, fetch the data first.
  const intent = detectIntent(lastUser, o.scope, o.tenant);
  let prefetched: { name: string; args: Record<string, unknown>; result: ToolResult } | null = null;
  if (intent) {
    const result = await executeTool(intent.tool, intent.args, ctx);
    tools.push({ name: intent.tool, args: intent.args, ok: result.ok, source: 'prefetch' });
    prefetched = { name: intent.tool, args: intent.args, result };
  }

  const keyword = (degraded: boolean): AssistantReply => ({
    reply: templateAnswer(o.tenant, o.scope, prefetched?.name, prefetched?.result),
    router: 'keyword',
    degraded,
    tools,
    slots: ctx.slots,
    usage,
  });

  if (!o.llm) return keyword(true);

  const call = async (params: Record<string, unknown>) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), o.timeoutMs ?? 20000);
    try {
      const res = await o.llm!.chat.completions.create({ model: o.model, ...params }, { signal: ac.signal });
      usage.prompt_tokens += res.usage?.prompt_tokens ?? 0;
      usage.completion_tokens += res.usage?.completion_tokens ?? 0;
      return res;
    } finally {
      clearTimeout(timer);
    }
  };

  const history: ChatMessage[] = o.history.map((m) => ({ role: m.role, content: m.content }));
  const mode = o.mode ?? 'auto';

  // 2a) Tool loop
  const toolLoop = async (): Promise<AssistantReply> => {
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt(o.scope, o.tenant) }, ...history];
    let calls = 0;
    if (prefetched) {
      messages.push(
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'prefetch_1', type: 'function', function: { name: prefetched.name, arguments: JSON.stringify(prefetched.args) } }],
        },
        { role: 'tool', tool_call_id: 'prefetch_1', content: clip(JSON.stringify(prefetched.result)) },
      );
      calls = 1;
    }
    const toolDefs = openAiTools(o.scope);
    const max = o.maxIterations ?? MAX_ITERATIONS;
    for (let i = 0; i < max; i++) {
      const last = i === max - 1;
      const res = await call({
        messages,
        tools: toolDefs,
        tool_choice: last ? 'none' : calls === 0 ? 'required' : 'auto',
        temperature: 0.2,
        max_tokens: 700,
      });
      const msg = res.choices[0]?.message;
      if (!msg) throw new Error('empty completion');
      if (msg.tool_calls?.length && !last) {
        messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
        for (const tc of msg.tool_calls.slice(0, 4)) {
          const r = await executeTool(tc.function.name, tc.function.arguments, ctx);
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            /* recorded as-is */
          }
          tools.push({ name: tc.function.name, args, ok: r.ok, source: 'model' });
          messages.push({ role: 'tool', tool_call_id: tc.id, content: clip(JSON.stringify(r)) });
          calls++;
        }
        continue;
      }
      const text = (msg.content ?? '').trim();
      if (calls === 0) {
        // The model ignored tool_choice=required: answer from server data instead of trusting it.
        return keyword(false);
      }
      if (text) return { reply: text, router: 'tools', degraded: false, tools, slots: ctx.slots, usage };
    }
    return keyword(false);
  };

  // 2b) JSON-intent fallback (providers without function calling)
  const jsonRoute = async (): Promise<AssistantReply> => {
    let chosen = prefetched;
    const r1 = await call({
      messages: [{ role: 'system', content: jsonRouterPrompt(o.scope, o.tenant) }, ...history],
      temperature: 0,
      max_tokens: 200,
    });
    const content = r1.choices[0]?.message?.content ?? '';
    const match = /\{[\s\S]*\}/.exec(content);
    const schema = z.object({ intent: z.string(), args: z.record(z.string(), z.unknown()).optional() });
    let parsed: z.infer<typeof schema> | null = null;
    try {
      parsed = match ? schema.parse(JSON.parse(match[0])) : null;
    } catch {
      parsed = null;
    }
    if (parsed && parsed.intent !== 'none' && parsed.intent !== prefetched?.name) {
      const args = parsed.args ?? {};
      const result = await executeTool(parsed.intent, args, ctx);
      tools.push({ name: parsed.intent, args, ok: result.ok, source: 'json' });
      if (result.ok || !chosen) chosen = { name: parsed.intent, args, result };
    }
    const data = chosen ? `Инструмент ${chosen.name}, результат: ${clip(JSON.stringify(chosen.result))}` : 'Инструменты не вызывались: данных нет.';
    const r2 = await call({
      messages: [
        { role: 'system', content: systemPrompt(o.scope, o.tenant) },
        ...history,
        { role: 'system', content: `Данные с сервера (используй только их): ${data}` },
      ],
      temperature: 0.2,
      max_tokens: 600,
    });
    const text = (r2.choices[0]?.message?.content ?? '').trim();
    if (!text) return keyword(false);
    return { reply: text, router: 'json', degraded: false, tools, slots: ctx.slots, usage };
  };

  try {
    if (mode === 'json') return await jsonRoute();
    try {
      return await toolLoop();
    } catch (e) {
      if (mode === 'tools' || !isToolsUnsupported(e)) throw e;
      return await jsonRoute();
    }
  } catch {
    // Model unreachable, timed out or failed: still answer from server data.
    return keyword(true);
  }
}
