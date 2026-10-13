// Loading / error / empty states used by every network-backed screen.
import { Button, EmptyState as AxEmptyState, Skeleton, Spinner, Text } from '@astryxdesign/core';
import { ArrowClockwise, WifiSlash, WarningCircle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { ApiError } from '../lib/api';

export function PageLoader({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="state state--center" role="status" aria-live="polite">
      <Spinner size="lg" label={label} />
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const e = error instanceof ApiError ? error : null;
  const offline = e?.code === 'network';
  return (
    <div className={compact ? 'state' : 'state state--center'} role="alert">
      <AxEmptyState
        isCompact={compact}
        icon={offline ? <WifiSlash size={36} weight="duotone" /> : <WarningCircle size={36} weight="duotone" />}
        title={offline ? 'Нет соединения' : 'Не удалось загрузить'}
        description={e?.message ?? 'Попробуйте ещё раз через минуту.'}
        actions={onRetry ? <Button label="Повторить" icon={<ArrowClockwise size={18} />} onClick={onRetry} /> : undefined}
      />
    </div>
  );
}

export function Empty({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <AxEmptyState isCompact icon={icon} title={title} description={description} actions={action} />
    </div>
  );
}

export function ListSkeleton({ rows = 4, height = 72 }: { rows?: number; height?: number }) {
  return (
    <div className="stack-3" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} radius={3} index={i} />
      ))}
    </div>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <Text type="supporting" color="inherit" display="block" className="inline-error" role="alert">
      {children}
    </Text>
  );
}
