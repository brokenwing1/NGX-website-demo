import { Button, Switch, Text, TextInput } from '@astryxdesign/core';
import { useState } from 'react';
import { ownerApi, type Resource } from '../../lib/api';
import { useOwner } from '../OwnerApp';
import { useOwnerMutation } from '../useOwnerMutation';

export function ResourcesSettings() {
  const { settings } = useOwner();
  const [name, setName] = useState('');
  const { slug } = useOwner();
  const add = useOwnerMutation(() => ownerApi.upsertResource(slug, null, name.trim(), true), { success: 'Пост добавлен', onSuccess: () => setName('') });
  return (
    <div className="stack-4">
      <Text type="supporting" color="secondary" display="block">
        Пост — это место, где одновременно обслуживается одна машина. Каждая услуга занимает один подходящий пост.
      </Text>
      <ul className="stack-2">
        {settings.resources.map((r) => (
          <ResourceRow key={r.id} r={r} />
        ))}
      </ul>
      <section className="panel stack-3">
        <TextInput label="Новый пост" value={name} onChange={setName} placeholder="Бокс 3" width="100%" />
        <Button label="Добавить пост" width="100%" isDisabled={!name.trim()} isLoading={add.isPending} onClick={() => add.mutate(undefined)} />
        <Text type="supporting" color="secondary" display="block">
          После добавления отметьте в «Услугах», какие работы можно делать на новом посту.
        </Text>
      </section>
    </div>
  );
}

function ResourceRow({ r }: { r: Resource }) {
  const { slug } = useOwner();
  const [name, setName] = useState(r.name);
  const save = useOwnerMutation((active: boolean) => ownerApi.upsertResource(slug, r.id, name.trim() || r.name, active), { success: 'Сохранено' });
  return (
    <li className="panel resource-row">
      <TextInput label="Название поста" value={name} onChange={setName} width="100%" />
      <div className="resource-row__actions">
        <Switch label="Принимает записи" value={r.active} onChange={(v) => save.mutate(v)} />
        <Button size="sm" label="Сохранить" isDisabled={name.trim() === r.name || !name.trim()} onClick={() => save.mutate(r.active)} />
      </div>
    </li>
  );
}
