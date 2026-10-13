import { Heading, SegmentedControl, SegmentedControlItem, Text } from '@astryxdesign/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorState, ListSkeleton } from '../components/States';
import { ownerApi, type Stats as StatsT, type StatsPeriod } from '../lib/api';
import { fmt, money } from '../lib/time';
import { useOwner } from './OwnerApp';

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'this_week', label: 'Неделя' },
  { value: 'this_month', label: 'Месяц' },
  { value: 'last_month', label: 'Прошлый' },
];

export function Stats() {
  const { slug, settings } = useOwner();
  const [period, setPeriod] = useState<StatsPeriod>('this_week');
  const q = useQuery({ queryKey: ['owner', slug, 'stats', period], queryFn: () => ownerApi.stats(slug, period), refetchInterval: 60_000 });
  const currency = settings.tenant.currency;

  return (
    <main className="page page--plain owner-page">
      <div className="page__body">
        <header className="page__header">
          <Heading level={1}>Статистика</Heading>
        </header>
        <SegmentedControl label="Период" value={period} onChange={(v) => setPeriod(v as StatsPeriod)} layout="fill">
          {PERIODS.map((p) => (
            <SegmentedControlItem key={p.value} value={p.value} label={p.label} />
          ))}
        </SegmentedControl>

        {q.isPending ? (
          <ListSkeleton rows={3} height={88} />
        ) : q.isError ? (
          <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <StatsBody s={q.data} currency={currency} />
        )}
      </div>
    </main>
  );
}

function StatsBody({ s, currency }: { s: StatsT; currency: string }) {
  const max = Math.max(1, ...s.by_day.map((d) => d.received_cents));
  return (
    <>
      <Text type="supporting" color="secondary" display="block">
        {s.label}: {fmt(`${s.from}T12:00:00Z`, 'UTC', 'd MMM')} – {fmt(`${s.to}T12:00:00Z`, 'UTC', 'd MMM')} · часовой пояс студии {s.timezone}
      </Text>
      <div className="kpis">
        <div className="kpi kpi--money">
          <span className="kpi__label">Получено денег</span>
          <span className="kpi__value">{money(s.received_cents, currency)}</span>
          <span className="kpi__hint">
            оплаты {money(s.payments_cents, currency)}
            {s.refunds_cents ? `, возвраты ${money(s.refunds_cents, currency)}` : ''}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi__label">Заезды</span>
          <span className="kpi__value">{s.visits}</span>
          <span className="kpi__hint">машины, которые приехали</span>
        </div>
        <div className="kpi">
          <span className="kpi__label">Выполнено заказов</span>
          <span className="kpi__value">{s.completed_orders}</span>
          <span className="kpi__hint">отмечены «готово»</span>
        </div>
        <div className="kpi">
          <span className="kpi__label">Записей</span>
          <span className="kpi__value">{s.bookings_total}</span>
          <span className="kpi__hint">
            отмен {s.cancelled}, не приехали {s.no_show}
          </span>
        </div>
      </div>
      {s.expected_cents > 0 ? (
        <div className="expected-note">
          <span>Ожидаемая стоимость будущих записей</span>
          <strong>{money(s.expected_cents, currency)}</strong>
          <Text type="supporting" color="secondary" display="block">
            Это не выручка: деньги ещё не получены, цены «от» могут измениться.
          </Text>
        </div>
      ) : null}
      {s.by_day.length > 1 ? (
        <figure className="bars" aria-label="Получено по дням">
          <figcaption className="bars__title">Получено по дням</figcaption>
          <div className="bars__plot">
            {s.by_day.map((d) => (
              <div key={d.day} className="bars__col" title={`${d.day}: ${money(d.received_cents, currency)}, заездов ${d.visits}`}>
                <span className="bars__bar" style={{ height: `${Math.round((d.received_cents / max) * 100)}%` }} />
                <span className="bars__label">{fmt(`${d.day}T12:00:00Z`, 'UTC', s.by_day.length > 10 ? 'd' : 'EEEEEE')}</span>
              </div>
            ))}
          </div>
          <table className="visually-hidden">
            <caption>Получено и заезды по дням</caption>
            <thead>
              <tr>
                <th>День</th>
                <th>Получено</th>
                <th>Заезды</th>
              </tr>
            </thead>
            <tbody>
              {s.by_day.map((d) => (
                <tr key={d.day}>
                  <td>{d.day}</td>
                  <td>{money(d.received_cents, currency)}</td>
                  <td>{d.visits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      ) : null}
    </>
  );
}
