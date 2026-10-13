// In-browser demo backend. It answers the same RPC names with the same JSON shapes as the
// Postgres functions in supabase/migrations, so the real UI runs unchanged inside one HTML file.
// Business rules mirror the SQL (candidate starts, buffers, multi-day occupancy, idempotency,
// cancel cut-off, status flow, money). Data lives in memory: a reload starts from the demo seed.
// The production guarantees (EXCLUDE constraint, RLS, rate limits) live in the database, not here.
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

// ------------------------------------------------------------------ types

export interface DemoTenantInput {
  config: PublishConfig;
  media: { hero?: string; logo?: string; services: Record<string, string>; gallery: Record<string, string> };
  owner: { email: string; password: string };
}

interface PublishConfig {
  slug: string;
  name: string;
  short_name: string;
  tagline: string;
  description: string;
  address: string;
  map_url: string | null;
  phone: string;
  messenger_url: string | null;
  timezone: string;
  currency: string;
  locale: string;
  accent_color: string;
  booking: { slot_step_minutes: number; min_lead_minutes: number; max_days_ahead: number; cancel_cutoff_hours: number; cancellation_policy: string };
  resources: { key: string; name: string }[];
  services: {
    key: string;
    name: string;
    description: string;
    category: string;
    duration_minutes: number;
    buffer_minutes: number;
    price_cents: number;
    price_is_from: boolean;
    resources: string[];
  }[];
  working_hours: { weekday: number; opens: string; closes: string }[];
  exceptions: { day: string; closed: boolean; opens?: string; closes?: string; note?: string }[];
  info_cards: { icon: string; title: string; body: string }[];
  gallery: { key: string; caption: string }[];
}

type Status = 'confirmed' | 'arrived' | 'completed' | 'cancelled' | 'no_show';

interface Tenant {
  id: string;
  slug: string;
  status: 'preview' | 'live';
  name: string;
  short_name: string;
  tagline: string;
  description: string;
  address: string;
  map_url: string | null;
  phone: string;
  messenger_url: string | null;
  timezone: string;
  currency: string;
  locale: string;
  accent_color: string;
  logo_path: string | null;
  hero_path: string | null;
  slot_step_minutes: number;
  min_lead_minutes: number;
  max_days_ahead: number;
  cancel_cutoff_hours: number;
  cancellation_policy: string;
  config_version: number;
  published_at: string | null;
  activated_at: string | null;
}
interface Resource { id: string; tenant_id: string; key: string; name: string; active: boolean; sort: number; source: string }
interface Service {
  id: string; tenant_id: string; key: string; name: string; description: string; category: string;
  duration_minutes: number; buffer_minutes: number; price_cents: number; price_is_from: boolean;
  image_path: string | null; active: boolean; sort: number; source: string; resource_ids: string[];
}
interface Hours { tenant_id: string; weekday: number; opens: string; closes: string }
interface Exception { id: number; tenant_id: string; day: string; closed: boolean; opens: string | null; closes: string | null; note: string }
interface Card { tenant_id: string; position: number; icon: string; title: string; body: string; source: string }
interface GalleryItem { id: string; tenant_id: string; image_path: string; caption: string; sort: number; source: string; removed: boolean }
interface Booking {
  id: string; tenant_id: string; service_id: string; resource_id: string; status: Status;
  starts_at: number; ends_at: number; occupied_until: number;
  service_name: string; duration_minutes: number; buffer_minutes: number; price_cents: number; price_is_from: boolean;
  client_name: string; client_phone: string; car: string; comment: string; source: 'client' | 'owner'; is_demo: boolean;
  idempotency_key: string; fingerprint: string; created_at: number;
  arrived_at: number | null; completed_at: number | null; cancelled_at: number | null;
  cancelled_by: 'client' | 'owner' | null; cancel_reason: string | null;
}
interface Occupancy { tenant_id: string; resource_id: string; booking_id?: string; block_id?: string; from: number; to: number; released: boolean }
interface Payment {
  id: string; tenant_id: string; booking_id: string; kind: 'payment' | 'refund'; amount_cents: number;
  method: string; note: string; idempotency_key: string; created_at: number;
}
interface Block { id: string; tenant_id: string; resource_id: string; starts_at: number; ends_at: number; reason: string; removed: boolean }

export class RpcError extends Error {
  constructor(public code: string, public details: string) {
    super(code);
  }
}
const fail = (code: string, details: string): never => {
  throw new RpcError(code, details);
};

// ------------------------------------------------------------------ time helpers (tenant timezone)

const MIN = 60_000;
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const localDay = (ms: number, tz: string) => formatInTimeZone(ms, tz, 'yyyy-MM-dd');
const localToTs = (day: string, time: string, tz: string) => fromZonedTime(`${day}T${time}:00`, tz).getTime();
const today = (tz: string) => localDay(Date.now(), tz);
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isoDow = (day: string) => ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const uuid = () => crypto.randomUUID();
const minDay = (a: string, b: string) => (a < b ? a : b);
const maxDay = (a: string, b: string) => (a > b ? a : b);

// ------------------------------------------------------------------ store

export class DemoDb {
  tenants: Tenant[] = [];
  resources: Resource[] = [];
  services: Service[] = [];
  hours: Hours[] = [];
  exceptions: Exception[] = [];
  cards: Card[] = [];
  gallery: GalleryItem[] = [];
  bookings: Booking[] = [];
  occupancies: Occupancy[] = [];
  payments: Payment[] = [];
  blocks: Block[] = [];
  tokens = new Map<string, string>(); // booking id → access token
  media = new Map<string, string>(); // storage path → URL (data: or blob:)
  owners: { email: string; password: string; user_id: string; tenant_id: string }[] = [];
  private exceptionSeq = 1;

  constructor(input: DemoTenantInput[]) {
    for (const t of input) this.publish(t);
  }

