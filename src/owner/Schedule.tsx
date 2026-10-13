import { Badge, Button, Heading, IconButton, SegmentedControl, SegmentedControlItem, Text } from '@astryxdesign/core';
import { Cards, CaretLeft, CaretRight, Clock, Images, ListBullets, LockSimple, Plus, Storefront } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ErrorState, ListSkeleton } from '../components/States';
import { ownerApi, type OwnerBooking } from '../lib/api';
import { addDaysStr, dayLabel, fmt, fmtTime, localDay, money, zonedToIso } from '../lib/time';
import { STATUS_LABEL } from '../pages/client/MyBookings';
import { BlockSheet } from './BlockSheet';
import { BookingSheet } from './BookingSheet';
import { NewBookingSheet } from './NewBookingSheet';
import { useOwner } from './OwnerApp';

export function useOwnerBookings(from: string, to: string) {
  const { slug, settings } = useOwner();
  const tz = settings.tenant.timezone;
  return useQuery({
    queryKey: ['owner', slug, 'bookings', from, to],
    queryFn: () => ownerApi.bookings(slug, zonedToIso(from, '00:00', tz), zonedToIso(addDaysStr(to, 1), '00:00', tz)),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function Schedule() {
  const { settings, slug } = useOwner();
  const tz = settings.tenant.timezone;
  const today = settings.today;
  const [view, setView] = useState<'day' | 'week'>('day');
  const [day, setDay] = useState(today);
  const [open, setOpen] = useState<OwnerBooking | null>(null);
  const [creating, setCreating] = useState(false);
  const [blocking, setBlocking] = useState(false);

  const weekStart = useMemo(() => {
    const d = new Date(`${day}T12:00:00`);
    const wd = d.getDay() === 0 ? 7 : d.getDay();
    return addDaysStr(day, 1 - wd);
  }, [day]);
  const from = view === 'day' ? day : weekStart;
  const to = view === 'day' ? day : addDaysStr(weekStart, 6);
  const q = useOwnerBookings(from, to);

  const active = (q.data ?? []).filter((b) => b.status !== 'cancelled');
  const stat = {
    total: active.length,
    arrived: active.filter((b) => b.status === 'arrived').length,
    done: active.filter((b) => b.status === 'completed').length,
    received: (q.data ?? []).reduce((s, b) => s + b.paid_cents - b.refunded_cents, 0),
  };
  const shift = (n: number) => setDay(addDaysStr(day, view === 'day' ? n : n * 7));
  const l = dayLabel(day, today);

  return (
    <main className="page page--plain owner-page">
      <div className="page__body">
        <header className="page-title">
          <Heading level={1}>Расписание</Heading>
          <Text type="body" color="secondary" display="block">
            {settings.tenant.name}
          </Text>
        </header>
        <div className="schedule-toolbar">
          <SegmentedControl label="Вид" value={view} onChange={(v) => setView(v as 'day' | 'week')} size="sm">
            <SegmentedControlItem value="day" label="День" />
            <SegmentedControlItem value="week" label="Неделя" />
          </SegmentedControl>
          <div className="date-nav">
            <IconButton variant="ghost" label={view === 'day' ? 'Предыдущий день' : 'Предыдущая неделя'} icon={<CaretLeft size={18} />} onClick={() => shift(-1)} />
            <button type="button" className="date-nav__label" onClick={() => setDay(today)} title="Сегодня">
              {view === 'day' ? `${l.top}, ${l.bottom}` : `${fmt(`${weekStart}T12:00:00Z`, 'UTC', 'd MMM')} – ${fmt(`${addDaysStr(weekStart, 6)}T12:00:00Z`, 'UTC', 'd MMM')}`}
            </button>
            <IconButton variant="ghost" label={view === 'day' ? 'Следующий день' : 'Следующая неделя'} icon={<CaretRight size={18} />} onClick={() => shift(1)} />
          </div>
        </div>

        <div className="kpis kpis--compact" aria-live="polite">
          <div className="kpi">
            <span className="kpi__value">{q.isPending ? '—' : stat.total}</span>
            <span className="kpi__label">записей</span>
          </div>
          <div className="kpi">
            <span className="kpi__value">{q.isPending ? '—' : stat.arrived}</span>
            <span className="kpi__label">на месте</span>
          </div>
          <div className="kpi">
            <span className="kpi__value">{q.isPending ? '—' : stat.done}</span>
            <span className="kpi__label">готово</span>
          </div>
          <div className="kpi kpi--wide">
            <span className="kpi__label">получено</span>
            <span className="kpi__value">{q.isPending ? '—' : money(stat.received, settings.tenant.currency)}</span>
          </div>
        </div>

        <div className="row-2">
          <Button variant="primary" label="Новая запись" icon={<Plus size={18} />} onClick={() => setCreating(true)} width="100%" />
          <Button label="Закрыть пост" icon={<LockSimple size={18} />} onClick={() => setBlocking(true)} width="100%" />
        </div>

        {q.isPending ? (
          <ListSkeleton rows={4} />
        ) : q.isError ? (
          <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
        ) : view === 'day' ? (
          <DayView day={day} bookings={q.data} onOpen={setOpen} />
        ) : (
          <WeekView
            weekStart={weekStart}
            today={today}
            tz={tz}
            bookings={q.data}
            onDay={(d) => {
              setDay(d);
              setView('day');
            }}
          />
        )}

        <section className="section" aria-labelledby="quick-settings">
          <h2 id="quick-settings" className="section__title">
            Витрина и настройки
          </h2>
          <ul className="tile-grid">
            {[
              { to: 'hours', label: 'Часы работы', icon: Clock },
              { to: 'studio', label: 'Контакты и фото', icon: Storefront },
              { to: 'services', label: 'Услуги и цены', icon: ListBullets },
              { to: 'cards', label: 'Карточки витрины', icon: Cards },
              { to: 'gallery', label: 'Фото работ', icon: Images },
              { to: 'resources', label: 'Боксы и посты', icon: LockSimple },
            ].map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link to={`/s/${slug}/owner/settings/${to}`} className="tile">
                  <span className="tile__icon" aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <span className="tile__label">{label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <BookingSheet booking={open} onClose={() => setOpen(null)} />
      <NewBookingSheet isOpen={creating} initialDay={day} onClose={() => setCreating(false)} />
      <BlockSheet isOpen={blocking} initialDay={day} onClose={() => setBlocking(false)} />
    </main>
  );
}

function BookingItem({ b, tz, currency, onOpen }: { b: OwnerBooking; tz: string; currency: string; onOpen: () => void }) {
  const st = STATUS_LABEL[b.status];
  const multiDay = localDay(b.starts_at, tz) !== localDay(b.ends_at, tz);
  const paid = b.paid_cents - b.refunded_cents;
  return (
    <button type="button" className={`slot-card status-${b.status}`} onClick={onOpen}>
      <span className="slot-card__time">
        {fmtTime(b.starts_at, tz)}
        <span className="slot-card__end">{multiDay ? `→ ${fmt(b.ends_at, tz, 'd MMM HH:mm')}` : `– ${fmtTime(b.ends_at, tz)}`}</span>
      </span>
      <span className="slot-card__main">
        <span className="slot-card__title">{b.service_name}</span>
        <span className="slot-card__sub">
          {b.client_name} · {b.car}
        </span>
        <span className="slot-card__money">
          {money(b.price_cents, currency)}
          {b.price_is_from ? '+' : ''}
          {paid > 0 ? ` · оплачено ${money(paid, currency)}` : ''}
        </span>
      </span>
      <span className="slot-card__badges">
        <Badge variant={st.variant} label={st.text} />
        {b.is_demo ? <Badge variant="purple" label="демо" /> : null}
        {b.source === 'client' ? <Badge variant="blue" label="онлайн" /> : null}
      </span>
    </button>
  );
}

function DayView({ day, bookings, onOpen }: { day: string; bookings: OwnerBooking[]; onOpen: (b: OwnerBooking) => void }) {
  const { settings } = useOwner();
  const tz = settings.tenant.timezone;
  const resources = settings.resources.filter((r) => r.active || bookings.some((b) => b.resource_id === r.id));
  const dayStart = new Date(zonedToIso(day, '00:00', tz)).getTime();
  const dayEnd = new Date(zonedToIso(addDaysStr(day, 1), '00:00', tz)).getTime();
  const blocks = settings.blocks.filter((x) => new Date(x.starts_at).getTime() < dayEnd && new Date(x.ends_at).getTime() > dayStart);
  const [showCancelled, setShowCancelled] = useState(false);
  const cancelled = bookings.filter((b) => b.status === 'cancelled');

  if (bookings.length === 0 && blocks.length === 0) {
    return (
      <Text type="body" color="secondary" display="block" className="empty-day">
        На этот день записей нет.
      </Text>
    );
  }
  return (
    <div className="stack-4">
      {resources.map((r) => {
        const list = bookings.filter((b) => b.resource_id === r.id && b.status !== 'cancelled');
        const rb = blocks.filter((x) => x.resource_id === r.id);
        if (list.length === 0 && rb.length === 0) return null;
        return (
          <section key={r.id} className="resource-lane" aria-label={r.name}>
            <h3 className="resource-lane__title">{r.name}</h3>
            <div className="stack-2">
              {rb.map((x) => (
                <div key={x.id} className="block-card">
                  <LockSimple size={16} aria-hidden="true" />
                  <span>
                    Закрыт {fmt(x.starts_at, tz, 'd MMM HH:mm')} – {fmt(x.ends_at, tz, 'd MMM HH:mm')}
                    {x.reason ? ` · ${x.reason}` : ''}
                  </span>
                </div>
              ))}
              {list.map((b) => (
                <BookingItem key={b.id} b={b} tz={tz} currency={settings.tenant.currency} onOpen={() => onOpen(b)} />
              ))}
            </div>
          </section>
        );
      })}
      {cancelled.length ? (
        <section className="section">
          <Button variant="ghost" size="sm" label={showCancelled ? 'Скрыть отменённые' : `Отменённые (${cancelled.length})`} onClick={() => setShowCancelled((v) => !v)} />
          {showCancelled ? (
            <div className="stack-2">
              {cancelled.map((b) => (
                <BookingItem key={b.id} b={b} tz={tz} currency={settings.tenant.currency} onOpen={() => onOpen(b)} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function WeekView({ weekStart, today, tz, bookings, onDay }: { weekStart: string; today: string; tz: string; bookings: OwnerBooking[]; onDay: (d: string) => void }) {
  return (
    <ul className="week">
      {Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i)).map((d) => {
        const list = bookings.filter((b) => b.status !== 'cancelled' && localDay(b.starts_at, tz) === d);
        const l = dayLabel(d, today);
        return (
          <li key={d}>
            <button type="button" className={`week__day ${d === today ? 'is-today' : ''}`} onClick={() => onDay(d)}>
              <span className="week__label">
                {l.top}, {l.bottom}
              </span>
              <span className="week__count">{list.length ? `${list.length} зап.` : '—'}</span>
              <span className="week__items">
                {list.slice(0, 4).map((b) => (
                  <span key={b.id} className="week__item">
                    {fmtTime(b.starts_at, tz)} {b.service_name}
                  </span>
                ))}
                {list.length > 4 ? <span className="week__item">и ещё {list.length - 4}</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
