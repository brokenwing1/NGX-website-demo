import { Button, Switch, Text, TextInput } from '@astryxdesign/core';
import { Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { ownerApi } from '../../lib/api';
import { addDaysStr, fmt } from '../../lib/time';
import { DateField, TimeField } from '../fields';
import { useOwner } from '../OwnerApp';
import { useOwnerMutation } from '../useOwnerMutation';

export function ExceptionsSettings() {
  const { slug, settings } = useOwner();
  const [day, setDay] = useState(addDaysStr(settings.today, 1));
  const [closed, setClosed] = useState(true);
  const [opens, setOpens] = useState('10:00');
  const [closes, setCloses] = useState('16:00');
  const [note, setNote] = useState('');
  const add = useOwnerMutation(() => ownerApi.upsertException(slug, { day, closed, opens: closed ? null : opens, closes: closed ? null : closes, note }), {
    success: 'Особый день сохранён',
    onSuccess: () => setNote(''),
  });
  const del = useOwnerMutation((d: string) => ownerApi.deleteException(slug, d), { success: 'Удалено' });

  return (
    <div className="stack-4">
      <section className="panel stack-3">
        <DateField label="День" value={day} onChange={setDay} min={settings.today} />
        <Switch label="Выходной" value={closed} onChange={setClosed} />
        {!closed ? (
          <div className="row-2">
            <TimeField label="Открываемся" value={opens} onChange={setOpens} step={900} />
            <TimeField label="Закрываемся" value={closes} onChange={setCloses} step={900} />
          </div>
        ) : null}
        <TextInput label="Подпись для клиентов" value={note} onChange={setNote} isOptional placeholder="Санитарный день" width="100%" />
        <Button variant="primary" label="Сохранить день" width="100%" isLoading={add.isPending} isDisabled={!closed && closes <= opens} onClick={() => add.mutate(undefined)} />
        <Text type="supporting" color="secondary" display="block">
          Уже созданные записи на этот день не отменяются автоматически — проверьте раздел «Записи».
        </Text>
      </section>
      {settings.exceptions.length ? (
        <ul className="stack-2">
          {settings.exceptions.map((e) => (
            <li key={`${e.day}-${e.opens ?? 'x'}`} className="block-card">
              <span>
                {fmt(`${e.day}T12:00:00Z`, 'UTC', 'EEEEEE, d MMMM')}: {e.closed ? 'выходной' : `${e.opens}–${e.closes}`}
                {e.note ? ` · ${e.note}` : ''}
              </span>
              <Button variant="ghost" size="sm" label="Удалить" icon={<Trash size={16} />} onClick={() => del.mutate(e.day)} />
            </li>
          ))}
        </ul>
      ) : (
        <Text type="supporting" color="secondary" display="block">
          Особых дней нет.
        </Text>
      )}
    </div>
  );
}
