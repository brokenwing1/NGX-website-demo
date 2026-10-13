// Reminder & calendar controls with honest states (iPhone needs the installed app for push).
import { Button, Text } from '@astryxdesign/core';
import { BellRinging, CalendarPlus, CheckCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { api, type BookingPublic } from '../lib/api';
import { buildIcs, downloadIcs } from '../lib/ics';
import { bookingLink } from '../lib/myBookings';
import { PUSH_REASON_TEXT, pushSupport, subscribePush } from '../lib/pwa';
import { fmtDayTime } from '../lib/time';

export function CalendarButton({ booking, token }: { booking: BookingPublic; token: string }) {
  return (
    <Button
      label="Добавить в календарь"
      icon={<CalendarPlus size={18} />}
      width="100%"
      onClick={() =>
        downloadIcs(
          `zapis-${booking.tenant.slug}-${booking.starts_at.slice(0, 10)}.ics`,
          buildIcs({
            uid: `${booking.id}@${location.host}`,
            title: `${booking.service_name} — ${booking.tenant.name}`,
            description: `Запись: ${fmtDayTime(booking.starts_at, booking.tenant.timezone)}. Телефон студии: ${booking.tenant.phone}`,
            location: booking.tenant.address,
            start: booking.starts_at,
            end: booking.ends_at,
            url: bookingLink(booking.tenant.slug, booking.id, token),
          }),
        )
      }
    />
  );
}

export function ReminderControl({ booking, token }: { booking: BookingPublic; token: string }) {
  const support = pushSupport();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  if (booking.status !== 'confirmed') return null;
  if (new Date(booking.starts_at).getTime() - Date.now() < 24 * 3600_000) {
    return (
      <Text type="supporting" color="secondary" display="block">
        До записи меньше суток — напоминание за сутки уже не придёт. Добавьте запись в календарь.
      </Text>
    );
  }
  if (!support.ok) {
    return (
      <Text type="supporting" color="secondary" display="block" className="reminder-note">
        {PUSH_REASON_TEXT[support.reason]}
      </Text>
    );
  }
  if (state === 'done') {
    return (
      <p className="reminder-ok" role="status">
        <CheckCircle size={18} weight="fill" aria-hidden="true" />
        {message}
      </p>
    );
  }
  return (
    <div className="stack-2">
      <Button
        label="Напомнить за сутки"
        icon={<BellRinging size={18} />}
        width="100%"
        isLoading={state === 'busy'}
        onClick={async () => {
          setState('busy');
          try {
            const sub = await subscribePush(booking.tenant.slug);
            const res = await api.saveBookingPush(booking.id, token, sub);
            setMessage(
              res.delivers
                ? 'Напомним за сутки до визита.'
                : 'Подписка сохранена, но студия работает в режиме образца — уведомления не отправляются.',
            );
            setState('done');
          } catch (e) {
            setMessage((e as Error).message);
            setState('error');
          }
        }}
      />
      {state === 'error' && message ? (
        <Text type="supporting" color="secondary" display="block" role="alert">
          {message}
        </Text>
      ) : null}
    </div>
  );
}