  // ---------------------------------------------------------------- publish (mirrors app.publish_tenant)
  private publish({ config: c, media, owner }: DemoTenantInput) {
    const id = uuid();
    const put = (name: string, url?: string) => {
      if (!url) return null;
      const path = `${id}/config/${name}`;
      this.media.set(path, url);
      return path;
    };
    this.tenants.push({
      id, slug: c.slug, status: 'live' /* the demo shows studios as they look once launched */, name: c.name, short_name: c.short_name, tagline: c.tagline,
      description: c.description, address: c.address, map_url: c.map_url, phone: c.phone,
      messenger_url: c.messenger_url, timezone: c.timezone, currency: c.currency, locale: c.locale,
      accent_color: c.accent_color, logo_path: put('logo', media.logo), hero_path: put('hero', media.hero),
      slot_step_minutes: c.booking.slot_step_minutes, min_lead_minutes: c.booking.min_lead_minutes,
      max_days_ahead: c.booking.max_days_ahead, cancel_cutoff_hours: c.booking.cancel_cutoff_hours,
      cancellation_policy: c.booking.cancellation_policy, config_version: 1,
      published_at: new Date().toISOString(), activated_at: null,
    });
    c.resources.forEach((r, i) =>
      this.resources.push({ id: uuid(), tenant_id: id, key: r.key, name: r.name, active: true, sort: i + 1, source: 'config' }),
    );
    c.services.forEach((s, i) =>
      this.services.push({
        id: uuid(), tenant_id: id, key: s.key, name: s.name, description: s.description, category: s.category,
        duration_minutes: s.duration_minutes, buffer_minutes: s.buffer_minutes, price_cents: s.price_cents,
        price_is_from: s.price_is_from, image_path: put(`service-${s.key}`, media.services[s.key]), active: true,
        sort: i + 1, source: 'config',
        resource_ids: s.resources.map((k) => this.resources.find((r) => r.tenant_id === id && r.key === k)!.id),
      }),
    );
    c.working_hours.forEach((h) => this.hours.push({ tenant_id: id, ...h }));
    c.exceptions.forEach((e) =>
      this.exceptions.push({
        id: this.exceptionSeq++, tenant_id: id, day: e.day, closed: e.closed, opens: e.opens ?? null,
        closes: e.closes ?? null, note: e.note ?? '',
      }),
    );
    c.info_cards.forEach((card, i) => this.cards.push({ tenant_id: id, position: i + 1, ...card, source: 'config' }));
    c.gallery.forEach((g, i) => {
      const path = put(`gallery-${g.key}`, media.gallery[g.key]);
      if (path) this.gallery.push({ id: uuid(), tenant_id: id, image_path: path, caption: g.caption, sort: i + 1, source: 'config', removed: false });
    });
    this.owners.push({ ...owner, user_id: uuid(), tenant_id: id });
    this.seedBookings(this.tenants.at(-1)!);
  }

  // ---------------------------------------------------------------- demo bookings (mirrors seed_demo.bookings)
  private seedBookings(t: Tenant) {
    const names = ['Алексей', 'Мария', 'Дмитрий', 'Ольга', 'Сергей', 'Анна', 'Игорь', 'Елена', 'Павел', 'Наталья'];
    const cars = ['Kia Rio', 'Toyota Camry', 'BMW X5', 'Hyundai Solaris', 'Mazda CX-5', 'Lada Vesta', 'Skoda Octavia', 'VW Tiguan', 'Haval Jolion', 'Geely Monjaro'];
    const short = this.services.filter((s) => s.tenant_id === t.id && s.active && s.duration_minutes < 600);
    let i = 0;
    for (let d = -6; d <= 4; d++) {
      for (const hh of [10, 13, 16]) {
        i++;
        const svc = short[i % Math.max(1, short.length)]!;
        const start = localToTs(addDays(today(t.timezone), d), `${hh}:00`, t.timezone);
        let b: Booking;
        try {
          b = this.createBooking(t, svc.id, start, names[i % 10]!, `+7900${String(1000000 + i * 7919).padStart(7, '0')}`,
            cars[(i * 3) % 10]!, '', `seed-${t.slug}-${i}`, 'owner', null, true).b;
        } catch {
          continue;
        }
        if (d < 0) {
          if (i % 7 === 0) {
            b.status = 'no_show';
            this.release(b.id);
          } else if (i % 9 === 0) {
            this.cancel(t.id, b.id, 'client', 'Демо: планы изменились');
          } else {
            b.status = 'completed';
            b.arrived_at = start;
            b.completed_at = start + b.duration_minutes * MIN;
            this.payments.push({
              id: uuid(), tenant_id: t.id, booking_id: b.id, kind: 'payment',
              amount_cents: b.price_cents + (b.price_is_from ? 150000 : 0), method: ['card', 'cash', 'transfer'][i % 3]!,
              note: '', idempotency_key: `seed-pay-${b.id}`, created_at: b.completed_at,
            });
          }
        } else if (d === 0 && hh === 10) {
          b.status = 'arrived';
          b.arrived_at = start;
        }
      }
    }
  }

  // ---------------------------------------------------------------- core helpers

