import { Button, NumberInput, Text, TextArea, TextInput } from '@astryxdesign/core';
import { useState } from 'react';
import { Photo } from '../../components/Photo';
import { ownerApi } from '../../lib/api';
import { useOwner } from '../OwnerApp';
import { useOwnerMutation } from '../useOwnerMutation';
import { PhotoPicker } from './PhotoPicker';

export function StudioSettings() {
  const { slug, settings } = useOwner();
  const t = settings.tenant;
  const [f, setF] = useState({
    name: t.name,
    short_name: t.short_name,
    tagline: t.tagline,
    description: t.description,
    address: t.address,
    phone: t.phone,
    map_url: t.map_url ?? '',
    messenger_url: t.messenger_url ?? '',
    cancellation_policy: t.cancellation_policy,
    cancel_cutoff_hours: t.cancel_cutoff_hours,
  });
  const save = useOwnerMutation(() => ownerApi.updateTenant(slug, f), { success: 'Сохранено' });
  const setMedia = useOwnerMutation((patch: Record<string, string>) => ownerApi.updateTenant(slug, patch), { success: 'Фото обновлено' });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const urlOk = (u: string) => !u || /^https:\/\//.test(u);

  return (
    <div className="stack-4">
      <section className="panel">
        <h2 className="panel__title">Главное фото</h2>
        <div className="media-preview media-preview--wide">
          <Photo path={t.hero_path} alt="Главное фото" />
        </div>
        <PhotoPicker label="Заменить главное фото" onUploaded={(p) => setMedia.mutateAsync({ hero_path: p })} />
      </section>
      <section className="panel">
        <h2 className="panel__title">Логотип</h2>
        <div className="media-preview media-preview--logo">
          <Photo path={t.logo_path} alt="Логотип" />
        </div>
        <PhotoPicker label="Заменить логотип" onUploaded={(p) => setMedia.mutateAsync({ logo_path: p })} />
      </section>

      <form
        className="panel stack-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (f.name.trim() && urlOk(f.map_url) && urlOk(f.messenger_url)) save.mutate(undefined);
        }}
      >
        <TextInput label="Название" value={f.name} onChange={(v) => set('name', v)} width="100%" />
        <TextInput label="Короткое название" description="Под иконкой на телефоне, до 24 символов" value={f.short_name} onChange={(v) => set('short_name', v.slice(0, 24))} width="100%" />
        <TextInput label="Подзаголовок" value={f.tagline} onChange={(v) => set('tagline', v)} width="100%" />
        <TextArea label="Описание" value={f.description} onChange={(v) => set('description', v)} rows={4} maxLength={2000} width="100%" />
        <TextInput label="Адрес" value={f.address} onChange={(v) => set('address', v)} width="100%" />
        <TextInput label="Телефон" value={f.phone} onChange={(v) => set('phone', v)} width="100%" />
        <TextInput
          label="Ссылка на карту"
          value={f.map_url}
          onChange={(v) => set('map_url', v)}
          isOptional
          width="100%"
          status={urlOk(f.map_url) ? undefined : { type: 'error', message: 'Ссылка должна начинаться с https://' }}
        />
        <TextInput
          label="Мессенджер"
          value={f.messenger_url}
          onChange={(v) => set('messenger_url', v)}
          isOptional
          width="100%"
          status={urlOk(f.messenger_url) ? undefined : { type: 'error', message: 'Ссылка должна начинаться с https://' }}
        />
        <NumberInput label="Онлайн-отмена не позднее, чем за (часов)" value={f.cancel_cutoff_hours} onChange={(v) => set('cancel_cutoff_hours', v ?? 0)} min={0} max={168} isIntegerOnly width="100%" />
        <TextArea label="Правила отмены" value={f.cancellation_policy} onChange={(v) => set('cancellation_policy', v)} rows={2} maxLength={600} width="100%" />
        <Button type="submit" variant="primary" label="Сохранить" isLoading={save.isPending} width="100%" />
        <Text type="supporting" color="secondary" display="block">
          Иконка и цвет приложения задаются при подключении студии и меняются администратором.
        </Text>
      </form>
    </div>
  );
}
