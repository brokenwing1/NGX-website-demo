import { useState } from 'react';
import { mediaUrl } from '../lib/supabase';

/** Photo from Storage with a placeholder while loading and a calm fallback on error. */
export function Photo({ path, alt, className = '', eager = false, sizes }: { path: string | null | undefined; alt: string; className?: string; eager?: boolean; sizes?: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(path ? 'loading' : 'error');
  const src = mediaUrl(path);
  return (
    <span className={`photo photo--${state} ${className}`}>
      {src && state !== 'error' ? (
        <img
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          sizes={sizes}
          fetchPriority={eager ? 'high' : 'auto'}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
        />
      ) : null}
    </span>
  );
}
