// Resolve the signed-in user from the Authorization header by asking Supabase Auth itself.
// Works with both legacy (HS256) and asymmetric JWT signing keys, no secret needed in the function.
import { getEnv, requireEnv } from './env.ts';
import { HttpError } from './http.ts';

export interface AuthUser {
  id: string;
  email?: string;
}

export async function requireUser(req: Request): Promise<AuthUser> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const anonKey = getEnv('SUPABASE_ANON_KEY') ?? '';
  if (!token || token === anonKey || token.split('.').length !== 3) {
    throw new HttpError(401, 'not_authenticated', 'Войдите в кабинет');
  }
  const res = await fetch(`${requireEnv('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  });
  if (!res.ok) throw new HttpError(401, 'not_authenticated', 'Сессия истекла, войдите снова');
  const user = (await res.json()) as { id?: string; email?: string };
  if (!user?.id) throw new HttpError(401, 'not_authenticated', 'Сессия истекла, войдите снова');
  return { id: user.id, email: user.email };
}
