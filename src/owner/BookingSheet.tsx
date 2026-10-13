import { Badge, BottomSheet, Button, Dialog, Divider, Heading, NumberInput, SegmentedControl, SegmentedControlItem, Switch, Text, TextInput } from '@astryxdesign/core';
import { ArrowsClockwise, CarProfile, CheckCircle, Phone, Prohibit, Wallet } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ListSkeleton } from '../components/States';
import { ownerApi, type BookingStatus, type OwnerBooking } from '../lib/api';
import { fmt, fmtDayTime, fmtTime, localDay, money, zonedToIso } from '../lib/time';
import { STATUS_LABEL } from '../pages/client/MyBookings';
import { StepHeader } from '../booking/StepHeader';
import { DateField, SelectField, TimeField } from './fields';
import { useOwner } from './OwnerApp';
import { useOwnerMutation } from './useOwnerMutation';

const METHOD_LABEL = { cash: 'Наличные', card: 'Карта', transfer: 'Перевод' } as const;

export function BookingSheet({ booking, onClose }: { booking: OwnerBooking | null; onClose: () => void }) {
  // keep the last booking rendered while the sheet animates out
  const [b, setB] = useState<OwnerBooking | null>(booking);
  useEffect(() => {
    if (booking) setB(booking);
  }, [booking]);
  return (
    <BottomSheet isOpen={!!booking} onOpenChange={(o) => !o && onClose()} label="Запись" height="tall" padding={4}>
      {b ? <BookingDetails key={b.id} booking={b} onClose={onClose} /> : null}
    </BottomSheet>
  );
}

