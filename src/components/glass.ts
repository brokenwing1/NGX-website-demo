// Liquid glass (liquid-gl, WebGL refraction) with an honest CSS fallback.
// The effect is skipped when the user prefers reduced motion or reduced transparency, or when WebGL
// is unavailable; the CSS frosted-glass style (backdrop-filter) is always present underneath.

let initialised = false;
let pending: Promise<void> | null = null;

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function glassAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = (q: string) => window.matchMedia?.(q).matches;
  if (mq('(prefers-reduced-motion: reduce)') || mq('(prefers-reduced-transparency: reduce)')) return false;
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return false;
  return webglAvailable();
}

/**
 * Turn every element with class "lg-target" (fixed-position panels such as the bottom navigation)
 * into refractive glass. liquid-gl has no teardown API, so it is initialised once per page load
 * for persistent elements only.
 */
export function initLiquidGlass(): Promise<void> {
  if (initialised || pending || !glassAllowed()) return pending ?? Promise.resolve();
  pending = import('liquid-gl')
    .then((mod) => {
      const liquidGL = (mod as unknown as { default: (o: Record<string, unknown>) => unknown }).default;
      liquidGL({
        target: '.lg-target',
        snapshot: 'body',
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        refraction: 0.012,
        bevelDepth: 0.07,
        bevelWidth: 0.16,
        frost: 6, // heavy frost: the snapshot under the glass never reads as text
        shadow: true,
        specular: true,
        reveal: 'fade',
        tilt: false,
      });
      document.documentElement.classList.add('has-liquid-glass');
      initialised = true;
    })
    .catch(() => {
      /* keep CSS glass */
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