  tenantBySlug(slug: string) {
    return this.tenants.find((t) => t.slug === slug) ?? fail('tenant_not_found', 'Студия не найдена');
  }
  private serviceResourceIds(t: Tenant, s: Service) {
    return this.resources
      .filter((r) => r.tenant_id === t.id && r.active && s.resource_ids.includes(r.id))
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
      .map((r) => r.id);
  }
  private dayIntervals(t: Tenant, day: string) {
    const ex = this.exceptions.filter((e) => e.tenant_id === t.id && e.day === day);
    if (ex.length) return ex.filter((e) => !e.closed && e.opens && e.closes).map((e) => ({ opens: e.opens!, closes: e.closes! }));
    return this.hours
      .filter((h) => h.tenant_id === t.id && h.weekday === isoDow(day))
      .sort((a, b) => a.opens.localeCompare(b.opens));
  }
  /** Same rule as app.candidate_starts: fitting services end before closing, longer ones only start inside hours. */
  private candidateStarts(t: Tenant, s: Service, from: string, to: string) {
    const out: { starts_at: number; local_day: string; local_time: string }[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      for (const iv of this.dayIntervals(t, d)) {
        const o = toMin(iv.opens);
        const c = toMin(iv.closes);
        const last = c - o >= s.duration_minutes ? c - s.duration_minutes : c - 1;
        for (let m = o; m <= last; m += t.slot_step_minutes) {
          out.push({ starts_at: localToTs(d, fromMin(m), t.timezone), local_day: d, local_time: fromMin(m) });
        }
      }
    }
    return out;
  }
  private isFree(t: Tenant, resourceId: string, from: number, to: number) {
    return !this.occupancies.some((o) => o.tenant_id === t.id && o.resource_id === resourceId && !o.released && o.from < to && from < o.to);
  }
  private release(bookingId: string) {
    for (const o of this.occupancies) if (o.booking_id === bookingId) o.released = true;
  }
  private availability(t: Tenant, s: Service, from: string, to: string) {
    const earliest = Date.now() + t.min_lead_minutes * MIN;
    const horizon = addDays(today(t.timezone), t.max_days_ahead);
    const res = this.serviceResourceIds(t, s);
    return this.candidateStarts(t, s, maxDay(from, today(t.timezone)), minDay(to, horizon))
      .filter((c) => c.starts_at >= earliest)
      .map((c) => {
        const end = c.starts_at + (s.duration_minutes + s.buffer_minutes) * MIN;
        const n = res.filter((r) => this.isFree(t, r, c.starts_at, end)).length;
        return { ...c, available: n > 0 };
      });
  }
  private normalizePhone(p: string) {
    let digits = (p ?? '').replace(/\D/g, '');
    if (digits.length === 11 && digits[0] === '8') digits = `7${digits.slice(1)}`;
    else if (digits.length === 10) digits = `7${digits}`;
    if (digits.length < 10 || digits.length > 15) fail('invalid_phone', 'Проверьте номер телефона');
    return `+${digits}`;
  }
  private canClientCancel(b: Booking, t: Tenant) {
    return b.status === 'confirmed' && Date.now() <= b.starts_at - t.cancel_cutoff_hours * 3_600_000;
  }
  bookingJson(b: Booking) {
    const t = this.tenants.find((x) => x.id === b.tenant_id)!;
    const r = this.resources.find((x) => x.id === b.resource_id)!;
    return {
      id: b.id, status: b.status, starts_at: iso(b.starts_at), ends_at: iso(b.ends_at), service_id: b.service_id,
      service_name: b.service_name, duration_minutes: b.duration_minutes, price_cents: b.price_cents,
      price_is_from: b.price_is_from, client_name: b.client_name, client_phone: b.client_phone, car: b.car,
      comment: b.comment, is_demo: b.is_demo, resource_name: r.name, cancelled_at: iso(b.cancelled_at),
      can_cancel: this.canClientCancel(b, t), cancel_deadline: iso(b.starts_at - t.cancel_cutoff_hours * 3_600_000),
      tenant: {
        slug: t.slug, name: t.name, address: t.address, phone: t.phone, map_url: t.map_url, timezone: t.timezone,
        currency: t.currency, cancel_cutoff_hours: t.cancel_cutoff_hours, cancellation_policy: t.cancellation_policy,
        status: t.status,
      },
    };
  }

  /** Mirrors app.create_booking: idempotent, price/duration from the store, first free suitable resource. */
  createBooking(
    t: Tenant, serviceId: string, startsAt: number, name: string, phoneRaw: string, car: string, comment: string,
    key: string, source: 'client' | 'owner', resourceId: string | null, allowOffGrid: boolean,
  ) {
    const k = (key ?? '').trim();
    if (k.length < 8 || k.length > 80) fail('invalid_request', 'idempotency key');
    const phone = this.normalizePhone(phoneRaw);
    const fp = [serviceId, startsAt, phone, (name ?? '').trim(), (car ?? '').trim(), resourceId ?? ''].join('|');
    const existing = this.bookings.find((b) => b.tenant_id === t.id && b.idempotency_key === k);
    if (existing) {
      if (existing.fingerprint !== fp) fail('idempotency_conflict', 'Этот ключ уже использован для другой записи');
      return { b: existing, replayed: true };
    }
    if (!(name ?? '').trim()) fail('invalid_name', 'Укажите имя');
    if (!(car ?? '').trim()) fail('invalid_car', 'Укажите автомобиль');
    const s = this.services.find((x) => x.id === serviceId && x.tenant_id === t.id && x.active) ?? fail('service_not_found', 'Услуга не найдена');
    const day = localDay(startsAt, t.timezone);
    if (source === 'client') {
      if (startsAt < Date.now() + t.min_lead_minutes * MIN) fail('too_soon', 'Это время уже недоступно для онлайн-записи');
      if (day > addDays(today(t.timezone), t.max_days_ahead)) fail('too_far', 'Запись так далеко пока не открыта');
    }
    if (!allowOffGrid && !this.candidateStarts(t, s, day, day).some((c) => c.starts_at === startsAt)) {
      fail('outside_hours', 'Студия не принимает машины в это время');
    }
    let resources: string[];
    if (resourceId) {
      if (!this.serviceResourceIds(t, s).includes(resourceId)) fail('resource_not_suitable', 'Этот пост не подходит для услуги');
      resources = [resourceId];
    } else resources = this.serviceResourceIds(t, s);
    if (!resources.length) fail('no_resources', 'Для услуги не настроены посты');
    const to = startsAt + (s.duration_minutes + s.buffer_minutes) * MIN;
    const chosen = resources.find((r) => this.isFree(t, r, startsAt, to)) ?? fail('slot_taken', 'Это время только что заняли. Выберите другое.');
    const b: Booking = {
      id: uuid(), tenant_id: t.id, service_id: s.id, resource_id: chosen, status: 'confirmed', starts_at: startsAt,
      ends_at: startsAt + s.duration_minutes * MIN, occupied_until: to, service_name: s.name,
      duration_minutes: s.duration_minutes, buffer_minutes: s.buffer_minutes, price_cents: s.price_cents,
      price_is_from: s.price_is_from, client_name: name.trim(), client_phone: phone, car: car.trim(),
      comment: (comment ?? '').trim(), source, is_demo: t.status === 'preview', idempotency_key: k, fingerprint: fp,
      created_at: Date.now(), arrived_at: null, completed_at: null, cancelled_at: null, cancelled_by: null, cancel_reason: null,
    };
    this.bookings.push(b);
    this.occupancies.push({ tenant_id: t.id, resource_id: chosen, booking_id: b.id, from: startsAt, to, released: false });
    this.tokens.set(b.id, `${uuid()}${uuid()}`.replace(/-/g, ''));
    return { b, replayed: false };
  }

