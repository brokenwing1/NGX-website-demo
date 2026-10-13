// HTTP helpers shared by edge functions.

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Client IP as seen by the platform proxy. */
export function clientIp(req: Request): string {
  const h = req.headers;
  const v = h.get('cf-connecting-ip') ?? h.get('x-real-ip') ?? (h.get('x-forwarded-for') ?? '').split(',')[0];
  return (v ?? '').trim().slice(0, 64) || 'unknown';
}

/** Constant-time comparison for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Map a Postgres business error (SQLSTATE P0001, MESSAGE = code, DETAIL = text). */
export function pgBusinessError(e: unknown): { code: string; message: string } | null {
  const err = e as { code?: string; message?: string; detail?: string };
  if (err?.code === 'P0001' && err.message) return { code: err.message, message: err.detail ?? err.message };
  return null;
}
