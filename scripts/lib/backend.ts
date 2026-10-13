// Backend access for pipeline scripts: Postgres (DATABASE_URL) + Supabase Storage/Auth HTTP APIs
// (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). The local gateway implements the same HTTP endpoints.
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { env } from './env.ts';

export function connectDb() {
  return postgres(env('DATABASE_URL'), {
    max: 2,
    onnotice: () => {},
    connection: { application_name: 'tenant-pipeline' },
  });
}
export type Db = ReturnType<typeof connectDb>;

function supabaseHeaders(extra: Record<string, string> = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

export const MEDIA_BUCKET = 'media';

export async function uploadMedia(path: string, body: Buffer, contentType: string): Promise<void> {
  const url = `${env('SUPABASE_URL', process.env.VITE_SUPABASE_URL)}/storage/v1/object/${MEDIA_BUCKET}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders({ 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000' }),
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    throw new Error(`Загрузка ${path} не удалась: ${res.status} ${await res.text()}`);
  }
}

export async function mediaExists(path: string): Promise<boolean> {
  const res = await fetch(`${env('SUPABASE_URL', process.env.VITE_SUPABASE_URL)}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`, { method: 'HEAD' });
  return res.ok;
}

export function generatePassword(): string {
  // 18 chars from an unambiguous alphabet (~107 bits)
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(18);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Find or create an owner account (Supabase Auth admin API). Never exposes a public signup. */
export async function ensureOwnerUser(
  db: Db,
  email: string,
  password?: string,
): Promise<{ userId: string; created: boolean; password?: string }> {
  const normalized = email.trim().toLowerCase();
  const existing = await db<{ id: string }[]>`select id from auth.users where lower(email) = ${normalized} limit 1`;
  if (existing[0] && !password) return { userId: existing[0].id, created: false };

  const pwd = password ?? generatePassword();
  if (existing[0]) {
    const res = await fetch(`${env('SUPABASE_URL', process.env.VITE_SUPABASE_URL)}/auth/v1/admin/users/${existing[0].id}`, {
      method: 'PUT',
      headers: supabaseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password: pwd }),
    });
    if (!res.ok) throw new Error(`Не удалось сменить пароль: ${res.status} ${await res.text()}`);
    return { userId: existing[0].id, created: false, password: pwd };
  }
  const res = await fetch(`${env('SUPABASE_URL', process.env.VITE_SUPABASE_URL)}/auth/v1/admin/users`, {
    method: 'POST',
    headers: supabaseHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email: normalized, password: pwd, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`Не удалось создать владельца: ${res.status} ${await res.text()}`);
  const user = (await res.json()) as { id: string };
  return { userId: user.id, created: true, password: pwd };
}
