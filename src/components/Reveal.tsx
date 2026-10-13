// Smooth appearance of sections while scrolling. Respects prefers-reduced-motion (renders immediately).
import { useEffect, useRef, useState, type ReactNode } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Reveal({ children, delay = 0, as: Tag = 'div', className = '' }: { children: ReactNode; delay?: number; as?: 'div' | 'section'; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(reduced);
  useEffect(() => {
    if (shown || !ref.current || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const el = ref.current;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return (
    <Tag ref={ref} className={`reveal ${shown ? 'is-shown' : ''} ${className}`} style={{ transitionDelay: shown ? `${delay}ms` : undefined }}>
      {children}
    </Tag>
  );
}
