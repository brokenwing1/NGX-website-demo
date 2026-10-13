// pnpm tenant:validate <slug> | --all
// Checks business.json against the schema, cross-references, image files and image sizes.
import { isMain, log, parseArgs } from '../lib/env.ts';
import { checkImages } from '../lib/images.ts';
import { listTenantSlugs, loadBusiness } from '../lib/tenant-files.ts';

export async function validateTenant(slug: string): Promise<boolean> {
  log.step(`Проверка tenants/${slug}`);
  const res = loadBusiness(slug);
  let errors = [...res.errors];
  let warnings = [...res.warnings];
  if (res.business) {
    const img = await checkImages(res.business);
    errors = errors.concat(img.errors);
    warnings = warnings.concat(img.warnings);
  }
  for (const e of errors) log.fail(e);
  for (const w of warnings) log.warn(w);
  if (errors.length === 0) {
    const b = res.business!;
    log.ok(`${b.name}: ${b.services.length} услуг, ${b.resources.length} постов, ${b.gallery.length} фото, часовой пояс ${b.timezone}`);
  }
  return errors.length === 0;
}

async function main() {
  const { positional, flags } = parseArgs();
  const slugs = flags.all ? listTenantSlugs() : positional;
  if (slugs.length === 0) {
    console.error('Использование: pnpm tenant:validate <slug> | --all');
    process.exit(2);
  }
  let ok = true;
  for (const s of slugs) ok = (await validateTenant(s)) && ok;
  process.exit(ok ? 0 : 1);
}

if (isMain(import.meta.url)) {
  await main();
}
