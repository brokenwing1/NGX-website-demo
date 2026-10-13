// Vite plugin: one shared JS/CSS build, one HTML shell per studio.
//   dev:   /s/<slug>/... (any non-file path) is answered with index.html + that studio's <head>
//   build: dist/s/<slug>/index.html is emitted for every public/s/<slug>/tenant.json
// The shell carries the studio's title, manifest, icons, iOS splash screens and accent colour,
// so deep links and "Add to Home Screen" always open the right studio.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { splashHtml } from './splash.ts';

interface TenantMeta {
  slug: string;
  name: string;
  shortName: string;
  description: string;
  accent: string;
  onAccent: string;
  background: string;
  lang: string;
  assetsVersion: string;
  startupImages: { href: string; media: string }[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function tenantHead(t: TenantMeta, siteUrl = ''): string {
  const base = `/s/${t.slug}/`;
  const v = t.assetsVersion;
  const boot = JSON.stringify({ slug: t.slug, name: t.name, shortName: t.shortName, accent: t.accent, onAccent: t.onAccent });
  return [
    `<title>${esc(t.name)}</title>`,
    `<meta name="description" content="${esc(t.description)}" />`,
    `<meta name="theme-color" content="${t.background}" />`,
    `<meta name="color-scheme" content="dark" />`,
    `<link rel="manifest" href="${base}manifest.webmanifest?v=${v}" />`,
    `<link rel="icon" type="image/png" sizes="32x32" href="${base}favicon-32.png?v=${v}" />`,
    `<link rel="apple-touch-icon" href="${base}apple-touch-icon.png?v=${v}" />`,
    `<meta name="mobile-web-app-capable" content="yes" />`,
    `<meta name="apple-mobile-web-app-capable" content="yes" />`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`,
    `<meta name="apple-mobile-web-app-title" content="${esc(t.shortName)}" />`,
    ...t.startupImages.map((s) => `<link rel="apple-touch-startup-image" media="${esc(s.media)}" href="${s.href}" />`),
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(t.name)}" />`,
    `<meta property="og:description" content="${esc(t.description)}" />`,
    `<meta property="og:image" content="${siteUrl}${base}og.jpg?v=${v}" />`,
    `<meta name="tenant-boot" content="${esc(boot)}" />`,
    `<style>:root{--tenant-accent:${t.accent};--tenant-on-accent:${t.onAccent};}html,body{background:${t.background};}</style>`,
  ].join('\n    ');
}

const DEFAULT_HEAD = [
  '<title>Онлайн-запись</title>',
  '<meta name="theme-color" content="#000000" />',
  '<meta name="color-scheme" content="dark" />',
  '<style>html,body{background:#000000;}</style>',
].join('\n    ');

function readTenants(publicDir: string): TenantMeta[] {
  const dir = join(publicDir, 's');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((slug) => join(dir, slug, 'tenant.json'))
    .filter((f) => existsSync(f))
    .map((f) => JSON.parse(readFileSync(f, 'utf8')) as TenantMeta);
}

/** Launch screen: logo square, a neon line around it, then the studio name (see build/splash.ts). */
function tenantSplash(t: TenantMeta): string {
  return splashHtml({ logo: `/s/${t.slug}/logo-256.png?v=${t.assetsVersion}`, name: t.name, background: '#050608' });
}

export function tenantShells(opts: { siteUrl?: string } = {}): Plugin {
  let root = process.cwd();
  let publicDir = resolve(root, 'public');
  let outDir = resolve(root, 'dist');
  return {
    name: 'tenant-shells',
    configResolved(c) {
      root = c.root;
      publicDir = c.publicDir;
      outDir = resolve(c.root, c.build.outDir);
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        // In dev the request path tells which studio; in build the root page is the generic landing.
        const m = ctx.originalUrl ? /^\/s\/([a-z0-9-]+)\//.exec(ctx.originalUrl) : null;
        if (m) {
          const meta = readTenants(publicDir).find((t) => t.slug === m[1]);
          if (meta) return html.replace('<!--tenant-head-->', tenantHead(meta, opts.siteUrl)).replace('<!--tenant-splash-->', tenantSplash(meta));
        }
        // dev root page; in build the placeholder is kept for closeBundle()
        return ctx.server ? html.replace('<!--tenant-head-->', DEFAULT_HEAD).replace('<!--tenant-splash-->', '') : html;
      },
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '/';
        const m = /^\/s\/([a-z0-9-]+)(\/[^?]*)?/.exec(url);
        if (!m) return next();
        const rest = m[2] ?? '/';
        if (/\.[a-z0-9]+$/i.test(rest) && existsSync(join(publicDir, 's', m[1]!, rest))) return next();
        if (!m[2]) {
          res.statusCode = 301;
          res.setHeader('Location', `/s/${m[1]}/`);
          return res.end();
        }
        const meta = readTenants(publicDir).find((t) => t.slug === m[1]);
        if (!meta) return next();
        const template = readFileSync(resolve(root, 'index.html'), 'utf8');
        const html = await server.transformIndexHtml(url, template, url);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html.replace('<!--tenant-head-->', tenantHead(meta, opts.siteUrl)).replace('<!--tenant-splash-->', tenantSplash(meta)));
      });
    },
    closeBundle() {
      const indexFile = join(outDir, 'index.html');
      if (!existsSync(indexFile)) return;
      const template = readFileSync(indexFile, 'utf8');
      for (const t of readTenants(publicDir)) {
        const dir = join(outDir, 's', t.slug);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.html'), template.replace('<!--tenant-head-->', tenantHead(t, opts.siteUrl)).replace('<!--tenant-splash-->', tenantSplash(t)));
      }
      writeFileSync(indexFile, template.replace('<!--tenant-head-->', DEFAULT_HEAD).replace('<!--tenant-splash-->', ''));
    },
  };
}
