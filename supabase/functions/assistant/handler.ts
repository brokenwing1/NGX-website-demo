// POST /functions/v1/assistant
// { slug, scope: "client" | "owner", messages: [{ role: "user"|"assistant", content }] }
// Client scope needs only the anon key. Owner scope needs the owner's session (Authorization: Bearer <jwt>);
// membership in the studio is confirmed on the server before any owner tool can run.
import OpenAI from 'openai';
import { z } from 'zod';
import { sqlBackend } from '../_shared/assistant/backend-sql.ts';
import { runAssistant, type ChatClient } from '../_shared/assistant/router.ts';
import { requireUser } from '../_shared/auth.ts';
import { asServer, asUser } from '../_shared/db.ts';
import { getEnv, intEnv } from '../_shared/env.ts';
import { clientIp, corsHeaders, HttpError, json, pgBusinessError } from '../_shared/http.ts';

const bodySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
  scope: z.enum(['client', 'owner']).default('client'),
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(1000) }))
    .min(1)
    .max(16),
});

let llmClient: ChatClient | null | undefined;
function llm(): ChatClient | null {
  if (llmClient !== undefined) return llmClient;
  const apiKey = getEnv('LLM_API_KEY');
  llmClient = apiKey
    ? (new OpenAI({ apiKey, baseURL: getEnv('LLM_BASE_URL') ?? 'https://api.openai.com/v1', maxRetries: 1 }) as unknown as ChatClient)
    : null;
  return llmClient;
}

/** Inject a model client (tests / local gateway). */
export function setLlmClient(c: ChatClient | null) {
  llmClient = c;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, 'invalid_request', 'Неверный запрос');
    const { slug, scope } = parsed.data;
    const history = parsed.data.messages.slice(-12);
    const ip = clientIp(req);

    let userId: string | undefined;
    if (scope === 'owner') {
      const user = await requireUser(req);
      // Membership is confirmed by the database for this user, not taken from the request.
      const studios = await asUser(user.id, ip, (tx) => tx<{ slug: string }[]>`
        select x ->> 'slug' as slug from jsonb_array_elements(public.owner_me()) x`);
      if (!studios.some((s) => s.slug === slug)) throw new HttpError(403, 'forbidden', 'Нет доступа к этой студии');
      userId = user.id;
    }

    const backend = sqlBackend({ slug, ip, userId });
    const tenant = await backend.tenant();

    // Shared atomic limits: per client IP and per studio.
    const limited = await asServer(async (tx) => {
      const [a] = await tx<{ ok: boolean }[]>`select app.hit_rate_limit(${`ai:ip:${ip}`}, ${intEnv('AI_RATE_PER_IP_10MIN', 20)}, 600) as ok`;
      const [b] = await tx<{ ok: boolean }[]>`select app.hit_rate_limit(${`ai:tenant:${tenant.id}`}, ${intEnv('AI_RATE_PER_TENANT_HOUR', 300)}, 3600) as ok`;
      return !(a!.ok && b!.ok);
    });
    if (limited) throw new HttpError(429, 'rate_limited', 'Слишком много вопросов подряд. Попробуйте через пару минут.');

    // Budget: reserve an estimate before calling the model, settle with real usage afterwards.
    const estimate = 1500 + history.reduce((n, m) => n + Math.ceil(m.content.length / 2), 0);
    let client = llm();
    let reserved = false;
    if (client) {
      reserved = await asServer(async (tx) => {
        const [r] = await tx<{ ok: boolean }[]>`
          select app.reserve_llm_budget(${tenant.id}, ${estimate},
                   ${intEnv('LLM_DAILY_TOKENS_PER_TENANT', 200000)}, ${intEnv('LLM_DAILY_TOKENS_GLOBAL', 2000000)}) as ok`;
        return r!.ok;
      });
      if (!reserved) client = null; // over budget: answer from server data without the model
    }

    const reply = await runAssistant({
      scope,
      tenant,
      backend,
      history,
      llm: client,
      model: getEnv('LLM_MODEL') ?? 'gpt-4o-mini',
      mode: (getEnv('LLM_TOOL_MODE') as 'auto' | 'tools' | 'json' | undefined) ?? 'auto',
      timeoutMs: intEnv('LLM_TIMEOUT_MS', 20000),
    });

    if (reserved) {
      const used = reply.usage.prompt_tokens + reply.usage.completion_tokens;
      await asServer((tx) => tx`select app.settle_llm_budget(${tenant.id}, ${used - estimate})`);
    }

    return json({
      reply: reply.reply,
      router: reply.router,
      degraded: reply.degraded,
      ai_available: !!llm(),
      budget_exhausted: !!llm() && !reserved,
      tools: reply.tools.map((t) => ({ name: t.name, ok: t.ok, source: t.source })),
      slots: scope === 'client' ? reply.slots : [],
    });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
    const biz = pgBusinessError(e);
    if (biz) return json({ error: biz.code, message: biz.message }, biz.code === 'tenant_not_found' ? 404 : 400);
    console.error('assistant error', e);
    return json({ error: 'internal', message: 'Помощник временно недоступен. Запись работает как обычно.' }, 500);
  }
}
