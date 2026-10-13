import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@astryxdesign/core';
import { ApiError } from '../lib/api';
import { useOwner } from './OwnerApp';

/** Owner write: on success refresh bookings, stats and settings; errors become a toast. */
export function useOwnerMutation<TVars, TRes>(fn: (vars: TVars) => Promise<TRes>, opts: { success?: string; onSuccess?: (r: TRes) => void } = {}) {
  const qc = useQueryClient();
  const { slug } = useOwner();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['owner', slug] });
      void qc.invalidateQueries({ queryKey: ['owner'], predicate: (q) => q.queryKey.includes(slug) });
      void qc.invalidateQueries({ queryKey: ['tenant', slug] });
      if (opts.success) toast({ body: opts.success });
      opts.onSuccess?.(res);
    },
    onError: (e) => {
      toast({ body: e instanceof ApiError ? e.message : 'Не удалось сохранить', type: 'error' });
    },
  });
}
