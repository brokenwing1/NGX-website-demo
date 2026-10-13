// Image processing for the pipeline: optimised media for Storage and per-tenant install assets.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { onAccent, type Business } from './business-schema.ts';
import { PUBLIC_TENANTS_DIR, tenantDir, type TenantMeta } from './tenant-files.ts';

export const BACKGROUND = '#000000';

export interface ProcessedImage {
  buffer: Buffer;
  contentType: string;
  hash: string;
  ext: string;
}

const PRESETS = {
  hero: { width: 1600, height: 1200, quality: 74 },
  gallery: { width: 1200, height: 1200, quality: 74 },
  service: { width: 900, height: 900, quality: 72 },
  logo: { width: 512, height: 512, quality: 90 },
} as const;

export async function processImage(file: string, preset: keyof typeof PRESETS): Promise<ProcessedImage> {
  const p = PRESETS[preset];
  const img = sharp(file, { failOn: 'error' }).rotate();
  const out =
    preset === 'logo'
      ? await img.resize({ width: p.width, height: p.height, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer()
      : await img
          .resize({ width: p.width, height: p.height, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: p.quality, effort: 5 })
          .toBuffer();
  const hash = createHash('sha256').update(out).digest('hex').slice(0, 12);
  return { buffer: out, contentType: preset === 'logo' ? 'image/png' : 'image/webp', hash, ext: preset === 'logo' ? 'png' : 'webp' };
}

export interface ImageCheck {
  errors: string[];
  warnings: string[];
}

/** Pixel-level checks that need sharp: sizes and aspect ratios. */
export async function checkImages(b: Business): Promise<ImageCheck> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dir = tenantDir(b.slug);
  const meta = async (rel: string) => {
    try {
      return await sharp(join(dir, rel)).metadata();
    } catch (e) {
      errors.push(`${rel}: не удалось прочитать изображение (${(e as Error).message})`);
      return null;
    }
  };
  const hero = await meta(b.media.hero);
  if (hero && (hero.width ?? 0) < 1000) warnings.push(`${b.media.hero}: ширина ${hero.width}px, лучше от 1200px`);
  const icon = await meta(b.media.icon);
  if (icon) {
    if (icon.width !== icon.height) errors.push(`${b.media.icon}: иконка должна быть квадратной (${icon.width}×${icon.height})`);
    if ((icon.width ?? 0) < 512) errors.push(`${b.media.icon}: иконка от 512×512, сейчас ${icon.width}×${icon.height}`);
  }
  await meta(b.media.logo);
  for (const s of b.services) if (s.image) await meta(s.image);
  for (const g of b.gallery) {
    const m = await meta(g.image);
    if (m && (m.width ?? 0) < 600) warnings.push(`${g.image}: маленькое фото (${m.width}px)`);
  }
  return { errors, warnings };
}

// iOS splash screens (portrait). media queries per Apple device class.
const STARTUP = [
  [440, 956, 3],
  [402, 874, 3],
  [430, 932, 3],
  [393, 852, 3],
  [428, 926, 3],
  [390, 844, 3],
  [375, 812, 3],
  [414, 896, 3],
  [414, 896, 2],
  [375, 667, 2],
  [834, 1194, 2],
  [1024, 1366, 2],
] as const;

async function iconOnSquare(iconFile: string, size: number, inner: number, bg: string) {
  const icon = await sharp(iconFile).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: icon, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Generates public/s/<slug>/: icons (any + maskable), apple-touch-icon, favicon, iOS startup images,
 * Open Graph image, manifest.webmanifest and tenant.json (read by the HTML shell builder).
 */
export async function generateInstallAssets(b: Business, assetsVersion: string): Promise<TenantMeta> {
  const out = join(PUBLIC_TENANTS_DIR, b.slug);
  mkdirSync(out, { recursive: true });
  const iconFile = join(tenantDir(b.slug), b.media.icon);
  const base = `/s/${b.slug}/`;

  // "any" icons keep the artwork as-is; maskable keeps it inside the 80% safe zone on a solid background.
  for (const size of [192, 512]) {
    await sharp(iconFile).resize(size, size, { fit: 'cover' }).png({ compressionLevel: 9 }).toFile(join(out, `icon-${size}.png`));
  }
  // full-bleed artwork (like the NGX mark) is already maskable; framed artwork goes inside the 80% safe zone
  writeFileSync(join(out, 'maskable-512.png'), b.media.iconFullBleed ? await sharp(iconFile).resize(512, 512).png().toBuffer() : await iconOnSquare(iconFile, 512, 400, BACKGROUND));
  // apple-touch-icon must not be transparent (iOS fills transparency with black anyway).
  writeFileSync(join(out, 'apple-touch-icon.png'), await sharp(await iconOnSquare(iconFile, 180, 180, BACKGROUND)).flatten({ background: BACKGROUND }).png().toBuffer());
  await sharp(iconFile).resize(32, 32).png().toFile(join(out, 'favicon-32.png'));
  // logo for the launch screen (build/splash.ts); iOS startup images show the same mark, so the
  // native splash and the animated one line up
  const logoFile = join(tenantDir(b.slug), b.media.logo);
  await sharp(logoFile).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(join(out, 'logo-256.png'));
  const SPLASH_BG = '#050608';

  const startupImages: TenantMeta['startupImages'] = [];
  for (const [w, h, dpr] of STARTUP) {
    const pw = w * dpr;
    const ph = h * dpr;
    const iconSize = Math.round(96 * dpr); // same size as the logo on the animated launch screen
    const icon = await sharp(logoFile).resize(iconSize, iconSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const file = `startup-${pw}x${ph}.png`;
    await sharp({ create: { width: pw, height: ph, channels: 3, background: SPLASH_BG } })
      .composite([{ input: icon, gravity: 'center' }])
      .png({ compressionLevel: 9, palette: true })
      .toFile(join(out, file));
    startupImages.push({
      href: `${base}${file}?v=${assetsVersion}`,
      media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
    });
  }

  await sharp(join(tenantDir(b.slug), b.media.hero))
    .resize(1200, 630, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(join(out, 'og.jpg'));

  const manifest = {
    id: base,
    name: b.name,
    short_name: b.shortName,
    description: b.tagline || b.description.slice(0, 140),
    lang: b.locale.split('-')[0],
    dir: 'ltr',
    start_url: `${base}?source=pwa`,
    scope: base,
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait',
    background_color: BACKGROUND,
    theme_color: BACKGROUND,
    categories: ['auto', 'lifestyle', 'business'],
    icons: [
      { src: `${base}icon-192.png?v=${assetsVersion}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}icon-512.png?v=${assetsVersion}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}maskable-512.png?v=${assetsVersion}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Записаться', short_name: 'Запись', url: `${base}?book=1`, icons: [{ src: `${base}icon-192.png`, sizes: '192x192' }] },
      { name: 'Моя запись', short_name: 'Моя запись', url: `${base}my`, icons: [{ src: `${base}icon-192.png`, sizes: '192x192' }] },
    ],
  };
  writeFileSync(join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

  const meta: TenantMeta = {
    slug: b.slug,
    name: b.name,
    shortName: b.shortName,
    description: b.tagline || b.description.slice(0, 160),
    accent: b.theme.accent.toUpperCase(),
    onAccent: onAccent(b.theme.accent),
    background: BACKGROUND,
    lang: b.locale.split('-')[0] ?? 'ru',
    assetsVersion,
    startupImages,
  };
  writeFileSync(join(out, 'tenant.json'), JSON.stringify(meta, null, 2));
  return meta;
}
