// Schema of tenants/<slug>/business.json — the single input file of the studio pipeline.
// Human-friendly on the outside (rubles, "1h30m", "09:00-21:00"), normalised for SQL on the inside.
import { z } from 'zod';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const KEY = /^[a-z0-9][a-z0-9-]{0,40}$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const TIME_RANGE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-4]):([0-5]\d)$/;
const DURATION = /^(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?$/;
const IMAGE = /^images\/[A-Za-z0-9._/-]+\.(?:jpe?g|png|webp)$/;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export function parseDuration(v: number | string): number {
  if (typeof v === 'number') return v;
  const m = DURATION.exec(v.trim());
  if (!m || v.trim() === '') throw new Error(`Неверная длительность "${v}" (пример: 90, "1h30m", "2d")`);
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

const duration = z.union([z.number().int().positive(), z.string().regex(DURATION, 'пример: 90, "1h30m", "2d"')]);
const bufferDuration = z.union([z.number().int().nonnegative(), z.string().regex(DURATION, 'пример: 15, "1h"')]);

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const businessSchema = z
  .object({
    $schema: z.string().optional(),
    slug: z.string().regex(SLUG, 'латиница, цифры и дефис, 3–40 символов'),
    name: z.string().min(1).max(80),
    shortName: z.string().min(1).max(24),
    tagline: z.string().max(140).default(''),
    description: z.string().max(2000).default(''),
    locale: z.string().default('ru-RU'),
    timezone: z.string().refine(isValidTimeZone, 'неизвестный часовой пояс (пример: Europe/Moscow)'),
    currency: z.string().regex(/^[A-Z]{3}$/).default('RUB'),
    contacts: z.object({
      address: z.string().min(5).max(200),
      phone: z.string().min(6).max(32),
      mapUrl: z.string().regex(/^https:\/\//).optional(),
      messengerUrl: z.string().regex(/^https:\/\//).optional(),
    }),
    theme: z.object({
      accent: z.string().regex(HEX, 'цвет в формате #RRGGBB'),
    }),
    booking: z.object({
      slotStepMinutes: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]).default(30),
      minLeadMinutes: z.number().int().min(0).max(10080).default(60),
      maxDaysAhead: z.number().int().min(1).max(180).default(30),
      cancelCutoffHours: z.number().int().min(0).max(168).default(3),
      cancellationPolicy: z.string().max(600).default(''),
    }),
    hours: z.object(
      Object.fromEntries(WEEKDAYS.map((d) => [d, z.array(z.string().regex(TIME_RANGE, 'формат "09:00-21:00"')).default([])])) as Record<
        (typeof WEEKDAYS)[number],
        z.ZodDefault<z.ZodArray<z.ZodString>>
      >,
    ),
    closedDates: z
      .array(z.object({ date: z.iso.date(), note: z.string().max(120).default('') }))
      .default([]),
    specialHours: z
      .array(z.object({ date: z.iso.date(), hours: z.array(z.string().regex(TIME_RANGE)).min(1), note: z.string().max(120).default('') }))
      .default([]),
    resources: z.array(z.object({ key: z.string().regex(KEY), name: z.string().min(1).max(60) })).min(1).max(30),
    services: z
      .array(
        z.object({
          key: z.string().regex(KEY),
          name: z.string().min(1).max(80),
          description: z.string().max(600).default(''),
          category: z.string().max(40).default(''),
          duration,
          buffer: bufferDuration.default(0),
          price: z.number().nonnegative().max(10_000_000),
          priceFrom: z.boolean().default(false),
          resources: z.array(z.string().regex(KEY)).min(1),
          image: z.string().regex(IMAGE).optional(),
        }),
      )
      .min(1)
      .max(60),
    infoCards: z
      .array(z.object({ icon: z.string().regex(/^[A-Za-z]{2,40}$/), title: z.string().min(1).max(40), text: z.string().max(160).default('') }))
      .length(3, 'нужно ровно три карточки'),
    gallery: z
      .array(z.object({ key: z.string().regex(KEY), image: z.string().regex(IMAGE), caption: z.string().max(120).default('') }))
      .max(40)
      .default([]),
    media: z.object({
      hero: z.string().regex(IMAGE),
      logo: z.string().regex(IMAGE),
      icon: z.string().regex(IMAGE),
      /** true when the icon artwork fills the whole square (the OS rounds/masks it as is) */
      iconFullBleed: z.boolean().default(false),
    }),
  })
  .superRefine((b, ctx) => {
    const resourceKeys = new Set(b.resources.map((r) => r.key));
    if (resourceKeys.size !== b.resources.length) ctx.addIssue({ code: 'custom', path: ['resources'], message: 'ключи постов повторяются' });
    const serviceKeys = new Set<string>();
    b.services.forEach((s, i) => {
      if (serviceKeys.has(s.key)) ctx.addIssue({ code: 'custom', path: ['services', i, 'key'], message: 'ключ услуги повторяется' });
      serviceKeys.add(s.key);
      for (const r of s.resources) {
        if (!resourceKeys.has(r)) ctx.addIssue({ code: 'custom', path: ['services', i, 'resources'], message: `нет поста "${r}"` });
      }
      try {
        const d = parseDuration(s.duration);
        if (d < 10 || d > 20160) ctx.addIssue({ code: 'custom', path: ['services', i, 'duration'], message: 'от 10 минут до 14 дней' });
        const buf = parseDuration(s.buffer);
        if (buf > 720) ctx.addIssue({ code: 'custom', path: ['services', i, 'buffer'], message: 'буфер не больше 12 часов' });
      } catch (e) {
        ctx.addIssue({ code: 'custom', path: ['services', i, 'duration'], message: (e as Error).message });
      }
    });
    const galleryKeys = new Set<string>();
    b.gallery.forEach((g, i) => {
      if (galleryKeys.has(g.key)) ctx.addIssue({ code: 'custom', path: ['gallery', i, 'key'], message: 'ключ фото повторяется' });
      galleryKeys.add(g.key);
    });
    let anyHours = false;
    for (const d of WEEKDAYS) {
      for (const [j, range] of b.hours[d].entries()) {
        anyHours = true;
        const [o, c] = range.split('-');
        if (c! <= o!) ctx.addIssue({ code: 'custom', path: ['hours', d, j], message: 'закрытие должно быть позже открытия' });
      }
    }
    if (!anyHours) ctx.addIssue({ code: 'custom', path: ['hours'], message: 'нужен хотя бы один рабочий день' });
  });

export type Business = z.output<typeof businessSchema>;

/** Normalised config consumed by app.publish_tenant(). */
export function toPublishConfig(b: Business) {
  const workingHours = WEEKDAYS.flatMap((d, idx) =>
    b.hours[d].map((range) => {
      const [opens, closes] = range.split('-');
      return { weekday: idx + 1, opens, closes };
    }),
  );
  const exceptions = [
    ...b.closedDates.map((c) => ({ day: c.date, closed: true, note: c.note })),
    ...b.specialHours.flatMap((s) =>
      s.hours.map((range) => {
        const [opens, closes] = range.split('-');
        return { day: s.date, closed: false, opens, closes, note: s.note };
      }),
    ),
  ];
  return {
    slug: b.slug,
    name: b.name,
    short_name: b.shortName,
    tagline: b.tagline,
    description: b.description,
    address: b.contacts.address,
    map_url: b.contacts.mapUrl ?? null,
    phone: b.contacts.phone,
    messenger_url: b.contacts.messengerUrl ?? null,
    timezone: b.timezone,
    currency: b.currency,
    locale: b.locale,
    accent_color: b.theme.accent.toUpperCase(),
    booking: {
      slot_step_minutes: b.booking.slotStepMinutes,
      min_lead_minutes: b.booking.minLeadMinutes,
      max_days_ahead: b.booking.maxDaysAhead,
      cancel_cutoff_hours: b.booking.cancelCutoffHours,
      cancellation_policy: b.booking.cancellationPolicy,
    },
    resources: b.resources.map((r) => ({ key: r.key, name: r.name })),
    services: b.services.map((s) => ({
      key: s.key,
      name: s.name,
      description: s.description,
      category: s.category,
      duration_minutes: parseDuration(s.duration),
      buffer_minutes: parseDuration(s.buffer),
      price_cents: Math.round(s.price * 100),
      price_is_from: s.priceFrom,
      resources: s.resources,
    })),
    working_hours: workingHours,
    exceptions,
    info_cards: b.infoCards.map((c) => ({ icon: c.icon, title: c.title, body: c.text })),
    gallery: b.gallery.map((g) => ({ key: g.key, caption: g.caption })),
  };
}

/** Relative luminance & contrast (WCAG 2.x). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

/** Best text colour on top of the accent. */
export function onAccent(accent: string): '#000000' | '#FFFFFF' {
  return contrastRatio(accent, '#000000') >= contrastRatio(accent, '#FFFFFF') ? '#000000' : '#FFFFFF';
}
