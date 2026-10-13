import { AlertDialog, Badge, Banner, Button, Heading, Text } from '@astryxdesign/core';
import { ArrowLeft, Copy, NavigationArrow, Phone } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useStudio } from '../../app/studio';
import { CalendarButton, ReminderControl } from '../../booking/Reminder';
import { Empty, ErrorState, ListSkeleton } from '../../components/States';
import { api, ApiError } from '../../lib/api';
import { bookingLink, myBookings } from '../../lib/myBookings';
import { durationLabel, fmtDayTime, fmtTime, priceLabel } from '../../lib/time';
import { STATUS_LABEL } from './MyBookings';

export function BookingDetails() {
  const { bookingId = '' } = useParams();
  const { slug, tenant, bumpMyBookings, openBooking } = useStudio();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [copied, setCopied] = useState(false);

  // Token from the link fragment (#t=...) or from this device's saved bookings.
  const token = useMemo(() => {
    const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('t');
    return fromHash ?? myBookings.get(slug, bookingId)?.token ?? null;
  }, [location.hash, slug, bookingId]);

  const q = useQuery({
    queryKey: ['booking', bookingId],
    queryFn: () => api.booking(bookingId, token!),
    enabled: !!token,
  });

  // Remember a booking opened from a link, and drop the token from the address bar.
  useEffect(() => {
    if (q.data && token && location.hash) {
      myBookings.save(slug, { id: q.data.id, token, startsAt: q.data.starts_at, serviceName: q.data.service_name });
      bumpMyBookings();
      navigate({ pathname: location.pathname, hash: '' }, { replace: true });
    }
  }, [q.data, token, location.hash, location.pathname, slug, navigate, bumpMyBookings]);

  const cancel = useMutation({
    mutationFn: () => api.cancelBooking(bookingId, token!),
    onSuccess: (b) => {
      qc.setQueryData(['booking', bookingId], b);
      void qc.invalidateQueries({ queryKey: ['availability', slug] });
      bumpMyBookings();
      setConfirmCancel(false);
    },
  });

  const back = (
    <Link to={`/s/${slug}/my`} className="back-link">
      <ArrowLeft size={18} aria-hidden="true" /> Мои записи
    </Link>
  );

  if (!token) {
    return (
      <main className="page page--plain">
        <div className="page__body">
          {back}
          <Empty title="Нет доступа к записи" description="Откройте ссылку из подтверждения записи на том телефоне, где записывались." />
        </div>
      </main>
    );
  }
  if (q.isPending) {
    return (
      <main className="page page--plain">
        <div className="page__body">
          {back}
          <ListSkeleton rows={3} height={64} />
        </div>
      </main>
    );
  }
  if (q.isError) {
    return (
      <main className="page page--plain">
        <div className="page__body">
          {back}
          {q.error instanceof ApiError && q.error.code === 'booking_not_found' ? (
            <Empty title="Запись не найдена" description="Ссылка устарела или запись удалена студией." />
          ) : (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          )}
        </div>
      </main>
    );
  }

  const b = q.data;
  const tz = b.tenant.timezone;
  const st = STATUS_LABEL[b.status];
  return (
    <main className="page page--plain">
      <div className="page__body">
        {back}
        <header className="booking-head">
          <Badge variant={st.variant} label={st.text} />
          <Heading level={1}>{b.service_name}</Heading>
          <Text type="large" color="primary" display="block">
            {fmtDayTime(b.starts_at, tz)}
          </Text>
          <Text type="supporting" color="secondary" display="block">
            {b.duration_minutes >= 1440 ? `Готово: ${fmtDayTime(b.ends_at, tz)}` : `До ${fmtTime(b.ends_at, tz)} · ${durationLabel(b.duration_minutes)}`}
          </Text>
        </header>

        {b.is_demo ? <Banner status="info" title="Тестовая запись" description="Студия работает в режиме образца." /> : null}

        <dl className="summary">
          <div>
            <dt>Стоимость</dt>
            <dd>{priceLabel(b.price_cents, b.price_is_from, b.tenant.currency)}</dd>
          </div>
          <div>
            <dt>Автомобиль</dt>
            <dd>{b.car}</dd>
          </div>
          <div>
            <dt>Адрес</dt>
            <dd>{b.tenant.address}</dd>
          </div>
          {b.comment ? (
            <div>
              <dt>Комментарий</dt>
              <dd>{b.comment}</dd>
            </div>
          ) : null}
        </dl>

        <div className="stack-2">
          <div className="row-2">
            <Button label="Позвонить" icon={<Phone size={18} />} href={`tel:${b.tenant.phone.replace(/[^+\d]/g, '')}`} width="100%" />
            {b.tenant.map_url ? (
              <Button label="Маршрут" icon={<NavigationArrow size={18} />} href={b.tenant.map_url} target="_blank" rel="noopener noreferrer" width="100%" />
            ) : null}
          </div>
          {b.status === 'confirmed' ? (
            <>
              <ReminderControl booking={b} token={token} />
              <CalendarButton booking={b} token={token} />
              <Button
                label={copied ? 'Ссылка скопирована' : 'Скопировать ссылку на запись'}
                icon={<Copy size={18} />}
                variant="ghost"
                width="100%"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(bookingLink(slug, b.id, token));
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              />
            </>
          ) : null}
        </div>

        {b.status === 'confirmed' ? (
          <section className="section">
            {b.can_cancel ? (
              <Button variant="destructive" label="Отменить запись" width="100%" onClick={() => setConfirmCancel(true)} />
            ) : (
              <Text type="supporting" color="secondary" display="block">
                Онлайн-отмена была доступна до {fmtDayTime(b.cancel_deadline, tz)}. Чтобы отменить или перенести, позвоните: {b.tenant.phone}
              </Text>
            )}
            {tenant.cancellation_policy ? (
              <Text type="supporting" color="secondary" display="block" className="step__note">
                {tenant.cancellation_policy}
              </Text>
            ) : null}
          </section>
        ) : (
          <section className="section">
            <Button variant="primary" label="Записаться снова" width="100%" onClick={() => openBooking({ serviceId: b.service_id })} />
          </section>
        )}

        <AlertDialog
          isOpen={confirmCancel}
          onOpenChange={setConfirmCancel}
          title="Отменить запись?"
          description={`${b.service_name}, ${fmtDayTime(b.starts_at, tz)}. Время освободится для других клиентов.`}
          actionLabel="Отменить запись"
          cancelLabel="Оставить"
          isActionLoading={cancel.isPending}
          onAction={() => cancel.mutate()}
        />
        {cancel.isError ? <Banner status="error" title={(cancel.error as ApiError).message} /> : null}
      </div>
    </main>
  );
}
