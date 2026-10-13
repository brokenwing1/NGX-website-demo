// Database access from edge functions. Connects with SUPABASE_DB_URL (provided by the platform)
// and runs each request inside a transaction that ASSUMES THE CALLER'S IDENTITY:
//   asAnon  -> role anon, no JWT claims        (same rights as the public app)
//   asUser  -> role authenticated, sub = user  (RLS + membership checks apply)
// The model never gets SQL or tenant ids: tools call fixed RPCs with the slug of the request.
import postgres from 'postgres';
import { getEnv, requireEnv } from './env.ts';

export type Sql = ReturnType<typeof postgres>;
export type Tx = postgres.TransactionSql;

let pool: Sql | null = null;

export function db(): Sql {
  if (!pool) {
    pool = postgres(getEnv('DATABASE_URL') ?? requireEnv('SUPABASE_DB_URL'), {
      max: 3,
      idle_timeout: 20,
      prepare: false, // compatible with transaction-mode poolers
      onnotice: () => {},
      connection: { application_name: 'edge-functions' },
    });
  }
  return pool;
}

/** For tests / the local gateway: inject a pool. */
export function setDb(sql: Sql) {
  pool = sql;
}

async function assume(tx: Tx, role: 'anon' | 'authenticated', claims: Record<string, unknown>, ip: string) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true),
                  set_config('request.headers', ${JSON.stringify({ 'x-forwarded-for': ip })}, true)`;
  await tx.unsafe(role === 'anon' ? 'set local role anon' : 'set local role authenticated');
}

export function asAnon<T>(ip: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().begin(async (tx) => {
    await assume(tx, 'anon', { role: 'anon' }, ip);
    return fn(tx);
  }) as Promise<T>;
}

export function asUser<T>(userId: string, ip: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().begin(async (tx) => {
    await assume(tx, 'authenticated', { sub: userId, role: 'authenticated' }, ip);
    return fn(tx);
  }) as Promise<T>;
}

/** Privileged access for server-only bookkeeping (rate limits, budget, outbox). */
export function asServer<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().begin(fn) as Promise<T>;
}
