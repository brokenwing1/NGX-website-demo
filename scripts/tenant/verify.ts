// pnpm tenant:verify <slug> [--url https://your-site] [--activate]
//
// Checks a published studio end to end and, with --activate, switches it from preview to live:
//   • business readiness in the database (phone, address, hours, services with resources, owner…)
//   • public API through the same HTTP endpoint the app uses (anon key): studio data + free slots
//   • HTML shell for /s/<slug>/ and a deep link (/s/<slug>/owner/) has the right title & manifest
//   • manifest id/start_url/scope, icons, apple-touch-icon, service worker
// Without --url the built files in dist/ are checked instead of a running site.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectDb } from '../lib/backend.ts';
import { ROOT, env, isMain, log, parseArgs } from '../lib/env.ts';

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
  warnOnly?: boolean;
}

async function rpc(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${env('SUPABASE_URL', process.env.VITE_SUPABASE_URL)}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: env('SUPABASE_ANON_KEY', process.env.VITE_SUPABASE_ANON_KEY),
      Authorization: `Bearer ${env('SUPABASE_ANON_KEY', process.env.VITE_SUPABASE_ANON_KEY)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}

async function getText(base: string | undefined, path: string): Promise<{ status: number; text: string; type: string }> {
  if (base) {
    const res = await fetch(new URL(path, base), { redirect: 'follow' });
    return { status: res.status, text: await res.text(), type: res.headers.get('content-type') ?? '' };
  }
  // Built output: resolve like the static host does (vercel.json rewrites /s/<slug>/* to the shell).
  let file = join(ROOT, 'dist', path.split('?')[0]!);
  const m = /^\/s\/([^/]+)\/(.*)$/.exec(path);
  if (!existsSync(file) || path.endsWith('/')) {
    if (m && !/\.[a-z0-9]+$/i.test(m[2]!)) file = join(ROOT, 'dist/s', m[1]!, 'index.html');
    else if (path.endsWith('/')) file = join(file, 'index.html');
  }
  if (!existsSync(file)) return { status: 404, text: '', type: '' };
  const ext = file.split('.').pop();
  const type = ext === 'html' ? 'text/html' : ext === 'png' ? 'image/png' : ext === 'webmanifest' ? 'application/manifest+json' : 'application/javascript';
  return { status: 200, text: readFileSync(file, 'latin1'), type };
}

export async function verifyTenant(slug: string, opts: { url?: string; activate?: boolean }) {
  const checks: Check[] = [];
  const add = (c: Check) => {
    checks.push(c);
    (c.ok ? log.ok : c.warnOnly ? log.warn : log.fail)(`${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  };

  const db = connectDb();
  try {
    log.step('Бизнес-настройки');
    const problems = (await db<{ problems: string[] }[]>`select app.tenant_readiness(${slug}) as problems`)[0]!.problems;
    add({ name: 'настройки готовы к запуску', ok: problems.length === 0, detail: problems.join('; ') || undefined });
    const [row] = await db<{ status: string; name: string }[]>`select status, name from public.tenants where slug = ${slug}`;
    if (!row) throw new Error(`Студия ${slug} не опубликована: pnpm tenant:publish ${slug}`);

    log.step('Публичный API');
    const pub = await rpc('get_tenant_public', { p_slug: slug });
    const t = pub.body as { name?: string; services?: { id: string; name: string }[] };
    add({ name: 'данные студии отдаются анонимно', ok: pub.status === 200 && t?.name === row.name, detail: `HTTP ${pub.status}` });
    const leaks = JSON.stringify(pub.body ?? '').match(/client_phone|client_name|token/g);
    add({ name: 'в публичных данных нет персональных полей', ok: !leaks, detail: leaks?.join(',') });
    const svc = t?.services?.[0];
    if (svc) {
      const slots = await rpc('get_nearest_slots', { p_slug: slug, p_service_id: svc.id, p_limit: 3 });
      const n = Array.isArray(slots.body) ? slots.body.length : 0;
      add({ name: `ближайшее время для «${svc.name}»`, ok: slots.status === 200 && n > 0, detail: `${n} слотов`, warnOnly: slots.status === 200 });
    } else {
      add({ name: 'есть услуги для записи', ok: false });
    }

    log.step(opts.url ? `Сайт ${opts.url}` : 'Собранные файлы (dist/)');
    const shell = await getText(opts.url, `/s/${slug}/`);
    add({ name: `оболочка /s/${slug}/`, ok: shell.status === 200 && shell.type.includes('html'), detail: `HTTP ${shell.status}` });
    add({ name: 'заголовок и manifest студии в HTML', ok: shell.text.includes(`/s/${slug}/manifest.webmanifest`) && shell.text.includes('<title>') });
    add({ name: 'apple-touch-icon и заставки iOS', ok: shell.text.includes(`/s/${slug}/apple-touch-icon.png`) && shell.text.includes('apple-touch-startup-image') });
    const deep = await getText(opts.url, `/s/${slug}/owner/`);
    add({ name: 'глубокая ссылка /owner/ отдаёт оболочку этой студии', ok: deep.status === 200 && deep.text.includes(`/s/${slug}/manifest.webmanifest`) });
    const deep2 = await getText(opts.url, `/s/${slug}/my/00000000-0000-0000-0000-000000000000`);
    add({ name: 'глубокая ссылка на запись отдаёт оболочку', ok: deep2.status === 200 && deep2.text.includes(`/s/${slug}/manifest.webmanifest`) });

    const man = await getText(opts.url, `/s/${slug}/manifest.webmanifest`);
    let manifest: Record<string, unknown> = {};
    try {
      manifest = JSON.parse(man.text);
    } catch {
      /* invalid */
    }
    add({
      name: 'manifest: id, start_url, scope',
      ok: manifest.id === `/s/${slug}/` && manifest.scope === `/s/${slug}/` && String(manifest.start_url).startsWith(`/s/${slug}/`),
    });
    const icons = (manifest.icons as { src: string; purpose?: string }[]) ?? [];
    add({ name: 'иконки any + maskable', ok: icons.some((i) => i.purpose === 'maskable') && icons.some((i) => i.purpose === 'any') });
    for (const path of [`/s/${slug}/icon-192.png`, `/s/${slug}/maskable-512.png`, `/s/${slug}/apple-touch-icon.png`]) {
      const r = await getText(opts.url, path);
      add({ name: path, ok: r.status === 200 && r.type.includes('png'), detail: `HTTP ${r.status}` });
    }
    const sw = await getText(opts.url, '/sw.js');
    add({ name: 'service worker /sw.js', ok: sw.status === 200 && sw.text.includes('precache') });

    const failed = checks.filter((c) => !c.ok && !c.warnOnly);
    log.step(failed.length ? `Проверок не пройдено: ${failed.length}` : 'Все проверки пройдены');

    if (opts.activate) {
      if (failed.length) {
        log.fail('Студия остаётся образцом (preview). Исправьте ошибки выше.');
      } else if (row.status === 'live') {
        log.ok('Студия уже работает в боевом режиме');
      } else {
        const res = (await db<{ res: { activated: boolean; demo_bookings_removed?: number; problems?: string[] } }[]>`
          select app.activate_tenant(${slug}) as res`)[0]!.res;
        if (res.activated) log.ok(`Студия запущена. Удалено демо-записей: ${res.demo_bookings_removed}`);
        else log.fail(`Не запущена: ${(res.problems ?? []).join('; ')}`);
      }
    }
    return { ok: failed.length === 0, checks };
  } finally {
    await db.end({ timeout: 5 });
  }
}

async function main() {
  const { positional, flags } = parseArgs();
  const slug = positional[0];
  if (!slug) {
    console.error('Использование: pnpm tenant:verify <slug> [--url https://site] [--activate]');
    process.exit(2);
  }
  try {
    const res = await verifyTenant(slug, { url: typeof flags.url === 'string' ? flags.url : undefined, activate: !!flags.activate });
    process.exit(res.ok ? 0 : 1);
  } catch (e) {
    log.fail((e as Error).message);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) {
  await main();
}
