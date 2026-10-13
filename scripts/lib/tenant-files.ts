import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { businessSchema, contrastRatio, type Business } from './business-schema.ts';
import { ROOT } from './env.ts';

export const TENANTS_DIR = resolve(ROOT, 'tenants');
export const PUBLIC_TENANTS_DIR = resolve(ROOT, 'public/s');

export function tenantDir(slug: string) {
  return join(TENANTS_DIR, slug);
}

export function listTenantSlugs(): string[] {
  if (!existsSync(TENANTS_DIR)) return [];
  return readdirSync(TENANTS_DIR)
    .filter((d) => !d.startsWith('_') && !d.startsWith('.'))
    .filter((d) => existsSync(join(TENANTS_DIR, d, 'business.json')))
    .sort();
}

export interface LoadResult {
  ok: boolean;
  business?: Business;
  errors: string[];
  warnings: string[];
}

/** Parse + validate business.json and check referenced images exist. Image pixel checks live in images.ts. */
export function loadBusiness(slug: string): LoadResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const file = join(tenantDir(slug), 'business.json');
  if (!existsSync(file)) return { ok: false, errors: [`Нет файла ${file}`], warnings };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`business.json: неверный JSON — ${(e as Error).message}`], warnings };
  }
  const parsed = businessSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join('.') || '(корень)'}: ${issue.message}`);
    }
    return { ok: false, errors, warnings };
  }
  const b = parsed.data;
  if (b.slug !== slug) errors.push(`slug в файле ("${b.slug}") не совпадает с папкой ("${slug}")`);

  const images = [
    b.media.hero,
    b.media.logo,
    b.media.icon,
    ...b.services.flatMap((s) => (s.image ? [s.image] : [])),
    ...b.gallery.map((g) => g.image),
  ];
  for (const img of images) {
    const p = join(tenantDir(slug), img);
    if (!existsSync(p)) errors.push(`нет изображения ${img}`);
    else if (statSync(p).size > 15 * 1024 * 1024) errors.push(`${img}: файл больше 15 МБ`);
  }

  const onDark = contrastRatio(b.theme.accent, '#000000');
  if (onDark < 3) warnings.push(`акцент ${b.theme.accent} плохо виден на чёрном фоне (контраст ${onDark.toFixed(2)}:1, нужно ≥ 3)`);
  if (b.services.some((s) => s.price === 0)) warnings.push('есть услуги с ценой 0 — перед запуском проверьте');
  if (!b.services.some((s) => s.image)) warnings.push('у услуг нет фото — карточки будут без изображений');
  if (b.gallery.length < 3) warnings.push('в галерее меньше трёх работ');

  return { ok: errors.length === 0, business: b, errors, warnings };
}

export const tenantMetaSchema = z.object({
  slug: z.string(),
  name: z.string(),
  shortName: z.string(),
  description: z.string(),
  accent: z.string(),
  onAccent: z.string(),
  background: z.string(),
  lang: z.string(),
  assetsVersion: z.string(),
  startupImages: z.array(z.object({ href: z.string(), media: z.string() })),
});
export type TenantMeta = z.infer<typeof tenantMetaSchema>;
