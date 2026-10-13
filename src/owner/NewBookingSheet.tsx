import { BottomSheet, Button, Switch, Text, TextArea, TextInput } from '@astryxdesign/core';
import { useEffect, useState } from 'react';
import { StepHeader } from '../booking/StepHeader';
import { normalizePhone } from '../booking/ContactsStep';
import { ownerApi } from '../lib/api';
import { durationLabel, money, zonedToIso } from '../lib/time';
import { DateField, SelectField, TimeField } from './fields';
import { useOwner } from './OwnerApp';
import { useOwnerMutation } from './useOwnerMutation';

/** Manual booking by the owner (phone call, walk-in). Same atomic SQL as online booking. */
export function NewBookingSheet({ isOpen, initialDay, onClose }: { isOpen: boolean; initialDay: string; onClose: () => void }) {
  const { slug, settings } = useOwner();
  const tz = settings.tenant.timezone;
  const services = settings.services.filter((s) => s.active);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [day, setDay] = useState(initialDay);
  const [time, setTime] = useState('10:00');
  const [resourceId, setResourceId] = useState('');
  const [offGrid, setOffGrid] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [car, setCar] = useState('');
  const [comment, setComment] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDay(initialDay);
      setKey(crypto.randomUUID());
      setTouched(false);
    }
  }, [isOpen, initialDay]);

  const svc = services.find((s) => s.id === serviceId);
  const resources = settings.resources.filter((r) => r.active && svc?.resource_ids.includes(r.id));
  const valid = !!svc && name.trim() && normalizePhone(phone) && car.trim() && day && time;

  const create = useOwnerMutation(
    () =>
      ownerApi.createBooking(slug, {
        serviceId,
        startsAt: zonedToIso(day, time, tz),
        clientName: name.trim(),
        clientPhone: phone,
        car: car.trim(),
        comment: comment.trim(),
        idempotencyKey: key,
        resourceId: resourceId || null,
        allowOffGrid: offGrid,
      }),
    {
      success: 'Запись добавлена',
      onSuccess: () => {
        setName('');
        setPhone('');
        setCar('');
        setComment('');
        onClose();
      },
    },
  );

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={(o) => !o && onClose()} label="Новая запись" height="tall" padding={4} purpose="form">
      <form
        className="step"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (valid) create.mutate(undefined);
        }}
      >
        <StepHeader title="Новая запись" onClose={onClose} />
        <div className="stack-3">
          <SelectField label="Услуга" value={serviceId} onChange={(v) => {
            setServiceId(v);
            setResourceId('');
            setKey(crypto.randomUUID());
          }}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {durationLabel(s.duration_minutes)} · {money(s.price_cents, settings.tenant.currency)}
              </option>
            ))}
          </SelectField>
          <div className="row-2">
            <DateField label="День" value={day} onChange={setDay} />
            <TimeField label="Время" value={time} onChange={setTime} />
          </div>
          <SelectField label="Пост" value={resourceId} onChange={setResourceId}>
            <option value="">Любой свободный</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
          <Switch label="Вне часов приёма и сетки" value={offGrid} onChange={setOffGrid} />
          <TextInput label="Имя клиента" value={name} onChange={setName} width="100%" status={touched && !name.trim() ? { type: 'error', message: 'Укажите имя' } : undefined} />
          <TextInput
            label="Телефон"
            value={phone}
            onChange={setPhone}
            width="100%"
            autoComplete="off"
            status={touched && !normalizePhone(phone) ? { type: 'error', message: 'Проверьте номер' } : undefined}
            {...({ inputMode: 'tel' } as Record<string, string>)}
          />
          <TextInput label="Автомобиль" value={car} onChange={setCar} width="100%" status={touched && !car.trim() ? { type: 'error', message: 'Укажите машину' } : undefined} />
          <TextArea label="Комментарий" value={comment} onChange={setComment} isOptional rows={2} width="100%" />
          {svc ? (
            <Text type="supporting" color="secondary" display="block">
              Цена и длительность берутся из услуги: {money(svc.price_cents, settings.tenant.currency)}, {durationLabel(svc.duration_minutes)}.
            </Text>
          ) : null}
        </div>
        <div className="step__footer">
          <Button type="submit" variant="primary" size="lg" label="Добавить запись" width="100%" isLoading={create.isPending} />
        </div>
      </form>
    </BottomSheet>
  );
}