function BookingDetails({ booking: b, onClose }: { booking: OwnerBooking; onClose: () => void }) {
  const { slug, settings } = useOwner();
  const tz = settings.tenant.timezone;
  const currency = settings.tenant.currency;
  const st = STATUS_LABEL[b.status];
  const [panel, setPanel] = useState<'none' | 'move' | 'pay'>('none');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  const setStatus = useOwnerMutation((s: BookingStatus) => ownerApi.setStatus(slug, b.id, s), { success: 'Статус обновлён', onSuccess: onClose });
  const cancel = useOwnerMutation(() => ownerApi.cancel(slug, b.id, reason), {
    success: 'Запись отменена',
    onSuccess: () => {
      setCancelOpen(false);
      onClose();
    },
  });

  return (
    <div className="step">
      <StepHeader title={b.service_name} onClose={onClose} />
      <div className="booking-sheet__badges">
        <Badge variant={st.variant} label={st.text} />
        {b.is_demo ? <Badge variant="purple" label="демо" /> : null}
        <Badge variant="neutral" label={b.source === 'client' ? 'записался онлайн' : 'добавлено вручную'} />
      </div>

      <dl className="summary">
        <div>
          <dt>Время</dt>
          <dd>
            {fmtDayTime(b.starts_at, tz)}
            <span className="summary__hint">
              {localDay(b.starts_at, tz) === localDay(b.ends_at, tz) ? `до ${fmtTime(b.ends_at, tz)}` : `до ${fmtDayTime(b.ends_at, tz)}`} · {b.resource_name}
            </span>
          </dd>
        </div>
        <div>
          <dt>Клиент</dt>
          <dd>
            {b.client_name}
            <a className="summary__link" href={`tel:${b.client_phone}`}>
              <Phone size={14} aria-hidden="true" /> {b.client_phone}
            </a>
          </dd>
        </div>
        <div>
          <dt>Машина</dt>
          <dd>{b.car}</dd>
        </div>
        {b.comment ? (
          <div>
            <dt>Комментарий</dt>
            <dd>{b.comment}</dd>
          </div>
        ) : null}
        <div>
          <dt>Цена</dt>
          <dd>
            {b.price_is_from ? 'от ' : ''}
            {money(b.price_cents, currency)}
            <span className="summary__hint">
              получено {money(b.paid_cents - b.refunded_cents, currency)}
              {b.refunded_cents ? ` (возвраты ${money(b.refunded_cents, currency)})` : ''}
            </span>
          </dd>
        </div>
        {b.status === 'cancelled' ? (
          <div>
            <dt>Отмена</dt>
            <dd>
              {b.cancelled_by === 'client' ? 'клиентом' : 'студией'}
              {b.cancelled_at ? `, ${fmt(b.cancelled_at, tz, 'd MMM HH:mm')}` : ''}
              {b.cancel_reason ? <span className="summary__hint">{b.cancel_reason}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="action-grid">
        {b.status === 'confirmed' ? (
          <>
            <Button variant="primary" label="Машина принята" icon={<CarProfile size={18} />} isLoading={setStatus.isPending} onClick={() => setStatus.mutate('arrived')} />
            <Button label="Готово" icon={<CheckCircle size={18} />} onClick={() => setStatus.mutate('completed')} />
            <Button label="Не приехал" icon={<Prohibit size={18} />} onClick={() => setStatus.mutate('no_show')} />
            <Button label="Перенести" icon={<ArrowsClockwise size={18} />} onClick={() => setPanel(panel === 'move' ? 'none' : 'move')} />
          </>
        ) : null}
        {b.status === 'arrived' ? (
          <>
            <Button variant="primary" label="Машина готова" icon={<CheckCircle size={18} />} isLoading={setStatus.isPending} onClick={() => setStatus.mutate('completed')} />
            <Button label="Вернуть в «записан»" onClick={() => setStatus.mutate('confirmed')} />
          </>
        ) : null}
        {b.status === 'completed' ? <Button label="Вернуть «на месте»" onClick={() => setStatus.mutate('arrived')} /> : null}
        {b.status !== 'cancelled' ? (
          <Button label="Оплата / возврат" icon={<Wallet size={18} />} onClick={() => setPanel(panel === 'pay' ? 'none' : 'pay')} />
        ) : null}
      </div>

      {panel === 'move' ? <MovePanel booking={b} onDone={onClose} /> : null}
      {panel === 'pay' || b.paid_cents > 0 ? <PaymentsPanel booking={b} showForm={panel === 'pay'} /> : null}

      {b.status === 'confirmed' ? (
        <>
          <Divider />
          <Button variant="destructive" label="Отменить запись" width="100%" onClick={() => setCancelOpen(true)} />
        </>
      ) : null}

      <Dialog isOpen={cancelOpen} onOpenChange={setCancelOpen} purpose="form" padding={4} width={420}>
        <div className="stack-3">
          <Heading level={2}>Отменить запись?</Heading>
          <Text type="body" color="secondary" display="block">
            {b.client_name}, {fmtDayTime(b.starts_at, tz)}. Время освободится для записи.
          </Text>
          <TextInput label="Причина (видна только вам)" value={reason} onChange={setReason} isOptional width="100%" />
          <div className="row-2">
            <Button label="Не отменять" width="100%" onClick={() => setCancelOpen(false)} />
            <Button variant="destructive" label="Отменить" width="100%" isLoading={cancel.isPending} onClick={() => cancel.mutate(undefined)} />
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function MovePanel({ booking: b, onDone }: { booking: OwnerBooking; onDone: () => void }) {
  const { slug, settings } = useOwner();
  const tz = settings.tenant.timezone;
  const svc = settings.services.find((s) => s.id === b.service_id);
  const resources = settings.resources.filter((r) => r.active && (svc?.resource_ids.includes(r.id) ?? true));
  const [day, setDay] = useState(localDay(b.starts_at, tz));
  const [time, setTime] = useState(fmtTime(b.starts_at, tz));
  const [resourceId, setResourceId] = useState<string>('');
  const [offGrid, setOffGrid] = useState(false);
  const move = useOwnerMutation(() => ownerApi.reschedule(slug, b.id, zonedToIso(day, time, tz), resourceId || null, offGrid), {
    success: 'Запись перенесена',
    onSuccess: onDone,
  });
  return (
    <section className="panel" aria-label="Перенос записи">
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
      <Switch label="Вне часов приёма и сетки" description="Например, договорились с клиентом на раннее утро" value={offGrid} onChange={setOffGrid} />
      <Button variant="primary" label="Перенести" width="100%" isLoading={move.isPending} onClick={() => move.mutate(undefined)} />
      <Text type="supporting" color="secondary" display="block">
        Если новое время занято, запись останется на прежнем месте.
      </Text>
    </section>
  );
}

function PaymentsPanel({ booking: b, showForm }: { booking: OwnerBooking; showForm: boolean }) {
  const { slug, settings } = useOwner();
  const tz = settings.tenant.timezone;
  const currency = settings.tenant.currency;
  const list = useQuery({ queryKey: ['owner', slug, 'payments', b.id], queryFn: () => ownerApi.payments(slug, b.id) });
  const [kind, setKind] = useState<'payment' | 'refund'>('payment');
  const [amount, setAmount] = useState<number | null>(b.price_is_from ? null : Math.max(0, (b.price_cents - (b.paid_cents - b.refunded_cents)) / 100) || null);
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer'>('card');
  const [note, setNote] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const add = useOwnerMutation(() => ownerApi.addPayment(slug, b.id, kind, Math.round((amount ?? 0) * 100), method, note, key), {
    success: kind === 'payment' ? 'Оплата внесена' : 'Возврат оформлен',
    onSuccess: () => {
      setKey(crypto.randomUUID());
      setNote('');
      void list.refetch();
    },
  });

  return (
    <section className="panel" aria-label="Оплаты">
      <h3 className="panel__title">Оплаты</h3>
      {list.isPending ? (
        <ListSkeleton rows={1} height={40} />
      ) : list.data && list.data.length ? (
        <ul className="payments">
          {list.data.map((p) => (
            <li key={p.id} className={`payment payment--${p.kind}`}>
              <span>{fmt(p.created_at, tz, 'd MMM HH:mm')}</span>
              <span>{METHOD_LABEL[p.method]}</span>
              <span className="payment__amount">
                {p.kind === 'refund' ? '−' : '+'}
                {money(p.amount_cents, currency)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Text type="supporting" color="secondary" display="block">
          Оплат пока нет.
        </Text>
      )}
      {showForm ? (
        <div className="stack-3">
          <SegmentedControl label="Операция" value={kind} onChange={(v) => setKind(v as 'payment' | 'refund')} layout="fill">
            <SegmentedControlItem value="payment" label="Оплата" />
            <SegmentedControlItem value="refund" label="Возврат" />
          </SegmentedControl>
          <NumberInput label="Сумма" value={amount} onChange={setAmount} min={0} step={100} units="₽" width="100%" />
          <SegmentedControl label="Способ" value={method} onChange={(v) => setMethod(v as 'cash' | 'card' | 'transfer')} layout="fill">
            <SegmentedControlItem value="card" label="Карта" />
            <SegmentedControlItem value="cash" label="Наличные" />
            <SegmentedControlItem value="transfer" label="Перевод" />
          </SegmentedControl>
          <TextInput label="Примечание" value={note} onChange={setNote} isOptional width="100%" />
          <Button
            variant="primary"
            label={kind === 'payment' ? 'Внести оплату' : 'Оформить возврат'}
            width="100%"
            isDisabled={!amount || amount <= 0}
            isLoading={add.isPending}
            onClick={() => add.mutate(undefined)}
          />
        </div>
      ) : null}
    </section>
  );
}
