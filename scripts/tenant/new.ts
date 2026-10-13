// pnpm tenant:new <slug> --name "Название студии" [--from <existing-slug>] [--accent #RRGGBB] [--timezone Europe/Moscow]
// Creates tenants/<slug>/ with business.json and starter images (from tenants/_template or another studio).
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, log, parseArgs } from '../lib/env.ts';
import { TENANTS_DIR, tenantDir } from '../lib/tenant-files.ts';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function createTenant(slug: string, opts: { name: string; from?: string; accent?: string; timezone?: string }) {
  if (!SLUG.test(slug)) throw new Error('slug: латиница, цифры и дефис, 3–40 символов (например studio-pro)');
  const target = tenantDir(slug);
  if (existsSync(target)) throw new Error(`Папка tenants/${slug} уже существует`);
  const source = opts.from ? tenantDir(opts.from) : join(TENANTS_DIR, '_template');
  if (!existsSync(join(source, 'business.json'))) throw new Error(`Нет шаблона ${source}/business.json`);

  cpSync(source, target, { recursive: true });
  const file = join(target, 'business.json');
  const b = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> & { theme: { accent: string } };
  b.slug = slug;
  b.name = opts.name;
  b.shortName = opts.name.length <= 24 ? opts.name : opts.name.slice(0, 24).trim();
  if (opts.accent) b.theme.accent = opts.accent;
  if (opts.timezone) b.timezone = opts.timezone;
  writeFileSync(file, JSON.stringify(b, null, 2) + '\n');
  return target;
}

async function main() {
  const { positional, flags } = parseArgs();
  const slug = positional[0];
  const name = typeof flags.name === 'string' ? flags.name : undefined;
  if (!slug || !name) {
    console.error('Использование: pnpm tenant:new <slug> --name "Название" [--from ngx-detailing] [--accent #4690FF] [--timezone Europe/Moscow]');
    process.exit(2);
  }
  try {
    const dir = createTenant(slug, {
      name,
      from: typeof flags.from === 'string' ? flags.from : undefined,
      accent: typeof flags.accent === 'string' ? flags.accent : undefined,
      timezone: typeof flags.timezone === 'string' ? flags.timezone : undefined,
    });
    log.ok(`Создано: ${dir}`);
    log.info('Дальше:');
    log.info(`1. Откройте tenants/${slug}/business.json — цены, адрес, телефон, часы, услуги.`);
    log.info(`2. Замените фото в tenants/${slug}/images/ (hero.jpg, logo.png, icon.png 1024×1024, услуги, галерея).`);
    log.info(`3. pnpm tenant:validate ${slug}`);
    log.info(`4. pnpm tenant:publish ${slug} --owner-email владелец@почта`);
  } catch (e) {
    log.fail((e as Error).message);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) {
  await main();
}
