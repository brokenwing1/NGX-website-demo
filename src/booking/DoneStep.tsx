import { Button, Text } from '@astryxdesign/core';
import { CheckCircle } from '@phosphor-icons/react';
import type { CreateBookingResult } from '../lib/api';
import { fmtDayTime } from '../lib/time';
import { CalendarButton, ReminderControl } from './Reminder';
import { StepHeader } from './StepHeader';

export function DoneStep({ result, onOpen }: { result: CreateBookingResult; onOpen: () => void }) {
  const b = result.booking;
  return (
    <div className="step step--done">
      <div className="done-mark" aria-hidden="true">
        <CheckCircle size={56} weight="fill" />
      </div>
      <StepHeader title="Вы записаны" />
      <Text type="large" color="primary" display="block" className="done__when">
        {fmtDayTime(b.starts_at, b.tenant.timezone)}
      </Text>
      <Text type="body" color="secondary" display="block">
        {b.service_name} · {b.tenant.address}
      </Text>
      {b.is_demo ? (
        <Text type="supporting" color="secondary" display="block">
          Это тестовая запись: студия пока работает в режиме образца.
        </Text>
      ) : null}
      <div className="stack-2 done__actions">
        <ReminderControl booking={b} token={result.token} />
        <CalendarButton booking={b} token={result.token} />
        <Button variant="primary" size="lg" label="Открыть мою запись" width="100%" onClick={onOpen} />
      </div>
    </div>
  );
}
