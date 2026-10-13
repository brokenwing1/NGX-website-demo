import { Button, IconButton, Switch, Text } from '@astryxdesign/core';
import { Plus, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { ownerApi, type WorkingHours } from '../../lib/api';
import { WEEKDAYS_SHORT } from '../../lib/time';
import { TimeField } from '../fields';
import { useOwner } from '../OwnerApp';
import { useOwnerMutation } from '../useOwnerMutation';

export function HoursSettings() {
  const { slug, settings } = useOwner();
  const [hours, setHours] = useState<WorkingHours[]>(settings.working_hours);
  const save = useOwnerMutation(() => ownerApi.setHours(slug, hours), { success: 'Часы работы сохранены' });
  const invalid = hours.some((h) => h.closes <= h.opens);

  const forDay = (d: number) => hours.map((h, i) => ({ h, i })).filter((x) => x.h.weekday === d);
  const update = (i: number, patch: Partial<WorkingHours>) => setHours((list) => list.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  return (
    <div className="stack-3">
      <Text type="supporting" color="secondary" display="block">
        Это время, когда студия принимает машины. Долгие работы (например, керамика на 2 дня) продолжаются и ночью — пост остаётся занятым.
      </Text>
      {Array.from({ length: 7 }, (_, k) => k + 1).map((d) => {
        const rows = forDay(d);
        return (
          <section key={d} className="hours-day">
            <Switch
              label={WEEKDAYS_SHORT[d]!}
              labelSpacing="spread"
              width="100%"
              value={rows.length > 0}
              onChange={(on) => setHours((list) => (on ? [...list, { weekday: d, opens: '09:00', closes: '21:00' }] : list.filter((h) => h.weekday !== d)))}
            />
            {rows.map(({ h, i }) => (
              <div key={i} className="hours-day__row">
                <TimeField label="с" value={h.opens} onChange={(v) => update(i, { opens: v })} step={900} />
                <TimeField label="до" value={h.closes} onChange={(v) => update(i, { closes: v })} step={900} />
                <IconButton variant="ghost" label="Удалить интервал" icon={<Trash size={18} />} onClick={() => setHours((list) => list.filter((_, j) => j !== i))} />
              </div>
            ))}
            {rows.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                label="Добавить перерыв/интервал"
                icon={<Plus size={16} />}
                onClick={() => setHours((list) => [...list, { weekday: d, opens: '14:00', closes: '18:00' }])}
              />
            ) : null}
          </section>
        );
      })}
      {invalid ? (
        <Text type="supporting" color="inherit" display="block" className="inline-error">
          Время закрытия должно быть позже открытия.
        </Text>
      ) : null}
      <Button variant="primary" label="Сохранить часы" width="100%" isDisabled={invalid} isLoading={save.isPending} onClick={() => save.mutate(undefined)} />
    </div>
  );
}