  cancel(tenantId: string, bookingId: string, by: 'client' | 'owner', reason: string | null) {
    const b = this.bookings.find((x) => x.id === bookingId && x.tenant_id === tenantId) ?? fail('booking_not_found', 'Запись не найдена');
    if (b.status === 'cancelled') return b;
    if (b.status !== 'confirmed') fail('cannot_cancel', 'Эту запись уже нельзя отменить');
    b.status = 'cancelled';
    b.cancelled_at = Date.now();
    b.cancelled_by = by;
    b.cancel_reason = (reason ?? '').trim().slice(0, 300) || null;
    this.release(b.id);
    return b;
  }

  private reschedule(t: Tenant, bookingId: string, newStart: number, resourceId: string | null, allowOffGrid: boolean) {
    const b = this.bookings.find((x) => x.id === bookingId && x.tenant_id === t.id) ?? fail('booking_not_found', 'Запись не найдена');
    if (b.status !== 'confirmed') fail('cannot_reschedule', 'Перенести можно только подтверждённую запись');
    if (b.starts_at === newStart && (!resourceId || resourceId === b.resource_id)) return b;
    const s = this.services.find((x) => x.id === b.service_id)!;
    const day = localDay(newStart, t.timezone);
    if (!allowOffGrid && !this.candidateStarts(t, s, day, day).some((c) => c.starts_at === newStart)) {
      fail('outside_hours', 'Студия не принимает машины в это время');
    }
    let resources: string[];
    if (resourceId) {
      if (!this.serviceResourceIds(t, s).includes(resourceId)) fail('resource_not_suitable', 'Этот пост не подходит для услуги');
      resources = [resourceId];
    } else resources = [b.resource_id, ...this.serviceResourceIds(t, s).filter((r) => r !== b.resource_id)];
    const to = newStart + (b.duration_minutes + b.buffer_minutes) * MIN;
    const own = this.occupancies.filter((o) => o.booking_id === b.id && !o.released);
    own.forEach((o) => (o.released = true));
    const chosen = resources.find((r) => this.isFree(t, r, newStart, to));
    if (!chosen) {
      own.forEach((o) => (o.released = false)); // whole call fails, the original booking stays
      fail('slot_taken', 'Новое время занято. Запись осталась на прежнем времени.');
    }
    this.occupancies.push({ tenant_id: t.id, resource_id: chosen!, booking_id: b.id, from: newStart, to, released: false });
    Object.assign(b, { starts_at: newStart, ends_at: newStart + b.duration_minutes * MIN, occupied_until: to, resource_id: chosen });
    return b;
  }

  private periodDays(period: string, tz: string): [string, string, string] {
    const d = today(tz);
    const wk = addDays(d, -(isoDow(d) - 1));
    const mo = `${d.slice(0, 8)}01`;
    const monthEnd = addDays(`${addDays(mo, 32).slice(0, 8)}01`, -1);
    const prevMo = `${addDays(mo, -1).slice(0, 8)}01`;
    switch (period) {
      case 'today': return [d, d, 'Сегодня'];
      case 'yesterday': return [addDays(d, -1), addDays(d, -1), 'Вчера'];
      case 'tomorrow': return [addDays(d, 1), addDays(d, 1), 'Завтра'];
      case 'this_week': return [wk, addDays(wk, 6), 'Эта неделя'];
      case 'last_week': return [addDays(wk, -7), addDays(wk, -1), 'Прошлая неделя'];
      case 'next_week': return [addDays(wk, 7), addDays(wk, 13), 'Следующая неделя'];
      case 'this_month': return [mo, monthEnd, 'Этот месяц'];
      case 'last_month': return [prevMo, addDays(mo, -1), 'Прошлый месяц'];
      case 'last_7_days': return [addDays(d, -6), d, 'Последние 7 дней'];
      case 'last_30_days': return [addDays(d, -29), d, 'Последние 30 дней'];
      default: return fail('invalid_period', period);
    }
  }

  private stats(t: Tenant, from: string, to: string) {
    const lo = localToTs(from, '00:00', t.timezone);
    const hi = localToTs(addDays(to, 1), '00:00', t.timezone);
    const bk = this.bookings.filter((b) => b.tenant_id === t.id);
    const pm = this.payments.filter((p) => p.tenant_id === t.id);
    const inRange = (ms: number | null, a: number, z: number) => ms !== null && ms >= a && ms < z;
    const net = (a: number, z: number) =>
      pm.filter((p) => inRange(p.created_at, a, z)).reduce((s, p) => s + (p.kind === 'payment' ? p.amount_cents : -p.amount_cents), 0);
    const visits = (a: number, z: number) => bk.filter((b) => ['arrived', 'completed'].includes(b.status) && inRange(b.starts_at, a, z)).length;
    const byDay = [];
    for (let d = from; d <= minDay(to, addDays(from, 92)); d = addDays(d, 1)) {
      const a = localToTs(d, '00:00', t.timezone);
      const z = localToTs(addDays(d, 1), '00:00', t.timezone);
      byDay.push({ day: d, visits: visits(a, z), received_cents: net(a, z) });
    }
    return {
      from, to, timezone: t.timezone, currency: t.currency,
      visits: visits(lo, hi),
      completed_orders: bk.filter((b) => b.status === 'completed' && inRange(b.completed_at, lo, hi)).length,
      bookings_total: bk.filter((b) => b.status !== 'cancelled' && inRange(b.starts_at, lo, hi)).length,
      cancelled: bk.filter((b) => b.status === 'cancelled' && inRange(b.starts_at, lo, hi)).length,
      no_show: bk.filter((b) => b.status === 'no_show' && inRange(b.starts_at, lo, hi)).length,
      received_cents: net(lo, hi),
      payments_cents: pm.filter((p) => p.kind === 'payment' && inRange(p.created_at, lo, hi)).reduce((s, p) => s + p.amount_cents, 0),
      refunds_cents: pm.filter((p) => p.kind === 'refund' && inRange(p.created_at, lo, hi)).reduce((s, p) => s + p.amount_cents, 0),
      expected_cents: bk.filter((b) => b.status === 'confirmed' && b.starts_at >= Math.max(lo, Date.now()) && b.starts_at < hi).reduce((s, b) => s + b.price_cents, 0),
      by_day: byDay,
    };
  }

