import { Banner, Button, Text } from '@astryxdesign/core';
import { useStudio } from '../app/studio';
import type { ApiError, Service } from '../lib/api';
import { durationLabel, fmtDayTime, fmtTime, priceLabel } from '../lib/time';
import type { Contacts } from './ContactsStep';
import { normalizePhone } from './ContactsStep';
import { StepHeader } from './StepHeader';

export function ConfirmStep({
  service,
  startsAt,
  contacts,
  submitting,
  error,
  onSubmit,
  onBack,
}: {
  service: Service;
  startsAt: string;
  contacts: Contacts;
  submitting: boolean;
  error: ApiError | null;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const { tenant } = useStudio();
  const tz = tenant.timezone;
  const ends = new Date(new Date(startsAt).getTime() + service.duration_minutes * 60_000).toISOString();
  return (
    <div className="step">
      <StepHeader title="Проверьте запись" step={4} total={4} onBack={submitting ? undefined : onBack} />
      <dl className="summary">
        <div>
          <dt>Услуга</dt>
          <dd>{service.name}</dd>
        </div>
        <div>
          <dt>Когда</dt>
          <dd>
            {fmtDayTime(startsAt, tz)}
            <span className="summary__hint">
              {service.duration_minutes >= 1440 ? `готово ${fmtDayTime(ends, tz)}` : `до ${fmtTime(ends, tz)} · ${durationLabel(service.duration_minutes)}`}
            </span>
          </dd>
        </div>
        <div>
          <dt>Стоимость</dt>
          <dd>{priceLabel(service.price_cents, service.price_is_from, tenant.currency)}</dd>
        </div>
        <div>
          <dt>Клиент</dt>
          <dd>
            {contacts.name.trim()}, {normalizePhone(contacts.phone)}
            <span className="summary__hint">{contacts.car.trim()}</span>
          </dd>
        </div>
        <div>
          <dt>Адрес</dt>
          <dd>{tenant.address}</dd>
        </div>
      </dl>
      {tenant.cancellation_policy ? (
        <Text type="supporting" color="secondary" display="block" className="step__note">
          {tenant.cancellation_policy}
        </Text>
      ) : null}
      {error ? <Banner status="error" title={error.message} description={error.code === 'network' ? 'Нажмите ещё раз — повторная отправка не создаст вторую запись.' : undefined} /> : null}
      <div className="step__footer">
        <Button variant="primary" size="lg" label={error ? 'Повторить' : 'Подтвердить запись'} width="100%" isLoading={submitting} onClick={onSubmit} />
      </div>
    </div>
  );
}
