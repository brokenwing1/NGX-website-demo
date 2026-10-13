// Assistant tools. Each tool declares its scope; owner tools are never offered to or executed for
// a client conversation. Arguments are validated with zod; tenant and SQL are never chosen by the model.
import { z } from 'zod';
import { normalize, slotLabel } from './format.ts';
import type { AssistantBackend, Scope, ServiceInfo, SlotSuggestion, TenantInfo, ToolResult } from './types.ts';

export const OWNER_PERIODS = [
  'today',
  'tomorrow',
  'yesterday',
  'this_week',
  'next_week',
  'last_week',
  'this_month',
  'last_month',
  'last_7_days',
  'last_30_days',
] as const;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface ToolContext {
  scope: Scope;
  backend: AssistantBackend;
  tenant: TenantInfo;
  /** slots found during this turn, surfaced to the UI as booking buttons */
  slots: SlotSuggestion[];
}

interface ToolDef<A extends z.ZodTypeAny> {
  name: string;
  scope: Scope[];
  description: string;
  args: A;
  parameters: Record<string, unknown>;
  run: (args: z.infer<A>, ctx: ToolContext) => Promise<unknown>;
}

function def<A extends z.ZodTypeAny>(d: ToolDef<A>) {
  return d;
}

export function localToday(tz: string, offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function resolveDay(input: string | undefined, tz: string): string | undefined {
  if (!input) return undefined;
  const v = normalize(input);
  if (ISO_DAY.test(input)) return input;
  if (v === 'today' || v === 'сегодня') return localToday(tz);
  if (v === 'tomorrow' || v === 'завтра') return localToday(tz, 1);
  if (v === 'послезавтра' || v === 'day after tomorrow') return localToday(tz, 2);
  return undefined;
}

/** Match a service by id, key or (fuzzy) name. Returns candidates when ambiguous. */
export function resolveService(tenant: TenantInfo, query: string | undefined): { service?: ServiceInfo; candidates: ServiceInfo[] } {
  const list = tenant.services;
  if (!query) return list.length === 1 ? { service: list[0], candidates: [] } : { candidates: list };
  const q = normalize(query);
  const exact = list.find((s) => s.id === query || s.key === query || normalize(s.name) === q);
  if (exact) return { service: exact, candidates: [] };
  const words = q.split(' ').filter((w) => w.length >= 3);
  const scored = list
    .map((s) => {
      const hay = normalize(`${s.name} ${s.category} ${s.description}`);
      const name = normalize(s.name);
      let score = 0;
      for (const w of words) {
        const stem = w.slice(0, Math.max(4, w.length - 2));
        if (name.includes(stem)) score += 3;
        else if (hay.includes(stem)) score += 1;
      }
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { candidates: list };
  if (scored.length === 1 || scored[0]!.score > scored[1]!.score) return { service: scored[0]!.s, candidates: [] };
  return { candidates: scored.filter((x) => x.score === scored[0]!.score).map((x) => x.s) };
}

export const TOOLS = [
  def({
    name: 'studio_info',
    scope: ['client', 'owner'],
    description: 'Адрес, телефон, ссылка на карту, часы работы, ближайшие выходные и правила отмены студии.',
    args: z.object({}),
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: async (_a, { tenant }) => ({
      name: tenant.name,
      address: tenant.address,
      phone: tenant.phone,
      map_url: tenant.map_url,
      timezone: tenant.timezone,
      working_hours: tenant.working_hours,
      closed_or_special_days: tenant.exceptions,
      cancellation_policy: tenant.cancellation_policy,
      cancel_cutoff_hours: tenant.cancel_cutoff_hours,
    }),
  }),
  def({
    name: 'list_services',
    scope: ['client', 'owner'],
    description: 'Услуги студии с ценами (в копейках, price_is_from=true значит «от») и длительностью. Можно отфильтровать по запросу.',
    args: z.object({ query: z.string().max(80).optional() }),
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Необязательно: часть названия услуги, например «полировка»' } },
      additionalProperties: false,
    },
    run: async ({ query }, { tenant }) => {
      const list = query ? (resolveService(tenant, query).service ? [resolveService(tenant, query).service!] : resolveService(tenant, query).candidates) : tenant.services;
      return {
        currency: tenant.currency,
        services: list.map((s) => ({
          name: s.name,
          price_cents: s.price_cents,
          price_is_from: s.price_is_from,
          duration_minutes: s.duration_minutes,
          description: s.description,
        })),
      };
    },
  }),
  def({
    name: 'find_free_slots',
    scope: ['client', 'owner'],
    description:
      'Свободное время для записи на услугу: ближайшие окна или окна на конкретный день. Используй для вопросов «когда можно», «есть ли время завтра». Никогда не придумывай время сам.',
    args: z.object({
      service: z.string().max(80).optional(),
      date: z.string().max(20).optional(),
      limit: z.number().int().min(1).max(8).optional(),
    }),
    parameters: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Название услуги, как назвал клиент' },
        date: { type: 'string', description: 'День в формате YYYY-MM-DD, либо today/tomorrow. Не указывай, чтобы найти ближайшее окно.' },
        limit: { type: 'integer', minimum: 1, maximum: 8 },
      },
      additionalProperties: false,
    },
    run: async ({ service, date, limit }, ctx) => {
      const { tenant, backend } = ctx;
      const r = resolveService(tenant, service);
      if (!r.service) {
        // No (clear) service: show the nearest window for each candidate so the client can pick.
        const options = r.candidates.slice(0, 4);
        const perService = await Promise.all(
          options.map(async (s) => {
            const [first] = await backend.nearest(s.id, 1);
            if (first && ctx.slots.length < 4) {
              ctx.slots.push({ service_id: s.id, service_name: s.name, starts_at: first.starts_at, label: slotLabel(first.starts_at, tenant.timezone) });
            }
            return { service: s.name, nearest: first ? slotLabel(first.starts_at, tenant.timezone) : null, starts_at: first?.starts_at ?? null };
          }),
        );
        return {
          need_service: r.candidates.length > 1,
          message: 'Услуга не указана или неоднозначна — вот ближайшее окно по каждой подходящей услуге',
          timezone: tenant.timezone,
          nearest_by_service: perService,
          more_services: r.candidates.length > options.length ? r.candidates.slice(options.length).map((s) => s.name) : undefined,
        };
      }
      const n = limit ?? 5;
      const day = resolveDay(date, tenant.timezone);
      if (date && !day) return { error: 'Не понял дату, нужен формат YYYY-MM-DD' };
      const slots = day
        ? (await backend.availability(r.service.id, day)).filter((s) => s.available).slice(0, n)
        : await backend.nearest(r.service.id, n);
      for (const s of slots.slice(0, 4)) {
        if (!ctx.slots.some((x) => x.starts_at === s.starts_at && x.service_id === r.service!.id)) {
          ctx.slots.push({
            service_id: r.service.id,
            service_name: r.service.name,
            starts_at: s.starts_at,
            label: slotLabel(s.starts_at, tenant.timezone),
          });
        }
      }
      return {
        service: r.service.name,
        day: day ?? null,
        timezone: tenant.timezone,
        free: slots.map((s) => ({ starts_at: s.starts_at, local: slotLabel(s.starts_at, tenant.timezone) })),
        note: slots.length ? undefined : day ? 'В этот день свободного времени нет' : 'Свободного времени в горизонте записи нет',
      };
    },
  }),
  def({
    name: 'owner_bookings',
    scope: ['owner'],
    description: 'Записи студии за период или день (только для владельца): время, услуга, клиент, машина, пост, статус, цена, оплачено.',
    args: z.object({
      period: z.enum(OWNER_PERIODS).optional(),
      date: z.string().regex(ISO_DAY).optional(),
    }),
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: [...OWNER_PERIODS] },
        date: { type: 'string', description: 'Конкретный день YYYY-MM-DD вместо period' },
      },
      additionalProperties: false,
    },
    run: async ({ period, date }, { backend, tenant }) => {
      let from: string;
      let to: string;
      let label: string;
      if (date) {
        from = to = date;
        label = date;
      } else {
        const p = await backend.periodDays(period ?? 'today');
        from = p.from_day;
        to = p.to_day;
        label = p.label;
      }
      const list = await backend.ownerBookings(from, to);
      return {
        label,
        from,
        to,
        timezone: tenant.timezone,
        bookings: list.map((b) => ({
          starts: slotLabel(b.starts_at, tenant.timezone),
          service: b.service_name,
          client: b.client_name,
          phone: b.client_phone,
          car: b.car,
          resource: b.resource_name,
          status: b.status,
          price_cents: b.price_cents,
          paid_cents: b.paid_cents - b.refunded_cents,
          demo: b.is_demo || undefined,
        })),
      };
    },
  }),
  def({
    name: 'owner_stats',
    scope: ['owner'],
    description:
      'Статистика за период (только для владельца): заезды (visits), выполненные заказы, полученные деньги (received_cents = оплаты минус возвраты), ожидаемая стоимость будущих записей (expected_cents — НЕ выручка).',
    args: z.object({ period: z.enum(OWNER_PERIODS) }),
    parameters: {
      type: 'object',
      properties: { period: { type: 'string', enum: [...OWNER_PERIODS] } },
      required: ['period'],
      additionalProperties: false,
    },
    run: async ({ period }, { backend }) => backend.ownerStats(period),
  }),
];

