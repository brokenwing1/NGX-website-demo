// pnpm tenant:publish <slug> [--force] [--owner-email you@studio.ru] [--owner-password ...] [--reset-password]
//
// 1. validates tenants/<slug>/business.json and images
// 2. creates the tenant (status "preview") or updates it in place
// 3. uploads optimised images to Storage (content-addressed, so re-runs are cheap)
// 4. applies the config in one SQL transaction (bookings, payments, owner photos and owner edits are kept)
// 5. generates install assets in public/s/<slug>/ (icons, manifest, iOS splash screens)
// 6. optionally creates the owner account and grants membership
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toPublishConfig } from '../lib/business-schema.ts';
import { connectDb, ensureOwnerUser, generatePassword, mediaExists, uploadMedia } from '../lib/backend.ts';
import { isMain, log, optionalEnv, parseArgs } from '../lib/env.ts';
import { generateInstallAssets, processImage } from '../lib/images.ts';
import { loadBusiness, tenantDir } from '../lib/tenant-files.ts';
import { validateTenant } from './validate.ts';

export interface PublishOptions {
  force?: boolean;
  ownerEmail?: string;
  ownerPassword?: string;
  resetPassword?: boolean;
  quiet?: boolean;
}

export async function publishTenant(slug: string, opts: PublishOptions = {}) {
  if (!(await validateTenant(slug))) {
    throw new Error('Исправьте ошибки в business.json и запустите снова');
  }
  const b = loadBusiness(slug).business!;
  const db = connectDb();
  try {
    log.step('Студия в базе');
    const tenantRows = await db<{ id: string }[]>`
      select app.ensure_tenant(${b.slug}, ${b.name}, ${b.shortName}, ${b.timezone}) as id`;
    const tenantId = tenantRows[0]!.id;
    log.ok(`tenant_id ${tenantId}`);

    log.step('Изображения → Storage');
    const dir = tenantDir(slug);
    const upload = async (rel: string, preset: Parameters<typeof processImage>[1], name: string) => {
      const img = await processImage(join(dir, rel), preset);
      const path = `${tenantId}/config/${name}-${img.hash}.${img.ext}`;
      if (await mediaExists(path)) {
        log.info(`= ${rel}`);
      } else {
        await uploadMedia(path, img.buffer, img.contentType);
        log.ok(`${rel} → ${path} (${Math.round(img.buffer.length / 1024)} КБ)`);
      }
      return path;
    };
    const media = {
      hero: await upload(b.media.hero, 'hero', 'hero'),
      logo: await upload(b.media.logo, 'logo', 'logo'),
      services: Object.fromEntries(
        await Promise.all(b.services.filter((s) => s.image).map(async (s) => [s.key, await upload(s.image!, 'service', `service-${s.key}`)])),
      ),
      gallery: Object.fromEntries(
        await Promise.all(b.gallery.map(async (g) => [g.key, await upload(g.image, 'gallery', `gallery-${g.key}`)])),
      ),
    };

    log.step('Применение настроек');
    const config = toPublishConfig(b);
    const reportRows = await db<{ report: Record<string, unknown> }[]>`
      select app.publish_tenant(${db.json(config as never)}, ${db.json(media as never)}, ${!!opts.force}) as report`;
    const report = reportRows[0]!.report;
    const kept = (report.kept_owner_changes as string[]) ?? [];
    const deactivated = (report.deactivated as string[]) ?? [];
    log.ok(`версия конфига ${report.config_version}, статус ${report.status}`);
    if (kept.length) log.warn(`сохранены изменения владельца: ${kept.join(', ')} (перезаписать: --force)`);
    if (deactivated.length) log.warn(`скрыты (убраны из конфига): ${deactivated.join(', ')}`);

    log.step('Иконки и настройки установки');
    const assetsVersion = createHash('sha256')
      .update(readFileSync(join(dir, b.media.icon)))
      .update(b.name + b.shortName + b.theme.accent)
      .digest('hex')
      .slice(0, 10);
    await generateInstallAssets(b, assetsVersion);
    log.ok(`public/s/${slug}/ (manifest, иконки, заставки iOS) v${assetsVersion}`);

    if (opts.ownerEmail) {
      log.step('Владелец');
      const owner = await ensureOwnerUser(db, opts.ownerEmail, opts.ownerPassword ?? (opts.resetPassword ? generatePassword() : undefined));
      await db`select app.add_member(${tenantId}, ${owner.userId}, 'owner')`;
      log.ok(`${opts.ownerEmail} — ${owner.created ? 'создан' : 'уже был'}, доступ к студии выдан`);
      if (owner.password && !opts.quiet) {
        log.info(`Пароль (показывается один раз): ${owner.password}`);
      }
    }

    const site = optionalEnv('PUBLIC_SITE_URL') ?? 'http://localhost:5173';
    log.step('Готово');
    log.info(`Клиенты:  ${site}/s/${slug}/`);
    log.info(`Кабинет:  ${site}/s/${slug}/owner/`);
    if (report.status === 'preview') {
      log.info('Студия в режиме образца: записи помечаются как демо, уведомления не отправляются.');
      log.info(`После сборки и деплоя: pnpm tenant:verify ${slug} --url ${site} --activate`);
    }
    return { tenantId, report };
  } finally {
    await db.end({ timeout: 5 });
  }
}

async function main() {
  const { positional, flags } = parseArgs();
  const slug = positional[0];
  if (!slug) {
    console.error('Использование: pnpm tenant:publish <slug> [--force] [--owner-email email] [--owner-password pwd] [--reset-password]');
    process.exit(2);
  }
  try {
    await publishTenant(slug, {
      force: !!flags.force,
      ownerEmail: typeof flags['owner-email'] === 'string' ? flags['owner-email'] : undefined,
      ownerPassword: typeof flags['owner-password'] === 'string' ? flags['owner-password'] : undefined,
      resetPassword: !!flags['reset-password'],
    });
  } catch (e) {
    log.fail((e as Error).message);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) {
  await main();
}
