import { Button, useToast } from '@astryxdesign/core';
import { UploadSimple } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { ApiError, uploadOwnerImage } from '../../lib/api';
import { useOwner } from '../OwnerApp';

/** Pick a photo from the phone and upload it to <tenant>/owner/… in Storage. */
export function PhotoPicker({ label, onUploaded, variant = 'secondary' }: { label: string; onUploaded: (path: string) => Promise<unknown> | void; variant?: 'primary' | 'secondary' | 'ghost' }) {
  const { settings } = useOwner();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          try {
            const path = await uploadOwnerImage(settings.tenant.id, file);
            await onUploaded(path);
          } catch (err) {
            toast({ body: err instanceof ApiError ? err.message : 'Не удалось загрузить фото', type: 'error' });
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button variant={variant} label={label} icon={<UploadSimple size={18} />} isLoading={busy} onClick={() => input.current?.click()} />
    </>
  );
}
