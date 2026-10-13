// Publish through an authenticated Supabase CLI when no DB password is available.
// Usage: tsx scripts/tenant/publish-cli.ts <slug> <project-ref>
// Does not seed, activate tenants, reset passwords, or apply migrations.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/env.ts';
import { loadBusiness, tenantDir } from '../lib/tenant-files.ts';
import { toPublishConfig } from '../lib/business-schema.ts';
import { generateInstallAssets, processImage } from '../lib/images.ts';
import { validateTenant } from './validate.ts';

const [slug, ref] = process.argv.slice(2);
if (!slug || !/^[a-z0-9-]+$/.test(slug) || !ref || !/^[a-z]{20}$/.test(ref)) {
  throw new Error('Usage: publish-cli.ts <slug> <project-ref>');
}
function cli(args: string[]): unknown {
  const result = spawnSync(process.execPath, [join(ROOT, 'node_modules/supabase/dist/supabase.js'),
    ...args, '--output-format', 'json'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  // Never print captured output: API-key commands contain credentials.
  if (result.status !== 0) throw new Error(`Supabase ${args[0]} ${args[1]} failed (exit ${result.status})`);
  return JSON.parse(result.stdout);
}
function sql(value: unknown): string {
  return "'" + String(value).replace(/'/g, "''") + "'";
}
function query(statement: string): Record<string, unknown>[] {
  const result = cli(['db', 'query', '--linked', '--project-ref', ref!, statement]) as { rows: Record<string, unknown>[] };
  return result.rows;
}

if (!(await validateTenant(slug))) throw new Error('Tenant validation failed');
const b = loadBusiness(slug).business!;
const keys = cli(['projects', 'api-keys', '--project-ref', ref]) as { keys: { name: string; api_key: string }[] };
const key = keys.keys.find((k) => k.name === 'service_role')?.api_key;
if (!key || key.includes('*')) throw new Error('Service role key unavailable');
const projectUrl = `https://${ref}.supabase.co`;
const tenantId = query(`select app.ensure_tenant(${sql(b.slug)},${sql(b.name)},${sql(b.shortName)},${sql(b.timezone)}) as id`)[0]!.id as string;
const media: { hero: string; logo: string; services: Record<string, string>; gallery: Record<string, string> } = {
  hero: '', logo: '', services: {}, gallery: {},
};
const upload = async (path: string, preset: Parameters<typeof processImage>[1], name: string) => {
  const img = await processImage(join(tenantDir(slug), path), preset);
  const object = `${tenantId}/config/${name}-${img.hash}.${img.ext}`;
  const url = `${projectUrl}/storage/v1/object`;
  if (!(await fetch(`${url}/public/media/${object}`, { method: 'HEAD' })).ok) {
    const res = await fetch(`${url}/media/${object}`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`,
        'Content-Type': img.contentType, 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000' },
      body: new Uint8Array(img.buffer),
    });
    if (!res.ok) throw new Error(`Image upload failed: HTTP ${res.status}`);
  }
  console.log(`Uploaded ${path}`);
  return object;
};
media.hero = await upload(b.media.hero, 'hero', 'hero');
media.logo = await upload(b.media.logo, 'logo', 'logo');
for (const s of b.services) if (s.image) media.services[s.key] = await upload(s.image, 'service', `service-${s.key}`);
for (const g of b.gallery) media.gallery[g.key] = await upload(g.image, 'gallery', `gallery-${g.key}`);
console.log(query(`select app.publish_tenant(${sql(JSON.stringify(toPublishConfig(b)))}::jsonb,${sql(JSON.stringify(media))}::jsonb,false) as report`));
const version = createHash('sha256').update(readFileSync(join(tenantDir(slug), b.media.icon)))
  .update(b.name + b.shortName + b.theme.accent).digest('hex').slice(0, 10);
await generateInstallAssets(b, version);
console.log('Published configuration and install assets. Activation was not performed.');
