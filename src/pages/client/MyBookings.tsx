import { Badge, Button, Heading, Text } from '@astryxdesign/core';
import { CalendarBlank, CaretRight } from '@phosphor-icons/react';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useStudio } from '../../app/studio';
import { Empty, ListSkeleton } from '../../components/States';
import { api, ApiError, type BookingStatus } from '../../lib/api';
import { myBookings } from '../../lib/myBookings';
import { fmtDayTime } from '../../lib/time';

export const STATUS_LABEL: Record<BookingStatus, { text: string; variant: 'info' | 'success' | 'neutral' | 'warning' | 'error' }> = {
  confirmed: { text: 'Записаны', variant: 'info' },
  arrived: { text: 'Машина у нас', variant: 'warning' },
  completed: { text: 'Готово', variant: 'success' },
  cancelled: { text: 'Отменена', variant: 'neutral' },
  no_show: { text: 'Не состоялась', variant: 'neutral' },
};

export function MyBookings() {
  const { slug, tenant, openBooking, myBookingsVersion, bumpMyBookings } = useStudio();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saved = useMemo(() => myBookings.list(slug), [slug, myBookingsVersion]);
  const results = useQueries({
    queries: saved.map((b) => ({
      queryKey: ['booking', b.id],
      queryFn: () => api.booking(b.id, b.token),
      staleTime: 20_000,
    })),
  });

  if (saved.length === 0) {
    return (
      <main className="page page--plain">
        <div className="page__body">
          <header className="page__header">
            <Heading level={1}>Моя запись</Heading>
          </header>
          <Empty
            icon={<CalendarBlank size={36} weight="duotone" />}
            title="Записей пока нет"
            description="Запишитесь онлайн — запись появится здесь. Если записывались с другого телефона, откройте ссылку из подтверждения."
            action={<Button variant="primary" label="Записаться" onClick={() => openBooking()} />}
          />
        </div>
      </main>
    );
  }

  const rows = saved.map((s, i) => ({ saved: s, q: results[i]! }));
  const upcoming = rows.filter((r) => !r.q.data || (new Date(r.q.data.ends_at).getTime() > Date.now() && r.q.data.status !== 'cancelled'));
  const past = rows.filter((r) => !upcoming.includes(r));

  const renderRow = ({ saved: s, q }: (typeof rows)[number]) => {
    if (q.isPending)
      return (
        <li key={s.id}>
          <ListSkeleton rows={1} />
        </li>
      );
    if (q.isError) {
      const gone = q.error instanceof ApiError && q.error.code === 'booking_not_found';
      return (
        <li key={s.id} className="booking-row booking-row--error">
          <div>
            <span className="booking-row__title">{s.serviceName}</span>
            <Text type="supporting" color="secondary" display="block">
              {gone ? 'Запись больше недоступна' : 'Не удалось обновить статус'}
            </Text>
          </div>
          {gone ? (
            <Button variant="ghost" size="sm" label="Убрать" onClick={() => {
                myBookings.remove(slug, s.id);
                bumpMyBookings();
              }} />
          ) : (
            <Button variant="ghost" size="sm" label="Повторить" onClick={() => void q.refetch()} />
          )}
        </li>
      );
    }
    const b = q.data;
    const st = STATUS_LABEL[b.status];
    return (
      <li key={s.id}>
        <Link to={`/s/${slug}/my/${b.id}`} className="booking-row">
          <div className="booking-row__main">
            <span className="booking-row__title">{b.service_name}</span>
            <span className="booking-row__when">{fmtDayTime(b.starts_at, tenant.timezone)}</span>
          </div>
          <Badge variant={st.variant} label={st.text} />
          <CaretRight size={18} aria-hidden="true" />
        </Link>
      </li>
    );
  };

  return (
    <main className="page page--plain">
      <div className="page__body">
        <header className="page__header">
          <Heading level={1}>Моя запись</Heading>
        </header>
        {upcoming.length ? (
          <section className="section">
            <h2 className="section__eyebrow">Предстоящие</h2>
            <ul className="booking-list">{upcoming.map(renderRow)}</ul>
          </section>
        ) : (
          <Empty title="Предстоящих записей нет" action={<Button variant="primary" label="Записаться" onClick={() => openBooking()} />} />
        )}
        {past.length ? (
          <section className="section">
            <h2 className="section__eyebrow">Прошедшие и отменённые</h2>
            <ul className="booking-list booking-list--past">{past.map(renderRow)}</ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
