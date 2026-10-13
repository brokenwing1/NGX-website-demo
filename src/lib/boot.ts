// Boot data injected into the per-studio HTML shell (see build/tenant-shells.ts).
export interface TenantBoot {
  slug: string;
  name: string;
  shortName: string;
  accent: string;
  onAccent: string;
}

export function readBoot(): TenantBoot | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="tenant-boot"]');
  if (meta?.content) {
    try {
      return JSON.parse(meta.content) as TenantBoot;
    } catch {
      /* fall through */
    }
  }
  const m = /^\/s\/([a-z0-9-]+)\//.exec(location.pathname);
  if (!m) return null;
  return { slug: m[1]!, name: '', shortName: '', accent: '#4690FF', onAccent: '#000000' };
}

export const DEFAULT_ACCENT = '#4690FF';
