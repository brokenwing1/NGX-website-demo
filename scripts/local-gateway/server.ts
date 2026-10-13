// Local gateway: a small, honest stand-in for the Supabase HTTP surface used by this app, running on top
// of a REAL Postgres with the real migrations. It exists so the app, the pipeline and the Playwright flow
// can run where Docker (and therefore `supabase start`) is unavailable.
//
//   /rest/v1/rpc/<fn>          PostgREST-style RPC: role + JWT claims + request headers set per request
//   /auth/v1/token|user|logout Supabase Auth subset (password grant, refresh, current user)
//   /auth/v1/admin/users       admin create/update (service key only) — used by tenant:publish
//   /storage/v1/object/...     upload (service key, or owner into <tenant>/owner/ only) and public read
//   /functions/v1/<name>       runs supabase/functions/<name>/handler.ts in-process
//
// It is NOT a production server and is not deployed. Production uses Supabase (see SETUP.md).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { signJwt, verifyJwt } from './jwt.ts';

const ROOT = resolve(import.meta.dirname, '../..');
for (const f of ['.env.local', '.env']) {
  const p = join(ROOT, f);
  if (existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch {
      /* optional */
    }
  }
}

export interface GatewayOptions {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  storageDir: string;
}

export function gatewayKeys(secret: string) {
  const far = 4102444800; // fixed (2100-01-01) so the keys are stable for a given secret
  return {
    anon: signJwt({ role: 'anon', iss: 'local-gateway', exp: far }, secret),
    service: signJwt({ role: 'service_role', iss: 'local-gateway', exp: far }, secret),
  };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-upsert, prefer, accept-profile, content-profile, cache-control, x-supabase-api-version, x-region',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'Access-Control-Expose-Headers': 'content-range',
};

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, {
    ...CORS,
    ...(isBuf || body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    ...headers,
  });
  if (body === undefined) res.end();
  else res.end(isBuf ? body : JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function toFetchRequest(req: IncomingMessage, body: Buffer, base: string): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const hasBody = !['GET', 'HEAD'].includes(req.method ?? 'GET');
  return new Request(new URL(req.url ?? '/', base), { method: req.method, headers, body: hasBody ? new Uint8Array(body) : undefined });
}

