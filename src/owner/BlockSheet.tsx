import { BottomSheet, Button, Text, TextInput } from '@astryxdesign/core';
import { Trash } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { StepHeader } from '../booking/StepHeader';
import { ownerApi } from '../lib/api';
import { fmt, zonedToIso } from '../lib/time';
import { DateField, SelectField, TimeField } from './fields';
import { useOwner } from './OwnerApp';
import { useOwnerMutation } from './useOwnerMutation';

/** Close a post (repair, private event). Uses the same occupancy table as bookings. */
export function BlockSheet({ isOpen, initialDay, onClose }: { isOpen: boolean; initialDay: string; onClose: () => void }) {
  const { slug, settings } = useOwner();
  const tz = settings.tenant.timezone;
  const resources = settings.resources.filter((r) => r.active);
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? '');
  const [fromDay, setFromDay] = useState(initialDay);
  const [fromTime, setFromTime] = useState('09:00');
  const [toDay, setToDay] = useState(initialDay);
  const [toTime, setToTime] = useState('21:00');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (isOpen) {
      setFromDay(initialDay);
      setToDay(initialDay);
    }
  }, [isOpen, initialDay]);

  const block = useOwnerMutation(
    () => ownerApi.blockResource(slug, resourceId, zonedToIso(fromDay, fromTime, tz), zonedToIso(toDay, toTime, tz), reason),
    { success: 'Пост закрыт на выбранное время', onSuccess: onClose },
  );
  const remove = useOwnerMutation((id: string) => ownerApi.removeBlock(slug, id), { success: 'Блокировка снята' });

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={(o) => !o && onClose()} label="Закрыть пост" height="tall" padding={4} purpose="form">
      <div className="step">
        <StepHeader title="Закрыть пост" onClose={onClose} />
        <div className="stack-3">
          <SelectField label="Пост" value={resourceId} onChange={setResourceId}>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
          <div className="row-2">
            <DateField label="С (день)" value={fromDay} onChange={setFromDay} />
            <TimeField label="время" value={fromTime} onChange={setFromTime} />
          </div>
          <div className="row-2">
            <DateField label="По (день)" value={toDay} onChange={setToDay} min={fromDay} />
            <TimeField label="время" value={toTime} onChange={setToTime} />
          </div>
          <TextInput label="Причина" value={reason} onChange={setReason} isOptional placeholder="Ремонт подъёмника" width="100%" />
          <Text type="supporting" color="secondary" display="block">
            Если на это время уже есть записи, пост не закроется — сначала перенесите их.
          </Text>
          <Button variant="primary" size="lg" label="Закрыть пост" width="100%" isLoading={block.isPending} isDisabled={!resourceId} onClick={() => block.mutate(undefined)} />
        </div>

        {settings.blocks.length ? (
          <section className="section">
            <h3 className="panel__title">Действующие блокировки</h3>
            <ul className="stack-2">
              {settings.blocks.map((x) => (
                <li key={x.id} className="block-card">
                  <span>
                    {settings.resources.find((r) => r.id === x.resource_id)?.name}: {fmt(x.starts_at, tz, 'd MMM HH:mm')} – {fmt(x.ends_at, tz, 'd MMM HH:mm')}
                    {x.reason ? ` · ${x.reason}` : ''}
                  </span>
                  <Button variant="ghost" size="sm" label="Снять" icon={<Trash size={16} />} onClick={() => remove.mutate(x.id)} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </BottomSheet>
  );
}