  private publicTenant(t: Tenant) {
    const td = today(t.timezone);
    return {
      id: t.id, slug: t.slug, status: t.status, name: t.name, short_name: t.short_name, tagline: t.tagline,
      description: t.description, address: t.address, map_url: t.map_url, phone: t.phone, messenger_url: t.messenger_url,
      timezone: t.timezone, currency: t.currency, locale: t.locale, accent_color: t.accent_color, logo_path: t.logo_path,
      hero_path: t.hero_path, slot_step_minutes: t.slot_step_minutes, max_days_ahead: t.max_days_ahead,
      cancel_cutoff_hours: t.cancel_cutoff_hours, cancellation_policy: t.cancellation_policy, today: td,
      resources_count: this.resources.filter((r) => r.tenant_id === t.id && r.active).length,
      services: this.services
        .filter((s) => s.tenant_id === t.id && s.active && this.serviceResourceIds(t, s).length > 0)
        .sort((a, b) => a.sort - b.sort)
        .map(({ id, key, name, description, category, duration_minutes, price_cents, price_is_from, image_path }) =>
          ({ id, key, name, description, category, duration_minutes, price_cents, price_is_from, image_path })),
      info_cards: this.cards.filter((c) => c.tenant_id === t.id).sort((a, b) => a.position - b.position)
        .map(({ position, icon, title, body }) => ({ position, icon, title, body })),
      gallery: this.gallery.filter((g) => g.tenant_id === t.id && !g.removed).sort((a, b) => a.sort - b.sort)
        .map(({ id, image_path, caption }) => ({ id, image_path, caption })),
      working_hours: this.hours.filter((h) => h.tenant_id === t.id).sort((a, b) => a.weekday - b.weekday || a.opens.localeCompare(b.opens))
        .map(({ weekday, opens, closes }) => ({ weekday, opens, closes })),
      exceptions: this.exceptions.filter((e) => e.tenant_id === t.id && e.day >= td && e.day <= addDays(td, 60))
        .sort((a, b) => a.day.localeCompare(b.day))
        .map(({ day, closed, opens, closes, note }) => ({ day, closed, opens, closes, note })),
    };
  }

  // ---------------------------------------------------------------- RPC entry point

