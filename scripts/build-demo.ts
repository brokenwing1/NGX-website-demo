// pnpm demo:build → dist-demo/autoservice-demo.html
// One self-contained HTML file with the real UI and an in-memory backend (src/demo/backend.ts):
// both demo studios, their photos (inlined), demo bookings and owner logins. Opens from disk or in a
// preview pane, no server and no database needed. For showing the product, not for production.
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { splashHtml } from '../build/splash.ts';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { toPublishConfig } from './lib/business-schema.ts';
import { log } from './lib/env.ts';
import { processImage } from './lib/images.ts';
import { loadBusiness, tenantDir } from './lib/tenant-files.ts';

const ROOT = resolve(import.meta.dirname, '..');
const STUDIOS = [
  { slug: 'ngx-detailing', email: 'owner+ngx@example.com', password: 'demo-ngx-2026' },
  { slug: 'tork-service', email: 'owner+tork@example.com', password: 'demo-tork-2026' },
];

const dataUrl = (buf: Buffer, type: string) => `data:${type};base64,${buf.toString('base64')}`;

async function main() {
  const tenants = [];
  const cards = [];
  for (const s of STUDIOS) {
    const res = loadBusiness(s.slug);
    if (!res.ok || !res.business) throw new Error(`${s.slug}: ${res.errors.join('; ')}`);
    const b = res.business;
    const dir = tenantDir(s.slug);
    const img = async (rel: string | undefined, preset: 'hero' | 'gallery' | 'service' | 'logo') => {
      if (!rel) return undefined;
      const p = await processImage(join(dir, rel), preset);
      return dataUrl(p.buffer, p.contentType);
    };
    const services: Record<string, string> = {};
    for (const svc of b.services) {
      const u = await img(svc.image, 'service');
      if (u) services[svc.key] = u;
    }
    const gallery: Record<string, string> = {};
    for (const g of b.gallery) {
      const u = await img(g.image, 'gallery');
      if (u) gallery[g.key] = u;
    }
    tenants.push({
      config: toPublishConfig(b),
      media: { hero: await img(b.media.hero, 'hero'), logo: await img(b.media.logo, 'logo'), services, gallery },
      owner: { email: s.email, password: s.password },
    });
    cards.push({ slug: b.slug, name: b.name, tagline: b.tagline, accent: b.theme.accent, email: s.email, password: s.password });
    log.ok(`${b.name}: ${b.services.length} услуг, ${Object.keys(gallery).length} фото`);
  }
  writeFileSync(join(ROOT, 'src/demo/data.generated.json'), JSON.stringify(tenants));

  log.step('vite build (demo)');
  execFileSync('npx', ['vite', 'build', '--config', 'vite.demo.config.ts'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEMO: '1', VITE_DEMO_STUDIOS: JSON.stringify(cards) },
  });

  // Inline the bundle: one file that works from file://, a chat preview or an email attachment.
  const out = join(ROOT, 'dist-demo');
  let html = readFileSync(join(out, 'index.html'), 'utf8');
  const assets = readdirSync(join(out, 'assets'));
  for (const f of assets) {
    const body = readFileSync(join(out, 'assets', f), 'utf8');
    if (f.endsWith('.css')) {
      html = html.replace(new RegExp(`<link rel="stylesheet"[^>]*href="[^"]*assets/${f}"[^>]*>`), () => `<style>${body}</style>`);
    } else if (f.endsWith('.js')) {
      const safe = body.replace(/<\/script/gi, '<\\/script');
      html = html.replace(new RegExp(`<script type="module"[^>]*src="[^"]*assets/${f}"[^>]*></script>`), () => `<script type="module">${safe}</script>`);
    }
  }
  // Installable like an app: iOS standalone metas + icon, a web manifest, and a launch splash with the logo.
  const first = STUDIOS[0]!;
  const fb = loadBusiness(first.slug).business!;
  const iconFile = join(tenantDir(first.slug), fb.media.icon ?? fb.media.logo);
  const icon = async (size: number) => dataUrl(await sharp(iconFile).resize(size, size).png().toBuffer(), 'image/png');
  const manifest = {
    name: fb.name,
    short_name: fb.shortName,
    display: 'standalone',
    background_color: '#050608',
    theme_color: '#050608',
    start_url: '.',
    icons: [
      { src: await icon(192), sizes: '192x192', type: 'image/png' },
      { src: await icon(512), sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
  const head = [
    `<title>${fb.name}</title>`,
    '<meta name="theme-color" content="#050608" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
    `<meta name="apple-mobile-web-app-title" content="${fb.shortName}" />`,
    `<link rel="apple-touch-icon" href="${await icon(180)}" />`,
    `<link rel="manifest" href="data:application/manifest+json;base64,${Buffer.from(JSON.stringify(manifest)).toString('base64')}" />`,
  ].join('\n    ');
  const template = html.replace(/<link rel="modulepreload"[^>]*>/g, '');
  const splash = splashHtml({ logo: dataUrl(await sharp(join(tenantDir(first.slug), fb.media.logo)).resize(256, 256).png().toBuffer(), 'image/png'), name: fb.name });

  // GitHub Pages / any static host: the same app as real files, so phones can install it
  // (manifest, icons and a service worker must be served as files from the site itself).
  const site = join(ROOT, 'dist-pages');
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });
  const png = (size: number, file: string) => sharp(iconFile).resize(size, size).png().toFile(join(site, file));
  await png(192, 'icon-192.png');
  await png(512, 'icon-512.png');
  await png(180, 'apple-touch-icon.png');
  await png(32, 'favicon-32.png');
  const siteManifest = {
    ...manifest,
    id: './',
    start_url: './',
    scope: './',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  writeFileSync(join(site, 'manifest.webmanifest'), JSON.stringify(siteManifest, null, 2));
  // Offline-capable service worker: the whole app is one HTML file plus icons.
  writeFileSync(
    join(site, 'sw.js'),
    `const CACHE='ngx-app-v${Date.now()}';\nconst FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];\nself.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});\nself.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))});\nself.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request).then(m=>m||caches.match('./index.html'))))});\n`,
  );
  writeFileSync(join(site, '.nojekyll'), '');
  const siteHead = [
    `<title>${fb.name}</title>`,
    '<meta name="theme-color" content="#050608" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
    `<meta name="apple-mobile-web-app-title" content="${fb.shortName}" />`,
    '<link rel="apple-touch-icon" href="apple-touch-icon.png" />',
    '<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png" />',
    '<link rel="manifest" href="manifest.webmanifest" />',
    `<script>if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){})})}</script>`,
  ].join('\n    ');
  writeFileSync(join(site, 'index.html'), template.replace('<!--tenant-head-->', siteHead).replace('<!--tenant-splash-->', splash));
  writeFileSync(
    join(site, 'README.md'),
    `# ${fb.name} — приложение\n\nСтатическая сборка для GitHub Pages: \`index.html\` + иконки + манифест + service worker.\nОткройте сайт в Safari/Chrome и добавьте на экран «Домой».\n`,
  );
  log.ok(`${site} — сайт для GitHub Pages`);

  html = template
    .replace('<!--tenant-head-->', head)
    .replace('<!--tenant-splash-->', splash);
  if (/assets\//.test(html.replace(/data:[^"')]+/g, ''))) throw new Error('В HTML остались ссылки на assets/');
  mkdirSync(out, { recursive: true });
  const file = join(out, 'autoservice-demo.html');
  writeFileSync(file, html);
  log.ok(`${file} — ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} МБ`);
}

main().catch((e) => {
  log.fail((e as Error).message);
  process.exit(1);
});
