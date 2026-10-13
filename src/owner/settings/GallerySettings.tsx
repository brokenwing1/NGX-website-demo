import { AlertDialog, Button, TextInput } from '@astryxdesign/core';
import { Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { Photo } from '../../components/Photo';
import { ownerApi, type OwnerSettings } from '../../lib/api';
import { useOwner } from '../OwnerApp';
import { useOwnerMutation } from '../useOwnerMutation';
import { PhotoPicker } from './PhotoPicker';

/** Three clear actions: add a new card, replace one photo, change one caption. Other cards stay as they are. */
export function GallerySettings() {
  const { slug, settings } = useOwner();
  const [caption, setCaption] = useState('');
  const add = useOwnerMutation((path: string) => ownerApi.addGalleryItem(slug, path, caption), {
    success: 'Работа добавлена',
    onSuccess: () => setCaption(''),
  });
  return (
    <div className="stack-4">
      <section className="panel stack-3">
        <h2 className="panel__title">Новая карточка</h2>
        <TextInput label="Подпись" value={caption} onChange={setCaption} placeholder="Например: керамика на белом кроссовере" isOptional width="100%" />
        <PhotoPicker variant="primary" label="Выбрать фото и добавить" onUploaded={(p) => add.mutateAsync(p)} />
      </section>
      <ul className="gallery-admin">
        {settings.gallery.map((g) => (
          <GalleryRow key={g.id} item={g} />
        ))}
      </ul>
    </div>
  );
}

function GalleryRow({ item }: { item: OwnerSettings['gallery'][number] }) {
  const { slug } = useOwner();
  const [caption, setCaption] = useState(item.caption);
  const [confirm, setConfirm] = useState(false);
  const replace = useOwnerMutation((path: string) => ownerApi.updateGalleryItem(slug, item.id, path, null), { success: 'Фото заменено' });
  const rename = useOwnerMutation(() => ownerApi.updateGalleryItem(slug, item.id, null, caption), { success: 'Подпись сохранена' });
  const remove = useOwnerMutation(() => ownerApi.removeGalleryItem(slug, item.id), { success: 'Карточка убрана', onSuccess: () => setConfirm(false) });
  return (
    <li className="panel gallery-admin__item">
      <div className="media-preview">
        <Photo path={item.image_path} alt={item.caption || 'Работа'} />
      </div>
      <TextInput label="Подпись" value={caption} onChange={setCaption} width="100%" />
      <div className="row-wrap">
        <Button size="sm" label="Сохранить подпись" isDisabled={caption === item.caption} isLoading={rename.isPending} onClick={() => rename.mutate(undefined)} />
        <PhotoPicker label="Заменить фото" onUploaded={(p) => replace.mutateAsync(p)} />
        <Button size="sm" variant="ghost" label="Убрать" icon={<Trash size={16} />} onClick={() => setConfirm(true)} />
      </div>
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title="Убрать карточку?"
        description="Фото исчезнет с главной страницы. Остальные карточки останутся."
        actionLabel="Убрать"
        cancelLabel="Оставить"
        isActionLoading={remove.isPending}
        onAction={() => remove.mutate(undefined)}
      />
    </li>
  );
}
