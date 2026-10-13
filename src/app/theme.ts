import { defineTheme } from '@astryxdesign/core';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

const cache = new Map<string, ReturnType<typeof defineTheme>>();

/** Neutral Astryx theme with the studio's single accent colour (from its configuration). */
export function studioTheme(accent: string) {
  const key = accent.toUpperCase();
  let t = cache.get(key);
  if (!t) {
    t = defineTheme({
      name: 'studio',
      extends: neutralTheme,
      color: { accent: key },
      typography: {
        scale: { base: 15, ratio: 1.2 },
        body: { family: 'Onest', fallbacks: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
        heading: { family: 'Onest', fallbacks: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', weight: 'semibold' },
      },
    });
    cache.set(key, t);
  }
  return t;
}
