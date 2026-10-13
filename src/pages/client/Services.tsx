import { Heading } from '@astryxdesign/core';
import { ListMagnifyingGlass } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useStudio } from '../../app/studio';
import { Reveal } from '../../components/Reveal';
import { ServiceCard } from '../../components/ServiceCard';
import { Empty } from '../../components/States';

export function Services() {
  const { tenant, openBooking } = useStudio();
  const categories = useMemo(() => Array.from(new Set(tenant.services.map((s) => s.category).filter(Boolean))), [tenant.services]);
  const [cat, setCat] = useState('all');
  const list = cat === 'all' ? tenant.services : tenant.services.filter((s) => s.category === cat);

  return (
    <main className="page page--plain">
      <div className="page__body">
        <header className="page__header">
          <Heading level={1}>Услуги и цены</Heading>
        </header>
        {categories.length > 1 ? (
          // scrollable chips: category names are never truncated, however many there are
          <div className="filter-scroll" role="group" aria-label="Категория">
            {[['all', 'Все'] as const, ...categories.map((c) => [c, c] as const)].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`chip ${cat === value ? 'chip--accent' : ''}`}
                aria-pressed={cat === value}
                onClick={() => setCat(value)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {list.length === 0 ? (
          <Empty icon={<ListMagnifyingGlass size={36} weight="duotone" />} title="Услуг пока нет" description="Студия ещё заполняет прайс. Позвоните, чтобы записаться." />
        ) : (
          <div className="stack-3">
            {list.map((s, i) => (
              <Reveal key={s.id} delay={Math.min(i, 6) * 40}>
                <ServiceCard service={s} currency={tenant.currency} onBook={() => openBooking({ serviceId: s.id })} />
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