export async function startGateway(opts: GatewayOptions) {
  const sql = postgres(opts.databaseUrl, { max: 10, onnotice: () => {}, prepare: false });
  const keys = gatewayKeys(opts.jwtSecret);
  const base = `http://127.0.0.1:${opts.port}`;
  const refreshTokens = new Map<string, string>(); // refresh token -> user id
  const fnMeta = new Map<string, { args: { name: string; type: string }[]; setof: boolean }>();

  // Edge functions run in-process against the same database.
  process.env.SUPABASE_URL = base;
  process.env.SUPABASE_ANON_KEY = keys.anon;
  process.env.DATABASE_URL = opts.databaseUrl;
  const handlers = new Map<string, (r: Request) => Promise<Response>>();
  async function fnHandler(name: string) {
    if (!/^[a-z0-9-]+$/.test(name)) return null;
    if (!handlers.has(name)) {
      const file = join(ROOT, 'supabase/functions', name, 'handler.ts');
      if (!existsSync(file)) return null;
      const mod = (await import(pathToFileURL(file).href)) as { handler: (r: Request) => Promise<Response> };
      handlers.set(name, mod.handler);
    }
    return handlers.get(name)!;
  }

  function claimsFrom(req: IncomingMessage): Record<string, unknown> {
    const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const apikey = String(req.headers.apikey ?? '');
    return verifyJwt(auth, opts.jwtSecret) ?? verifyJwt(apikey, opts.jwtSecret) ?? { role: 'anon' };
  }

  async function userJson(id: string) {
    const [u] = await sql<{ id: string; email: string; created_at: Date }[]>`select id, email, created_at from auth.users where id = ${id}`;
    if (!u) return null;
    return {
      id: u.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: u.email,
      email_confirmed_at: u.created_at,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: u.created_at,
      updated_at: u.created_at,
    };
  }

  async function session(userId: string) {
    const now = Math.floor(Date.now() / 1000);
    const user = await userJson(userId);
    const access = signJwt({ sub: userId, role: 'authenticated', aud: 'authenticated', email: user?.email, iat: now, exp: now + 3600 }, opts.jwtSecret);
    const refresh = randomBytes(24).toString('base64url');
    refreshTokens.set(refresh, userId);
    return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user };
  }

  async function rpc(name: string, args: Record<string, unknown>, claims: Record<string, unknown>, req: IncomingMessage) {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) return { status: 404, body: { code: 'PGRST202', message: 'not found' } };
    if (!fnMeta.has(name)) {
      const rows = await sql<{ names: string[] | null; types: string[]; setof: boolean }[]>`
        select p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes) t) as types, p.proretset as setof
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = ${name}`;
      if (rows.length !== 1) return { status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
      const r = rows[0]!;
      fnMeta.set(name, { args: (r.names ?? []).slice(0, r.types.length).map((n, i) => ({ name: n, type: r.types[i]! })), setof: r.setof });
    }
    const meta = fnMeta.get(name)!;
    const params: unknown[] = [];
    const parts: string[] = [];
    for (const a of meta.args) {
      if (!(a.name in args)) continue;
      const v = args[a.name];
      params.push(v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
      parts.push(`${a.name} => $${params.length}::${a.type}`);
    }
    const unknownArg = Object.keys(args).find((k) => !meta.args.some((a) => a.name === k));
    if (unknownArg) return { status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${name} with argument ${unknownArg}` } };

    const role = claims.role === 'authenticated' ? 'authenticated' : claims.role === 'service_role' ? 'service_role' : 'anon';
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k.toLowerCase()] = v;
    if (!headers['x-forwarded-for']) headers['x-forwarded-for'] = req.socket.remoteAddress ?? '127.0.0.1';
    try {
      const result = await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true), set_config('request.headers', ${JSON.stringify(headers)}, true)`;
        await tx.unsafe(`set local role ${role}`);
        // JSON is produced by Postgres itself (dates stay 'YYYY-MM-DD', like PostgREST)
        const q = meta.setof
          ? `select coalesce(json_agg(t), '[]'::json) as r from public.${name}(${parts.join(', ')}) t`
          : `select to_json(public.${name}(${parts.join(', ')})) as r`;
        return tx.unsafe(q, params as never[]);
      });
      return { status: 200, body: (result[0] as unknown as { r: unknown }).r };
    } catch (e) {
      const err = e as { code?: string; message?: string; detail?: string; hint?: string };
      const status = err.code === 'P0001' ? 400 : err.code === '42501' ? (role === 'anon' ? 401 : 403) : err.code?.startsWith('22') || err.code?.startsWith('23') ? 400 : 500;
      return { status, body: { code: err.code, message: err.message, details: err.detail ?? null, hint: err.hint ?? null } };
    }
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204);
      const url = new URL(req.url ?? '/', base);
      const path = url.pathname;
      const claims = claimsFrom(req);

      // ---------------------------------------------------------------- REST RPC
      let m = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(path);
      if (m && req.method === 'POST') {
        const raw = await readBody(req);
        const args = raw.length ? (JSON.parse(raw.toString('utf8')) as Record<string, unknown>) : {};
        const r = await rpc(m[1]!, args, claims, req);
        return send(res, r.status, r.body);
      }
      if (path.startsWith('/rest/v1/')) return send(res, 404, { code: 'PGRST', message: 'Only RPC is exposed by the local gateway' });

      // ---------------------------------------------------------------- AUTH
      if (path === '/auth/v1/token' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as Record<string, string>;
        const grant = url.searchParams.get('grant_type');
        if (grant === 'password') {
          const [u] = await sql<{ id: string }[]>`
            select id from auth.users
            where lower(email) = lower(${body.email ?? ''})
              and encrypted_password is not null
              and encrypted_password = extensions.crypt(${body.password ?? ''}, encrypted_password)`;
          if (!u) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
          return send(res, 200, await session(u.id));
        }
        if (grant === 'refresh_token') {
          const uid = refreshTokens.get(body.refresh_token ?? '');
          if (!uid) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token', code: 'refresh_token_not_found' });
          refreshTokens.delete(body.refresh_token!);
          return send(res, 200, await session(uid));
        }
        return send(res, 400, { error: 'unsupported_grant_type' });
      }
      if (path === '/auth/v1/user' && req.method === 'GET') {
        const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        const c = verifyJwt(auth, opts.jwtSecret);
        if (!c || c.role !== 'authenticated') return send(res, 401, { code: 401, msg: 'invalid JWT', error_code: 'bad_jwt' });
        const u = await userJson(String(c.sub));
        return u ? send(res, 200, u) : send(res, 404, { msg: 'user not found' });
      }
      if (path === '/auth/v1/logout') return send(res, 204);
      if (path === '/auth/v1/signup') return send(res, 422, { code: 'signup_disabled', msg: 'Signups not allowed for this instance' });
      m = /^\/auth\/v1\/admin\/users(?:\/([0-9a-f-]{36}))?$/.exec(path);
      if (m) {
        if (claims.role !== 'service_role') return send(res, 401, { msg: 'service role required' });
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as Record<string, string>;
        const email = String(body.email ?? '');
        const password = String(body.password ?? '');
        if (req.method === 'POST' && !m[1]) {
          const exists = await sql`select 1 from auth.users where lower(email) = lower(${email})`;
          if (exists.length) return send(res, 422, { code: 'email_exists', msg: 'A user with this email address has already been registered' });
          const [u] = await sql<{ id: string }[]>`
            insert into auth.users(email, encrypted_password) values (lower(${email}), extensions.crypt(${password}, extensions.gen_salt('bf')))
            returning id`;
          return send(res, 200, await userJson(u!.id));
        }
        if (req.method === 'PUT' && m[1]) {
          if (password) await sql`update auth.users set encrypted_password = extensions.crypt(${password}, extensions.gen_salt('bf')) where id = ${m[1]}`;
          return send(res, 200, await userJson(m[1]));
        }
        return send(res, 405, { msg: 'method not allowed' });
      }

      // ---------------------------------------------------------------- STORAGE
      m = /^\/storage\/v1\/object\/public\/([a-z0-9-]+)\/(.+)$/.exec(path);
      if (m && (req.method === 'GET' || req.method === 'HEAD')) {
        const file = normalize(join(opts.storageDir, m[1]!, decodeURIComponent(m[2]!)));
        if (!file.startsWith(opts.storageDir) || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, { error: 'not_found' });
        const type = existsSync(`${file}.type`) ? readFileSync(`${file}.type`, 'utf8') : 'application/octet-stream';
        const buf = readFileSync(file);
        res.writeHead(200, { ...CORS, 'Content-Type': type, 'Content-Length': String(buf.length), 'Cache-Control': 'public, max-age=3600' });
        return res.end(req.method === 'HEAD' ? undefined : buf);
      }
      m = /^\/storage\/v1\/object\/([a-z0-9-]+)\/(.+)$/.exec(path);
      if (m && (req.method === 'POST' || req.method === 'PUT')) {
        const bucket = m[1]!;
        const objectPath = decodeURIComponent(m[2]!);
        if (!/^[A-Za-z0-9._/-]{1,300}$/.test(objectPath) || objectPath.includes('..')) return send(res, 400, { error: 'invalid_key' });
        if (claims.role !== 'service_role') {
          // Same rule as the storage.objects policy in production: owners write only into <tenant>/owner/.
          const [tenant, folder] = objectPath.split('/');
          if (claims.role !== 'authenticated' || folder !== 'owner') return send(res, 403, { error: 'Unauthorized', message: 'new row violates row-level security policy' });
          const ok = await sql.begin(async (tx) => {
            await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
            const [r] = await tx<{ ok: boolean }[]>`select app.is_member(${tenant!}::uuid) as ok`;
            return r!.ok;
          });
          if (!ok) return send(res, 403, { error: 'Unauthorized', message: 'new row violates row-level security policy' });
        }
        const raw = await readBody(req);
        let data: Buffer = raw;
        let type = String(req.headers['content-type'] ?? 'application/octet-stream');
        if (type.startsWith('multipart/form-data')) {
          const form = await toFetchRequest(req, raw, base).formData();
          const file = [...form.values()].find((v) => typeof v !== 'string') as File | undefined;
          if (!file) return send(res, 400, { error: 'no_file' });
          data = Buffer.from(await file.arrayBuffer());
          type = file.type || 'application/octet-stream';
        }
        if (data.length > 8 * 1024 * 1024) return send(res, 413, { error: 'Payload too large' });
        if (!/^image\/(jpeg|png|webp)$/.test(type)) return send(res, 415, { error: 'invalid_mime_type', message: `mime type ${type} is not supported` });
        const target = normalize(join(opts.storageDir, bucket, objectPath));
        if (existsSync(target) && req.headers['x-upsert'] !== 'true' && req.method === 'POST') return send(res, 409, { error: 'Duplicate', message: 'The resource already exists' });
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, data);
        writeFileSync(`${target}.type`, type);
        return send(res, 200, { Key: `${bucket}/${objectPath}`, Id: randomUUID() });
      }

      // ---------------------------------------------------------------- FUNCTIONS
      m = /^\/functions\/v1\/([a-z0-9-]+)$/.exec(path);
      if (m) {
        const h = await fnHandler(m[1]!);
        if (!h) return send(res, 404, { error: 'function_not_found' });
        const body = await readBody(req);
        const r = await h(toFetchRequest(req, body, base));
        const out = Buffer.from(await r.arrayBuffer());
        // header names are case-insensitive: the function's own CORS headers replace the gateway's
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(CORS)) headers[k.toLowerCase()] = v;
        r.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
        res.writeHead(r.status, headers);
        return res.end(out);
      }

      if (path === '/health') return send(res, 200, { ok: true });
      return send(res, 404, { error: 'not_found' });
    } catch (e) {
      console.error('[gateway]', e);
      return send(res, 500, { message: 'gateway error' });
    }
  });

  await new Promise<void>((r) => server.listen(opts.port, '0.0.0.0', r));
  return {
    url: base,
    keys,
    close: async () => {
      await new Promise((r) => server.close(r));
      await sql.end({ timeout: 2 });
    },
  };
}

const isEntry = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isEntry) {
  const port = Number(process.env.GATEWAY_PORT ?? 54321);
  const secret = process.env.GATEWAY_JWT_SECRET ?? 'local-gateway-secret-not-for-production-use-0001';
  const gw = await startGateway({
    port,
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54322/autoservice_dev',
    jwtSecret: secret,
    storageDir: resolve(ROOT, process.env.GATEWAY_STORAGE_DIR ?? '.local-storage'),
  });
  console.log(`Local gateway on ${gw.url}`);
  console.log(`VITE_SUPABASE_URL=${gw.url}`);
  console.log(`VITE_SUPABASE_ANON_KEY=${gw.keys.anon}`);
  console.log(`SUPABASE_SERVICE_ROLE_KEY=${gw.keys.service}`);
}
