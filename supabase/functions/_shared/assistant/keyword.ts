// Deterministic intent detection. Used to (1) prefetch the right tool BEFORE the model answers a
// question about bookings/time/money, and (2) answer without a model when AI is unavailable.
import { normalize } from './format.ts';
import { resolveService } from './tools.ts';
import type { Scope, TenantInfo } from './types.ts';

export interface Intent {
  tool: 'studio_info' | 'list_services' | 'find_free_slots' | 'owner_bookings' | 'owner_stats';
  args: Record<string, unknown>;
}

const has = (t: string, ...re: RegExp[]) => re.some((r) => r.test(t));

function ownerPeriod(t: string): string | undefined {
  if (has(t, /(^| )завтра( |$)/)) return 'tomorrow';
  if (has(t, /(^| )вчера( |$)/)) return 'yesterday';
  if (has(t, /(^| )сегодня( |$)/)) return 'today';
  if (has(t, /прошл[а-я]* недел/)) return 'last_week';
  if (has(t, /следующ[а-я]* недел/)) return 'next_week';
  if (has(t, /недел/)) return 'this_week';
  if (has(t, /прошл[а-я]* месяц/)) return 'last_month';
  if (has(t, /месяц/)) return 'this_month';
  return undefined;
}

export function detectIntent(text: string, scope: Scope, tenant: TenantInfo): Intent | null {
  const t = normalize(text);
  if (!t) return null;

  if (scope === 'owner') {
    if (has(t, /сколько (денег|получен|заработ|выручк)/, /(^| )(выручк|получен[а-я]* денег|касс|оплат)/, /сколько машин/, /сколько заезд/, /статистик/, /сколько (было|сделал|выполн)/)) {
      return { tool: 'owner_stats', args: { period: ownerPeriod(t) ?? 'this_week' } };
    }
    if (has(t, /что у меня/, /(^| )запис(и|ей)( |$).*(завтра|сегодня|недел)/, /(завтра|сегодня).*(запис|клиент|машин)/, /кто (приедет|записан)/, /расписани/)) {
      return { tool: 'owner_bookings', args: { period: ownerPeriod(t) ?? 'today' } };
    }
  }

  if (has(t, /окн/, /свободн/, /когда (можно|могу|ближайш)/, /ближайш/, /есть (ли )?(время|место)/, /записат/, /(завтра|сегодня|послезавтра).*(время|можно|свобод)/)) {
    const svc = resolveService(tenant, text);
    const date = has(t, /послезавтра/) ? 'послезавтра' : has(t, /(^| )завтра( |$)/) ? 'tomorrow' : has(t, /(^| )сегодня( |$)/) ? 'today' : undefined;
    return { tool: 'find_free_slots', args: { ...(svc.service ? { service: svc.service.name } : {}), ...(date ? { date } : {}) } };
  }
  if (has(t, /сколько стоит/, /(^| )цен/, /стоимост/, /прайс/, /почем/, /(^| )услуг/)) {
    const svc = resolveService(tenant, text);
    return { tool: 'list_services', args: svc.service ? { query: svc.service.name } : {} };
  }
  if (has(t, /адрес/, /как (найти|доехать|добраться|проехать)/, /где (вы|наход)/, /телефон/, /часы работы/, /до скольки/, /во сколько (открыва|закрыва)/, /работаете/, /отмен/)) {
    return { tool: 'studio_info', args: {} };
  }
  return null;
}