export type ToolName = (typeof TOOLS)[number]['name'];

export function toolsForScope(scope: Scope) {
  return TOOLS.filter((t) => (t.scope as Scope[]).includes(scope));
}

export function openAiTools(scope: Scope) {
  return toolsForScope(scope).map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Execute a tool on behalf of the conversation. The scope check happens HERE, on the server,
 * regardless of what the model asked for.
 */
export async function executeTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `unknown_tool:${name}` };
  if (!(tool.scope as Scope[]).includes(ctx.scope)) return { ok: false, error: 'forbidden_tool' };
  let args: unknown = rawArgs;
  if (typeof rawArgs === 'string') {
    try {
      args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
    } catch {
      return { ok: false, error: 'invalid_arguments_json' };
    }
  }
  // Strip anything the model might try to smuggle (tenant ids, SQL…): only declared keys survive.
  const parsed = (tool.args as z.ZodTypeAny).safeParse(args ?? {});
  if (!parsed.success) return { ok: false, error: `invalid_arguments: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}` };
  try {
    // deno-lint-ignore no-explicit-any
    const data = await (tool.run as (a: any, c: ToolContext) => Promise<unknown>)(parsed.data, ctx);
    return { ok: true, data };
  } catch (e) {
    const err = e as { code?: string; message?: string; detail?: string };
    if (err.code === 'P0001') return { ok: false, error: `${err.message}: ${err.detail ?? ''}` };
    return { ok: false, error: 'tool_failed' };
  }
}
