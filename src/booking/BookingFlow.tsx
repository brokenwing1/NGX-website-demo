// Booking as one consistent bottom-sheet flow:  service → time → contacts → confirm → done.
// The server decides price, duration and resource; the client only sends what the person chose.
import { BottomSheet, BottomSheetSwitcher } from '@astryxdesign/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useStudio, type BookingRequest } from '../app/studio';
import { api, ApiError, type CreateBookingResult } from '../lib/api';
import { loadContacts, myBookings, saveContacts } from '../lib/myBookings';
import { ConfirmStep } from './ConfirmStep';
import { ContactsStep, type Contacts } from './ContactsStep';
import { DoneStep } from './DoneStep';
import { ServiceStep } from './ServiceStep';
import { TimeStep } from './TimeStep';
import { useSheetHistory } from './useSheetHistory';

type Step = 'service' | 'time' | 'contacts' | 'confirm' | 'done';
const ORDER: Step[] = ['service', 'time', 'contacts', 'confirm', 'done'];

export function BookingFlow({
  request,
  onClose,
  onBooked,
}: {
  request: BookingRequest | null;
  onClose: () => void;
  onBooked: (bookingId: string) => void;
}) {
  const { slug, tenant } = useStudio();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step | null>(null);
  const [serviceId, setServiceId] = useState<string | undefined>();
  const [startsAt, setStartsAt] = useState<string | undefined>();
  const [contacts, setContacts] = useState<Contacts>(() => ({ ...loadContacts(), comment: '' }));
  const [idemKey, setIdemKey] = useState<string>(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [timeNotice, setTimeNotice] = useState<string | null>(null);
  const [result, setResult] = useState<CreateBookingResult | null>(null);

  // Open / preset from a request (button on a service, a slot suggested by the assistant, ?book=1…)
  useEffect(() => {
    if (!request) return;
    const svc = request.serviceId && tenant.services.some((s) => s.id === request.serviceId) ? request.serviceId : undefined;
    setServiceId(svc ?? (tenant.services.length === 1 ? tenant.services[0]!.id : undefined));
    setStartsAt(request.startsAt);
    setResult(null);
    setError(null);
    setTimeNotice(null);
    setIdemKey(crypto.randomUUID());
    setStep(svc ? (request.startsAt ? 'contacts' : 'time') : tenant.services.length === 1 ? 'time' : 'service');
  }, [request, tenant.services]);

  const service = tenant.services.find((s) => s.id === serviceId);

  const close = () => {
    const done = result;
    setStep(null);
    if (done) onBooked(done.booking.id);
    else onClose();
  };

  const back = (): boolean => {
    if (!step || step === 'done') {
      close();
      return false;
    }
    const idx = ORDER.indexOf(step);
    let prev = ORDER[idx - 1];
    if (prev === 'service' && tenant.services.length === 1) prev = undefined;
    if (!prev) {
      close();
      return false;
    }
    setStep(prev);
    return true;
  };
  useSheetHistory(step !== null, back);

  // Any change of what is being booked needs a new idempotency key.
  const changeKey = () => setIdemKey(crypto.randomUUID());

  const submit = async () => {
    if (!serviceId || !startsAt) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createBooking({
        slug,
        serviceId,
        startsAt,
        clientName: contacts.name.trim(),
        clientPhone: contacts.phone,
        car: contacts.car.trim(),
        comment: contacts.comment.trim(),
        idempotencyKey: idemKey,
      });
      saveContacts({ name: contacts.name.trim(), phone: contacts.phone, car: contacts.car.trim() });
      myBookings.save(slug, { id: res.booking.id, token: res.token, startsAt: res.booking.starts_at, serviceName: res.booking.service_name });
      setResult(res);
      setStep('done');
      void qc.invalidateQueries({ queryKey: ['availability', slug] });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('unknown', 'Не удалось записаться');
      if (['slot_taken', 'too_soon', 'outside_hours', 'too_far'].includes(err.code)) {
        // The time is gone: back to the time step with fresh availability; the next attempt is a new request.
        setTimeNotice(err.message);
        setStartsAt(undefined);
        changeKey();
        void qc.invalidateQueries({ queryKey: ['availability', slug, serviceId] });
        setStep('time');
      } else {
        // network errors keep the same key: a retry cannot create a second booking
        setError(err);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheetSwitcher activeSheet={step} onActiveSheetChange={(s) => (s === null ? close() : setStep(s as Step))}>
      <BottomSheet sheetId="service" label="Выбор услуги" height="capped" padding={4}>
        <ServiceStep
          services={tenant.services}
          currency={tenant.currency}
          selected={serviceId}
          onSelect={(id) => {
            if (id !== serviceId) {
              setStartsAt(undefined);
              changeKey();
            }
            setServiceId(id);
            setTimeNotice(null);
            setStep('time');
          }}
          onClose={close}
        />
      </BottomSheet>

      <BottomSheet sheetId="time" label="Выбор времени" height="tall" padding={4}>
        {service ? (
          <TimeStep
            service={service}
            selected={startsAt}
            notice={timeNotice}
            onSelect={(iso) => {
              if (iso !== startsAt) changeKey();
              setStartsAt(iso);
              setTimeNotice(null);
              setStep('contacts');
            }}
            onBack={tenant.services.length > 1 ? () => setStep('service') : undefined}
            onClose={close}
          />
        ) : null}
      </BottomSheet>

      <BottomSheet sheetId="contacts" label="Контакты" height="tall" padding={4} purpose="form">
        <ContactsStep
          value={contacts}
          onChange={(c) => {
            setContacts(c);
            changeKey();
          }}
          onBack={() => setStep('time')}
          onNext={() => setStep('confirm')}
        />
      </BottomSheet>

      <BottomSheet sheetId="confirm" label="Подтверждение записи" height="hug" padding={4} purpose="form">
        {service && startsAt ? (
          <ConfirmStep
            service={service}
            startsAt={startsAt}
            contacts={contacts}
            submitting={submitting}
            error={error}
            onSubmit={submit}
            onBack={() => setStep('contacts')}
          />
        ) : null}
      </BottomSheet>

      <BottomSheet sheetId="done" label="Вы записаны" height="hug" padding={4}>
        {result ? <DoneStep result={result} onOpen={close} /> : null}
      </BottomSheet>
    </BottomSheetSwitcher>
  );
}
