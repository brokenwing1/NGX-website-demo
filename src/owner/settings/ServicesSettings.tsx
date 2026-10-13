import { BottomSheet, Button, CheckboxInput, NumberInput, Switch, Text, TextArea, TextInput } from '@astryxdesign/core';
import { Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { StepHeader } from '../../booking/StepHeader';
import { Photo } from '../../components/Photo';
import { ownerApi, type OwnerService } from '../../lib/api';
import { durationLabel, money } from '../../lib/time';
import { useOwner } from '../OwnerApp';
import { useOwnerMutation } from '../useOwnerMutation';
import { PhotoPicker } from './PhotoPicker';

export function ServicesSettings() {
  const { settings } = useOwner();
  const [editing, setEditing] = useState<OwnerService | 'new' | null>(null);
  return (
    <div className="stack-3">
      <Button variant="primary" label="Добавить услугу" icon={<Plus size={18} />} width="100%" onClick={() => setEditing('new')} />
      <ul className="stack-2">
        {settings.services.map((s) => (
          <li key={s.id}>
            <button type="button" className={`service-row ${s.active ? '' : 'is-inactive'}`} onClick={() => setEditing(s)}>
              <span className="service-row__thumb">
                <Photo path={s.image_path} alt="" />
              </span>
              <span className="service-row__text">
                <span className="service-row__title">{s.name}</span>
                <span className="service-row__meta">
                  {s.price_is_from ? 'от ' : ''}
                  {money(s.price_cents, settings.tenant.currency)} · {durationLabel(s.duration_minutes)}
                  {s.active ? '' : ' · скрыта'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <BottomSheet isOpen={editing !== null} onOpenChange={(o) => !o && setEditing(null)} label="Услуга" height="tall" padding={4} purpose="form">
        {editing ? <ServiceForm key={editing === 'new' ? 'new' : editing.id} service={editing === 'new' ? null : editing} onDone={() => setEditing(null)} /> : null}
      </BottomSheet>
    </div>
  );
}

function ServiceForm({ service, onDone }: { service: OwnerService | null; onDone: () => void }) {
  const { slug, settings } = useOwner();
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [category, setCategory] = useState(service?.category ?? '');
  const [price, setPrice] = useState<number | null>(service ? service.price_cents / 100 : null);
  const [priceFrom, setPriceFrom] = useState(service?.price_is_from ?? false);
  const [days, setDays] = useState(service ? Math.floor(service.duration_minutes / 1440) : 0);
  const [minutes, setMinutes] = useState(service ? service.duration_minutes % 1440 : 60);
  const [buffer, setBuffer] = useState(service?.buffer_minutes ?? 0);
  const [active, setActive] = useState(service?.active ?? true);
  const [resourceIds, setResourceIds] = useState<string[]>(service?.resource_ids ?? settings.resources.filter((r) => r.active).map((r) => r.id));
  const [image, setImage] = useState<string | null>(service?.image_path ?? null);
  const duration = days * 1440 + minutes;
  const valid = name.trim() && price !== null && price >= 0 && duration >= 10 && duration <= 20160 && resourceIds.length > 0;

  const save = useOwnerMutation(
    () =>
      ownerApi.upsertService(
        slug,
        service?.id ?? null,
        {
          name: name.trim(),
          description,
          category,
          price_cents: Math.round((price ?? 0) * 100),
          price_is_from: priceFrom,
          duration_minutes: duration,
          buffer_minutes: buffer,
          active,
          ...(image !== (service?.image_path ?? null) ? { image_path: image } : {}),
        },
        resourceIds,
      ),
    { success: service ? 'Услуга сохранена' : 'Услуга добавлена', onSuccess: onDone },
  );

  return (
    <form
      className="step"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate(undefined);
      }}
    >
      <StepHeader title={service ? 'Изменить услугу' : 'Новая услуга'} onClose={onDone} />
      <div className="stack-3">
        <TextInput label="Название" value={name} onChange={setName} width="100%" />
        <div className="row-2">
          <NumberInput label="Цена" value={price} onChange={setPrice} min={0} step={100} units="₽" width="100%" />
          <TextInput label="Категория" value={category} onChange={setCategory} isOptional width="100%" />
        </div>
        <Switch label="Цена «от»" description="Окончательная сумма после осмотра" value={priceFrom} onChange={setPriceFrom} />
        {service && price !== null && Math.round(price * 100) !== service.price_cents ? (
          <Text type="supporting" color="secondary" display="block">
            Уже созданные записи сохранят прежнюю цену.
          </Text>
        ) : null}
        <div className="row-3">
          <NumberInput label="Дней" value={days} onChange={(v) => setDays(Math.max(0, Math.min(14, v ?? 0)))} min={0} max={14} isIntegerOnly width="100%" />
          <NumberInput label="Минут" value={minutes} onChange={(v) => setMinutes(Math.max(0, Math.min(1439, v ?? 0)))} min={0} max={1439} step={15} isIntegerOnly width="100%" />
          <NumberInput label="Буфер, мин" value={buffer} onChange={(v) => setBuffer(Math.max(0, Math.min(720, v ?? 0)))} min={0} max={720} step={5} isIntegerOnly width="100%" />
        </div>
        <Text type="supporting" color="secondary" display="block">
          Длительность: {durationLabel(duration) || '—'}. Буфер — время на подготовку поста после машины.
        </Text>
        <TextArea label="Описание" value={description} onChange={setDescription} rows={3} maxLength={600} width="100%" />
        <fieldset className="checks">
          <legend>На каких постах выполняется</legend>
          {settings.resources.map((r) => (
            <CheckboxInput
              key={r.id}
              label={r.active ? r.name : `${r.name} (не принимает записи)`}
              value={resourceIds.includes(r.id)}
              onChange={(on) => setResourceIds((ids) => (on ? [...ids, r.id] : ids.filter((x) => x !== r.id)))}
            />
          ))}
        </fieldset>
        <div className="media-preview">
          <Photo path={image} alt="Фото услуги" />
        </div>
        <PhotoPicker label={image ? 'Заменить фото' : 'Добавить фото'} onUploaded={(p) => setImage(p)} />
        <Switch label="Показывать клиентам" value={active} onChange={setActive} />
      </div>
      <div className="step__footer">
        <Button type="submit" variant="primary" size="lg" label="Сохранить" width="100%" isDisabled={!valid} isLoading={save.isPending} />
      </div>
    </form>
  );
}
