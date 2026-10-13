// Human formatting in the tenant's timezone (used in tool results and keyword-mode replies).
import type { OwnerBooking, OwnerStats, ServiceInfo, Slot, TenantInfo } from './types.ts';

export function money(cents: number, currency = 'RUB'): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
}

export function price(s: Pick<ServiceInfo, 'price_cents' | 'price_is_from'>, currency = 'RUB'): string {
  return `${s.price_is_from ? 'от ' : ''}${money(s.price_cents, currency)}`;
}

export function duration(minutes: number): string {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} ${d === 1 ? 'день' : d < 5 ? 'дня' : 'дней'}`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ');
}

export function slotLabel(iso: string, tz: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d);
  return `${day}, ${time}`;
}

export function timeOnly(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

const WD = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
export function hoursText(t: TenantInfo): string {
  const byDay = new Map<number, string[]>();
  for (const h of t.working_hours) byDay.set(h.weekday, [...(byDay.get(h.weekday) ?? []), `${h.opens}–${h.closes}`]);
  const parts: string[] = [];
  for (let d = 1; d <= 7; d++) parts.push(`${WD[d]} ${byDay.get(d)?.join(', ') ?? 'выходной'}`);
  return parts.join('; ');
}

export function servicesText(t: TenantInfo, list: ServiceInfo[] = t.services): string {
  return list.map((s) => `• ${s.name} — ${price(s, t.currency)}, ${duration(s.duration_minutes)}`).join('\n');
}

export function slotsText(t: TenantInfo, service: ServiceInfo, slots: Slot[]): string {
  if (slots.length === 0) return `На «${service.name}» в ближайшие дни свободного времени нет. Позвоните: ${t.phone}.`;
  return `Ближайшее свободное время на «${service.name}»: ${slots.map((s) => slotLabel(s.starts_at, t.timezone)).join('; ')}.`;
}

const STATUS: Record<string, string> = {
  confirmed: 'записан',
  arrived: 'на месте',
  completed: 'готово',
  cancelled: 'отменено',
  no_show: 'не приехал',
};

export function bookingsText(t: TenantInfo, label: string, list: OwnerBooking[]): string {
  const active = list.filter((b) => b.status !== 'cancelled');
  if (active.length === 0) return `${label}: записей нет.`;
  const lines = active.map(
    (b) => `• ${slotLabel(b.starts_at, t.timezone)} — ${b.service_name}, ${b.client_name} (${b.car}), ${b.resource_name}, ${STATUS[b.status] ?? b.status}`,
  );
  return `${label}: ${active.length} ${plural(active.length, 'запись', 'записи', 'записей')}.\n${lines.join('\n')}`;
}

export function statsText(s: OwnerStats): string {
  return [
    `${s.label} (${s.from} — ${s.to}):`,
    `заездов ${s.visits}, выполнено заказов ${s.completed_orders}, записей всего ${s.bookings_total}, отмен ${s.cancelled}, не приехали ${s.no_show}.`,
    `Получено денег: ${money(s.received_cents, s.currency)}${s.refunds_cents ? ` (с учётом возвратов ${money(s.refunds_cents, s.currency)})` : ''}.`,
    s.expected_cents ? `Ожидаемая стоимость будущих записей: ${money(s.expected_cents, s.currency)} — это ещё не выручка.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