  rpc(fn: string, a: Record<string, unknown>, userId: string | null): unknown {
    const str = (k: string) => (a[k] === null || a[k] === undefined ? null : String(a[k]));
    const member = () => {
      if (!userId) fail('not_authenticated', 'Войдите в кабинет');
      const t = this.tenantBySlug(String(a.p_slug));
      if (!this.owners.some((o) => o.user_id === userId && o.tenant_id === t.id)) fail('forbidden', 'Нет доступа к этой студии');
      return t;
    };
    const svc = (t: Tenant) =>
      this.services.find((s) => s.id === a.p_service_id && s.tenant_id === t.id && s.active) ?? fail('service_not_found', 'Услуга не найдена');
    const byToken = () => {
      const b = this.bookings.find((x) => x.id === a.p_booking_id);
      if (!b || this.tokens.get(b.id) !== a.p_token) fail('booking_not_found', 'Запись не найдена или ссылка недействительна');
      return b!;
    };
    const ownBooking = (t: Tenant) =>
      this.bookings.find((b) => b.id === a.p_booking_id && b.tenant_id === t.id) ?? fail('booking_not_found', 'Запись не найдена');

    switch (fn) {
      // ---------------- public
      case 'get_tenant_public':
        return this.publicTenant(this.tenantBySlug(String(a.p_slug)));
      case 'get_availability': {
        const t = this.tenantBySlug(String(a.p_slug));
        const from = String(a.p_from);
        const to = String(a.p_to);
        if (to < from || dayDiff(to, from) > 14) fail('invalid_range', 'Диапазон не больше двух недель');
        return this.availability(t, svc(t), from, to).map((s) => ({ ...s, starts_at: iso(s.starts_at) }));
      }
      case 'get_nearest_slots': {
        const t = this.tenantBySlug(String(a.p_slug));
        const s = svc(t);
        const limit = Math.min(Math.max(Number(a.p_limit ?? 5), 1), 20);
        const out: { starts_at: string | null; local_day: string; local_time: string }[] = [];
        const horizon = addDays(today(t.timezone), t.max_days_ahead);
        for (let d = today(t.timezone); d <= horizon && out.length < limit; d = addDays(d, 7)) {
          for (const slot of this.availability(t, s, d, minDay(addDays(d, 6), horizon))) {
            if (!slot.available) continue;
            out.push({ starts_at: iso(slot.starts_at), local_day: slot.local_day, local_time: slot.local_time });
            if (out.length >= limit) break;
          }
        }
        return out;
      }
      case 'create_booking': {
        const t = this.tenantBySlug(String(a.p_slug));
        const { b, replayed } = this.createBooking(t, String(a.p_service_id), Date.parse(String(a.p_starts_at)),
          String(a.p_client_name ?? ''), String(a.p_client_phone ?? ''), String(a.p_car ?? ''), String(a.p_comment ?? ''),
          String(a.p_idempotency_key ?? ''), 'client', null, false);
        return { booking: this.bookingJson(b), token: this.tokens.get(b.id), replayed };
      }
      case 'get_booking':
        return this.bookingJson(byToken());
      case 'cancel_my_booking': {
        const b = byToken();
        const t = this.tenants.find((x) => x.id === b.tenant_id)!;
        if (b.status === 'cancelled') return this.bookingJson(b);
        if (!this.canClientCancel(b, t)) {
          if (b.status === 'confirmed') fail('cancel_too_late', `Онлайн-отмена возможна не позднее чем за ${t.cancel_cutoff_hours} ч. Позвоните в студию: ${t.phone}`);
          fail('cannot_cancel', 'Эту запись уже нельзя отменить');
        }
        return this.bookingJson(this.cancel(t.id, b.id, 'client', str('p_reason')));
      }
      case 'save_booking_push':
        byToken();
        return { saved: true, delivers: false, reminder_at: null };

      // ---------------- owner reads
      case 'owner_me': {
        if (!userId) return [];
        return this.owners.filter((o) => o.user_id === userId).map((o) => {
          const t = this.tenants.find((x) => x.id === o.tenant_id)!;
          return { slug: t.slug, name: t.name, role: 'owner', status: t.status };
        });
      }
      case 'owner_settings': {
        const t = member();
        const td = today(t.timezone);
        return {
          tenant: { ...this.publicTenant(t), min_lead_minutes: t.min_lead_minutes, config_version: t.config_version,
            published_at: t.published_at, activated_at: t.activated_at },
          today: td,
          resources: this.resources.filter((r) => r.tenant_id === t.id).sort((x, y) => x.sort - y.sort)
            .map(({ id, key, name, active, sort, source }) => ({ id, key, name, active, sort, source })),
          services: this.services.filter((s) => s.tenant_id === t.id).sort((x, y) => x.sort - y.sort)
            .map(({ tenant_id: _t, ...s }) => ({ ...s, resource_ids: [...s.resource_ids] })),
          working_hours: this.publicTenant(t).working_hours,
          exceptions: this.exceptions.filter((e) => e.tenant_id === t.id && e.day >= addDays(td, -7)).sort((x, y) => x.day.localeCompare(y.day))
            .map(({ id, day, closed, opens, closes, note }) => ({ id, day, closed, opens, closes, note })),
          info_cards: this.cards.filter((c) => c.tenant_id === t.id).sort((x, y) => x.position - y.position)
            .map(({ position, icon, title, body, source }) => ({ position, icon, title, body, source })),
          gallery: this.gallery.filter((g) => g.tenant_id === t.id && !g.removed).sort((x, y) => x.sort - y.sort)
            .map(({ id, image_path, caption, source, sort }) => ({ id, image_path, caption, source, sort })),
          blocks: this.blocks.filter((b) => b.tenant_id === t.id && !b.removed && b.ends_at > Date.now() - 86_400_000)
            .sort((x, y) => x.starts_at - y.starts_at)
            .map((b) => ({ id: b.id, resource_id: b.resource_id, starts_at: iso(b.starts_at), ends_at: iso(b.ends_at), reason: b.reason })),
        };
      }
      case 'owner_bookings': {
        const t = member();
        const from = Date.parse(String(a.p_from));
        const to = Date.parse(String(a.p_to));
        if (to <= from || to - from > 62 * 86_400_000) fail('invalid_range', 'Диапазон до двух месяцев');
        return this.bookings
          .filter((b) => b.tenant_id === t.id && b.starts_at < to && b.occupied_until > from)
          .sort((x, y) => x.starts_at - y.starts_at)
          .map((b) => {
            const pays = this.payments.filter((p) => p.booking_id === b.id);
            const sum = (k: string) => pays.filter((p) => p.kind === k).reduce((s, p) => s + p.amount_cents, 0);
            return {
              id: b.id, status: b.status, starts_at: iso(b.starts_at), ends_at: iso(b.ends_at), occupied_until: iso(b.occupied_until),
              service_id: b.service_id, service_name: b.service_name, resource_id: b.resource_id,
              resource_name: this.resources.find((r) => r.id === b.resource_id)!.name, price_cents: b.price_cents,
              price_is_from: b.price_is_from, client_name: b.client_name, client_phone: b.client_phone, car: b.car,
              comment: b.comment, source: b.source, is_demo: b.is_demo, created_at: iso(b.created_at),
              arrived_at: iso(b.arrived_at), completed_at: iso(b.completed_at), cancelled_at: iso(b.cancelled_at),
              cancelled_by: b.cancelled_by, cancel_reason: b.cancel_reason, paid_cents: sum('payment'), refunded_cents: sum('refund'),
            };
          });
      }
      case 'owner_booking_payments': {
        const t = member();
        return this.payments.filter((p) => p.tenant_id === t.id && p.booking_id === a.p_booking_id)
          .sort((x, y) => x.created_at - y.created_at)
          .map((p) => ({ id: p.id, kind: p.kind, amount_cents: p.amount_cents, method: p.method, note: p.note, created_at: iso(p.created_at) }));
      }
      case 'owner_stats': {
        const t = member();
        let from: string, to: string, label: string;
        if (a.p_period) [from, to, label] = this.periodDays(String(a.p_period), t.timezone);
        else {
          from = String(a.p_from); to = String(a.p_to); label = 'Период';
          if (!a.p_from || !a.p_to || to < from || dayDiff(to, from) > 366) fail('invalid_range', 'Неверный период');
        }
        return { ...this.stats(t, from, to), label, period: a.p_period ?? null };
      }

      // ---------------- owner writes
      case 'owner_create_booking': {
        const t = member();
        const { b, replayed } = this.createBooking(t, String(a.p_service_id), Date.parse(String(a.p_starts_at)),
          String(a.p_client_name ?? ''), String(a.p_client_phone ?? ''), String(a.p_car ?? ''), String(a.p_comment ?? ''),
          String(a.p_idempotency_key ?? ''), 'owner', str('p_resource_id'), Boolean(a.p_allow_off_grid));
        return { booking: this.bookingJson(b), replayed };
      }
      case 'owner_reschedule_booking': {
        const t = member();
        return this.bookingJson(this.reschedule(t, String(a.p_booking_id), Date.parse(String(a.p_new_start)), str('p_resource_id'), Boolean(a.p_allow_off_grid)));
      }
      case 'owner_cancel_booking': {
        const t = member();
        return this.bookingJson(this.cancel(t.id, String(a.p_booking_id), 'owner', str('p_reason')));
      }
      case 'owner_set_booking_status': {
        const t = member();
        const b = ownBooking(t);
        const to = String(a.p_status) as Status;
        if (b.status === to) return this.bookingJson(b);
        const ok = (b.status === 'confirmed' && ['arrived', 'completed', 'no_show'].includes(to))
          || (b.status === 'arrived' && ['completed', 'confirmed'].includes(to))
          || (b.status === 'completed' && to === 'arrived');
        if (!ok) fail('invalid_transition', `Нельзя перевести запись из «${b.status}» в «${to}»`);
        const now = Date.now();
        b.arrived_at = ['arrived', 'completed'].includes(to) ? (b.arrived_at ?? now) : to === 'confirmed' ? null : b.arrived_at;
        b.completed_at = to === 'completed' ? now : to === 'arrived' ? null : b.completed_at;
        b.status = to;
        if (to === 'no_show') this.release(b.id);
        if (to === 'completed') {
          for (const o of this.occupancies) if (o.booking_id === b.id && !o.released && o.to > now) o.to = Math.max(now, o.from + MIN);
        }
        return this.bookingJson(b);
      }
      case 'owner_add_payment': {
        const t = member();
        const kind = String(a.p_kind) as 'payment' | 'refund';
        const amount = Number(a.p_amount_cents);
        if (!['payment', 'refund'].includes(kind)) fail('invalid_request', 'kind');
        if (!(amount > 0) || amount > 100_000_000) fail('invalid_amount', 'Сумма должна быть больше нуля');
        const dup = this.payments.find((p) => p.tenant_id === t.id && p.idempotency_key === a.p_idempotency_key);
        if (dup) return { ...dup, created_at: iso(dup.created_at) };
        const b = ownBooking(t);
        const pays = this.payments.filter((p) => p.booking_id === b.id);
        const paid = pays.filter((p) => p.kind === 'payment').reduce((s, p) => s + p.amount_cents, 0);
        const refunded = pays.filter((p) => p.kind === 'refund').reduce((s, p) => s + p.amount_cents, 0);
        if (kind === 'refund' && amount > paid - refunded) fail('refund_exceeds_paid', 'Возврат больше полученной суммы');
        const p: Payment = {
          id: uuid(), tenant_id: t.id, booking_id: b.id, kind, amount_cents: amount, method: String(a.p_method ?? 'cash'),
          note: String(a.p_note ?? '').trim().slice(0, 200), idempotency_key: String(a.p_idempotency_key ?? uuid()), created_at: Date.now(),
        };
        this.payments.push(p);
        return { ...p, created_at: iso(p.created_at) };
      }
      case 'owner_block_resource': {
        const t = member();
        const rid = String(a.p_resource_id);
        if (!this.resources.some((r) => r.id === rid && r.tenant_id === t.id)) fail('resource_not_found', 'Пост не найден');
        const from = Date.parse(String(a.p_starts_at));
        const to = Date.parse(String(a.p_ends_at));
        if (to <= from || to - from > 60 * 86_400_000) fail('invalid_range', 'Проверьте период блокировки');
        if (!this.isFree(t, rid, from, to)) fail('slot_taken', 'На это время на посту уже есть записи. Перенесите их или выберите другой период.');
        const blk: Block = { id: uuid(), tenant_id: t.id, resource_id: rid, starts_at: from, ends_at: to, reason: String(a.p_reason ?? '').trim().slice(0, 200), removed: false };
        this.blocks.push(blk);
        this.occupancies.push({ tenant_id: t.id, resource_id: rid, block_id: blk.id, from, to, released: false });
        return { id: blk.id, resource_id: rid, starts_at: iso(from), ends_at: iso(to), reason: blk.reason };
      }
      case 'owner_remove_block': {
        const t = member();
        for (const b of this.blocks) if (b.id === a.p_block_id && b.tenant_id === t.id) b.removed = true;
        for (const o of this.occupancies) if (o.block_id === a.p_block_id) o.released = true;
        return { ok: true };
      }
      case 'owner_update_tenant': {
        const t = member();
        const patch = (a.p_patch ?? {}) as Record<string, unknown>;
        const allowed = ['name', 'short_name', 'tagline', 'description', 'address', 'map_url', 'phone', 'messenger_url',
          'cancellation_policy', 'cancel_cutoff_hours', 'min_lead_minutes', 'max_days_ahead', 'logo_path', 'hero_path'];
        for (const k of Object.keys(patch)) {
          if (!allowed.includes(k)) fail('invalid_field', k);
          const v = patch[k];
          (t as unknown as Record<string, unknown>)[k] = ['map_url', 'messenger_url'].includes(k) ? (v || null)
            : ['cancel_cutoff_hours', 'min_lead_minutes', 'max_days_ahead'].includes(k) ? Number(v) : v;
        }
        return t;
      }
      case 'owner_set_working_hours': {
        const t = member();
        const hours = a.p_hours as { weekday: number; opens: string; closes: string }[];
        if (!Array.isArray(hours) || hours.length > 21) fail('invalid_hours', 'Неверный формат расписания');
        for (const h of hours) if (toMin(h.closes) <= toMin(h.opens)) fail('invalid_hours', 'Время закрытия должно быть позже открытия');
        this.hours = this.hours.filter((h) => h.tenant_id !== t.id).concat(hours.map((h) => ({ tenant_id: t.id, weekday: Number(h.weekday), opens: h.opens.slice(0, 5), closes: h.closes.slice(0, 5) })));
        return { ok: true };
      }
      case 'owner_upsert_exception': {
        const t = member();
        const day = String(a.p_day);
        const closed = Boolean(a.p_closed);
        this.exceptions = this.exceptions.filter((e) => !(e.tenant_id === t.id && e.day === day));
        this.exceptions.push({ id: this.exceptionSeq++, tenant_id: t.id, day, closed, opens: closed ? null : (str('p_opens')?.slice(0, 5) ?? null),
          closes: closed ? null : (str('p_closes')?.slice(0, 5) ?? null), note: String(a.p_note ?? '').trim().slice(0, 120) });
        return { ok: true };
      }
      case 'owner_delete_exception': {
        const t = member();
        this.exceptions = this.exceptions.filter((e) => !(e.tenant_id === t.id && e.day === a.p_day));
        return { ok: true };
      }
      case 'owner_upsert_resource': {
        const t = member();
        if (!a.p_resource_id) {
          const r: Resource = { id: uuid(), tenant_id: t.id, key: `own-${uuid().slice(0, 10)}`, name: String(a.p_name ?? '').trim(),
            active: a.p_active === null || a.p_active === undefined ? true : Boolean(a.p_active),
            sort: Math.max(0, ...this.resources.filter((x) => x.tenant_id === t.id).map((x) => x.sort)) + 1, source: 'owner' };
          this.resources.push(r);
          return r;
        }
        const r = this.resources.find((x) => x.id === a.p_resource_id && x.tenant_id === t.id) ?? fail('resource_not_found', 'Пост не найден');
        if (String(a.p_name ?? '').trim()) r.name = String(a.p_name).trim();
        if (a.p_active !== null && a.p_active !== undefined) r.active = Boolean(a.p_active);
        return r;
      }
      case 'owner_upsert_service': {
        const t = member();
        const f = (a.p_fields ?? {}) as Record<string, unknown>;
        const num = (k: string) => (f[k] === undefined || f[k] === null ? undefined : Number(f[k]));
        let s: Service;
        if (!a.p_service_id) {
          s = {
            id: uuid(), tenant_id: t.id, key: `own-${uuid().slice(0, 10)}`, name: String(f.name ?? '').trim(),
            description: String(f.description ?? ''), category: String(f.category ?? ''), duration_minutes: num('duration_minutes') ?? 60,
            buffer_minutes: num('buffer_minutes') ?? 0, price_cents: num('price_cents') ?? 0, price_is_from: Boolean(f.price_is_from),
            image_path: (f.image_path as string) ?? null, active: f.active === undefined ? true : Boolean(f.active),
            sort: Math.max(0, ...this.services.filter((x) => x.tenant_id === t.id).map((x) => x.sort)) + 1, source: 'owner', resource_ids: [],
          };
          this.services.push(s);
        } else {
          s = this.services.find((x) => x.id === a.p_service_id && x.tenant_id === t.id) ?? fail('service_not_found', 'Услуга не найдена');
          if (String(f.name ?? '').trim()) s.name = String(f.name).trim();
          if (f.description !== undefined) s.description = String(f.description);
          if (f.category !== undefined) s.category = String(f.category);
          s.duration_minutes = num('duration_minutes') ?? s.duration_minutes;
          s.buffer_minutes = num('buffer_minutes') ?? s.buffer_minutes;
          s.price_cents = num('price_cents') ?? s.price_cents;
          if (f.price_is_from !== undefined) s.price_is_from = Boolean(f.price_is_from);
          if ('image_path' in f) s.image_path = (f.image_path as string) ?? null;
          if (f.active !== undefined) s.active = Boolean(f.active);
        }
        if (Array.isArray(a.p_resource_ids)) s.resource_ids = [...(a.p_resource_ids as string[])];
        const { tenant_id: _t, ...rest } = s;
        return rest;
      }
      case 'owner_update_info_card': {
        const t = member();
        const pos = Number(a.p_position);
        let c = this.cards.find((x) => x.tenant_id === t.id && x.position === pos);
        if (!c) {
          c = { tenant_id: t.id, position: pos, icon: 'Sparkle', title: '', body: '', source: 'owner' };
          this.cards.push(c);
        }
        Object.assign(c, { icon: String(a.p_icon || 'Sparkle'), title: String(a.p_title ?? '').trim(), body: String(a.p_body ?? '').trim(), source: 'owner' });
        return c;
      }
      case 'owner_add_gallery_item': {
        const t = member();
        if (this.gallery.filter((g) => g.tenant_id === t.id && !g.removed).length >= 40) fail('gallery_full', 'В галерее уже 40 работ');
        const g: GalleryItem = { id: uuid(), tenant_id: t.id, image_path: String(a.p_image_path), caption: String(a.p_caption ?? '').trim().slice(0, 120),
          sort: Math.max(0, ...this.gallery.filter((x) => x.tenant_id === t.id).map((x) => x.sort)) + 1, source: 'owner', removed: false };
        this.gallery.push(g);
        return g;
      }
      case 'owner_update_gallery_item': {
        const t = member();
        const g = this.gallery.find((x) => x.id === a.p_item_id && x.tenant_id === t.id && !x.removed) ?? fail('gallery_item_not_found', 'Карточка не найдена');
        if (a.p_image_path) g.image_path = String(a.p_image_path);
        if (a.p_caption !== null && a.p_caption !== undefined) g.caption = String(a.p_caption).trim().slice(0, 120);
        g.source = 'owner';
        return g;
      }
      case 'owner_remove_gallery_item': {
        const t = member();
        for (const g of this.gallery) if (g.id === a.p_item_id && g.tenant_id === t.id) g.removed = true;
        return { ok: true };
      }
      case 'owner_save_push':
        member();
        return { saved: true, delivers: false };
      default:
        return fail('not_found', `Функция ${fn} недоступна в демо`);
    }
  }
}
