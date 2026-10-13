import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';
/** The assistant is switched off for now; VITE_ASSISTANT_ENABLED=true brings it back (UI and routes). */
export const ASSISTANT_ENABLED = (import.meta.env.VITE_ASSISTANT_ENABLED as string | undefined) === 'true';
export const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '';

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// One client for the whole app. The anonymous client part needs no session; the owner session is
// persisted so the cabinet survives reloads, and is wiped on logout (see owner/session.ts).
export const supabase = createClient(SUPABASE_URL || 'http://invalid.localhost', SUPABASE_ANON_KEY || 'missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'owner-session',
  },
});

export function mediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  return `${SUPABASE_URL}/storage/v1/object/public/media/${path}`;
}
