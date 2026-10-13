import { Skeleton } from '@astryxdesign/core';

export function StudioSkeleton() {
  return (
    <main className="page" aria-busy="true" aria-label="Загрузка студии">
      <div className="hero hero--skeleton">
        <Skeleton height="100%" radius="none" />
      </div>
      <div className="page__body stack-4">
        <Skeleton height={28} width="60%" radius={2} />
        <Skeleton height={18} width="85%" radius={2} index={1} />
        <div className="grid-3">
          <Skeleton height={96} index={2} />
          <Skeleton height={96} index={3} />
          <Skeleton height={96} index={4} />
        </div>
        <Skeleton height={140} index={5} />
      </div>
    </main>
  );
}
