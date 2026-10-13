// Owner session. Sign-in uses Supabase Auth (email + password); the studio is confirmed by membership
// on the server (owner_me). Logout wipes the session AND every cached owner query from memory.
import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type SessionState = { status: 'loading' } | { status: 'signed_out' } | { status: 'signed_in'; session: Session };

export function useOwnerSession() {
  const qc = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    supabase.auth
      .getSession()
      .then(({ data }) => alive && setState(data.session ? { status: 'signed_in', session: data.session } : { status: 'signed_out' }))
      .catch(() => alive && setState({ status: 'signed_out' }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? { status: 'signed_in', session } : { status: 'signed_out' });
      if (!session) qc.removeQueries({ queryKey: ['owner'] });
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [qc]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      throw new Error(/invalid/i.test(error.message) ? 'Неверная почта или пароль' : 'Не удалось войти. Проверьте соединение.');
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } finally {
      // Private data lives only in memory (TanStack Query) — never in the service worker or storage.
      qc.removeQueries({ queryKey: ['owner'] });
      qc.clear();
      try {
        localStorage.removeItem('owner-session');
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
      setState({ status: 'signed_out' });
    }
  }, [qc]);

  return { state, signIn, signOut };
}
