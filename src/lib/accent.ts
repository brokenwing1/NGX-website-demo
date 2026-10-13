/** Astryx tones the accent for dark mode; the studio's colour must stay exactly as configured. */
export function applyAccent(hex: string | null | undefined) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m || typeof document === 'undefined') return;
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  const onAccent = (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#000000' : '#FFFFFF';
  const root = document.documentElement.style;
  root.setProperty('--tenant-accent', hex!);
  root.setProperty('--tenant-on-accent', onAccent);
}

/** Single-file demo build (vite.demo.config.ts): in-memory backend, memory router, no service worker. */
export const DEMO = import.meta.env.VITE_DEMO === '1';

/** First studio of the demo build: the demo opens straight on its home page. */
export function demoStartPath(): string {
  try {
    const list = JSON.parse(import.meta.env.VITE_DEMO_STUDIOS ?? '[]') as { slug: string }[];
    return list[0] ? `/s/${list[0].slug}/` : '/';
  } catch {
    return '/';
  }
}
