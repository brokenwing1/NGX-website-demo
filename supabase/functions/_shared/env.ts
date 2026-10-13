// Environment access that works in Supabase Edge (Deno) and in Node (tests, local gateway).
declare const Deno: { env: { get(name: string): string | undefined } } | undefined;

export function getEnv(name: string): string | undefined {
  try {
    if (typeof Deno !== 'undefined' && Deno?.env) {
      const v = Deno.env.get(name);
      if (v !== undefined && v !== '') return v;
    }
  } catch {
    /* permission denied for env in some runtimes */
  }
  const p = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  const v = p?.env?.[name];
  return v === undefined || v === '' ? undefined : v;
}

export function requireEnv(name: string): string {
  const v = getEnv(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export function intEnv(name: string, fallback: number): number {
  const v = getEnv(name);
  const n = v ? Number.parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
