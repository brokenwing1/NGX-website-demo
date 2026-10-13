// Time helpers. All business times are shown in the STUDIO's timezone, not the device's.
import { addDays, format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export function fmt(iso: string | Date, tz: string, pattern: string): string {
  return formatInTimeZone(typeof iso === 'string' ? parseISO(iso) : iso, tz, pattern, { locale: ru });
}

export const fmtTime = (iso: string, tz: string) => fmt(iso, tz, 'HH:mm');
export const fmtDay = (iso: string, tz: string) => fmt(iso, tz, 'EEEEEE, d MMMM');
export const fmtDayTime = (iso: string, tz: string) => fmt(iso, tz, "EEEEEE, d MMMM, HH:mm");
export const fmtDayLong = (iso: string, tz: string) => fmt(iso, tz, 'EEEE, d MMMM');

/** Local calendar day (YYYY-MM-DD) of an instant in a timezone. */
export function localDay(iso: string | Date, tz: string): string {
  return fmt(iso, tz, 'yyyy-MM-dd');
}

/** Absolute ISO instant for a wall-clock day + time in the studio timezone. */
export function zonedToIso(day: string, time: string, tz: string): string {
  return fromZonedTime(`${day}T${time.length === 5 ? `${time}:00` : time}`, tz).toISOString();
}

export function addDaysStr(day: string, n: number): string {
  return format(addDays(parseISO(`${day}T12:00:00`), n), 'yyyy-MM-dd');
}

export function dayLabel(day: string, today: string): { top: string; bottom: string } {
  const d = parseISO(`${day}T12:00:00`);
  const top = day === today ? 'Сегодня' : day === addDaysStr(today, 1) ? 'Завтра' : format(d, 'EEEEEE', { locale: ru });
  return { top, bottom: format(d, 'd MMM', { locale: ru }).replace('.', '') };
}

export function weekdayIso(day: string): number {
  const wd = parseISO(`${day}T12:00:00`).getDay();
  return wd === 0 ? 7 : wd;
}

export function money(cents: number, currency = 'RUB'): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

export function priceLabel(cents: number, isFrom: boolean, currency = 'RUB'): string {
  return `${isFrom ? 'от ' : ''}${money(cents, currency)}`;
}

export function durationLabel(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} ${d === 1 ? 'день' : d < 5 ? 'дня' : 'дней'}`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ');
}

/** Is the studio open right now, and until when (local wall clock)? */
export function openState(
  hours: { weekday: number; opens: string; closes: string }[],
  exceptions: { day: string; closed: boolean; opens: string | null; closes: string | null }[],
  tz: string,
): { open: boolean; text: string } {
  const now = new Date();
  const today = localDay(now, tz);
  const time = fmt(now, tz, 'HH:mm');
  const ex = exceptions.filter((e) => e.day === today);
  const intervals = ex.length
    ? ex.filter((e) => !e.closed && e.opens && e.closes).map((e) => ({ opens: e.opens!, closes: e.closes! }))
    : hours.filter((h) => h.weekday === weekdayIso(today));
  const current = intervals.find((i) => time >= i.opens && time < i.closes);
  if (current) return { open: true, text: `Открыто до ${current.closes}` };
  const later = intervals.filter((i) => i.opens > time).sort((a, b) => a.opens.localeCompare(b.opens))[0];
  if (later) return { open: false, text: `Откроется в ${later.opens}` };
  return { open: false, text: 'Сегодня закрыто' };
}

export const WEEKDAYS_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Russian plural: plural(5, ['услуга', 'услуги', 'услуг']) → 'услуг'. */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
