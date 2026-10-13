// AssistantBackend over the same RPCs the app uses. Client scope runs as "anon";
// owner scope runs as "authenticated" with the caller's user id, so RLS and membership checks apply.
import { asAnon, asUser, type Tx } from '../db.ts';
import type { AssistantBackend, OwnerBooking, OwnerStats, Slot, TenantInfo } from './types.ts';

export function sqlBackend(opts: { slug: string; ip: string; userId?: string }): AssistantBackend {
  const run = <T>(fn: (tx: Tx) => Promise<T>) => (opts.userId ? asUser(opts.userId, opts.ip, fn) : asAnon(opts.ip, fn));
  const owner = <T>(fn: (tx: Tx) => Promise<T>) => {
    if (!opts.userId) throw Object.assign(new Error('forbidden'), { code: 'P0001', detail: 'owner only' });
    return asUser(opts.userId, opts.ip, fn);
  };
  let tenantCache: TenantInfo | null = null;

  return {
    async tenant() {
      if (tenantCache) return tenantCache;
      const [row] = await run((tx) => tx<{ t: TenantInfo }[]>`select public.get_tenant_public(${opts.slug}) as t`);
      tenantCache = row!.t;
      return tenantCache;
    },
    async availability(serviceId, day) {
      return run(
        (tx) => tx<(Slot & { available: boolean })[]>`
          select starts_at, local_day::text, local_time, available
          from public.get_availability(${opts.slug}, ${serviceId}, ${day}::date, ${day}::date)`,
      );
    },
    async nearest(serviceId, limit) {
      return run(
        (tx) => tx<Slot[]>`select starts_at, local_day::text, local_time from public.get_nearest_slots(${opts.slug}, ${serviceId}, ${limit})`,
      );
    },
    async periodDays(period) {
      const t = await this.tenant();
      const [row] = await run(
        (tx) => tx<{ from_day: string; to_day: string; label: string }[]>`
          select from_day::text, to_day::text, label from app.period_days(${period}, ${t.timezone})`,
      );
      return row!;
    },
    async ownerBookings(fromDay, toDay) {
      const t = await this.tenant();
      const [row] = await owner(
        (tx) => tx<{ list: OwnerBooking[] }[]>`
          select public.owner_bookings(${opts.slug},
                   app.local_to_ts(${fromDay}::date, '00:00', ${t.timezone}),
                   app.local_to_ts(${toDay}::date + 1, '00:00', ${t.timezone})) as list`,
      );
      return row!.list;
    },
    async ownerStats(period) {
      const [row] = await owner((tx) => tx<{ s: OwnerStats }[]>`select public.owner_stats(${opts.slug}, ${period}) as s`);
      return row!.s;
    },
  };
}
