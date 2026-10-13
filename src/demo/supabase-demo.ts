// Drop-in replacement for src/lib/supabase.ts in the single-file demo build (see vite.demo.config.ts).
// Same exports; the client talks to the in-memory DemoDb instead of Supabase.
import { DemoDb, RpcError, type DemoTenantInput } from './backend';
import data from 'virtual:demo-data';

export const SUPABASE_URL = 'demo:';
export const SUPABASE_ANON_KEY = 'demo';
export const ASSISTANT_ENABLED = false;
export const VAPID_PUBLIC_KEY = '';
export const isConfigured = true;

export const db = new DemoDb(data as unknown as DemoTenantInput[]);

type Session = { access_token: string; user: { id: string; email: string } };
let session: Session | null = null;
const listeners = new Set<(event: string, s: Session | null) => void>();
const emit = (event: string) => listeners.forEach((l) => l(event, session));
const later = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120)); // feel of a network round trip

export const supabase = {
  async rpc(fn: string, args: Record<string, unknown>) {
    try {
      // JSON round trip: the UI gets plain data, exactly like from PostgREST
      const data = JSON.parse(JSON.stringify(db.rpc(fn, args ?? {}, session?.user.id ?? null) ?? null));
      return later({ data, error: null });
    } catch (e) {
      if (e instanceof RpcError) {
        return later({ data: null, error: { code: e.code === 'forbidden' ? '42501' : 'P0001', message: e.code, details: e.details, hint: null } });
      }
      console.error('[demo]', e);
      return later({ data: null, error: { code: 'XX000', message: 'internal', details: '', hint: null } });
    }
  },
  auth: {
    async getSession() {
      return { data: { session }, error: null };
    },
    onAuthStateChange(cb: (event: string, s: Session | null) => void) {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const o = db.owners.find((x) => x.email.toLowerCase() === email.toLowerCase() && x.password === password);
      if (!o) return later({ data: { session: null }, error: { message: 'Invalid login credentials' } });
      session = { access_token: 'demo', user: { id: o.user_id, email: o.email } };
      emit('SIGNED_IN');
      return later({ data: { session }, error: null });
    },
    async signOut() {
      session = null;
      emit('SIGNED_OUT');
      return { error: null };
    },
  },
  storage: {
    from() {
      return {
        async upload(path: string, file: Blob) {
          db.media.set(path, URL.createObjectURL(file));
          return later({ data: { path }, error: null });
        },
      };
    },
  },
  functions: {
    async invoke() {
      return { data: null, error: { message: 'Помощник выключен в демо' } };
    },
  },
};

export function mediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  return db.media.get(path);
}
