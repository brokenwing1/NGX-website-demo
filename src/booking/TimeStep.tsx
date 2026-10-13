import { Banner, Button, Skeleton, Text } from '@astryxdesign/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '../app/studio';
import { ErrorState } from '../components/States';
import { api, type Service } from '../lib/api';
import { addDaysStr, dayLabel, durationLabel, fmtDayTime, localDay, weekdayIso } from '../lib/time';
import { StepHeader } from './StepHeader';

export function TimeStep({
  service,
  selected,
  notice,
  onSelect,
  onBack,
  onClose,
}: {
  service: Service;
  selected?: string;
  notice: string | null;
  onSelect: (iso: string) => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const { slug, tenant } = useStudio();
  const tz = tenant.timezone;
  const horizon = Math.min(tenant.max_days_ahead, 45);

  const days = useMemo(() => {
    const list: { day: string; closed: boolean }[] = [];
    for (let i = 0; i <= horizon; i++) {
      const day = addDaysStr(tenant.today, i);
      const ex = tenant.exceptions.filter((e) => e.day === day);
      const closed = ex.length ? ex.every((e) => e.closed) : !tenant.working_hours.some((h) => h.weekday === weekdayIso(day));
      list.push({ day, closed });
    }
    return list;
  }, [tenant, horizon]);

  const nearest = useQuery({
    queryKey: ['nearest', slug, service.id],
    queryFn: () => api.nearest(slug, service.id, 1),
    staleTime: 30_000,
  });

  const [day, setDay] = useState<string | undefined>(() => (selected ? localDay(selected, tz) : undefined));
  useEffect(() => {
    if (!day && nearest.data) setDay(nearest.data[0]?.local_day ?? days.find((d) => !d.closed)?.day);
    if (!day && nearest.isError) setDay(days.find((d) => !d.closed)?.day);
  }, [day, nearest.data, nearest.isError, days]);

  const slots = useQuery({
    queryKey: ['availability', slug, service.id, day],
    queryFn: () => api.availability(slug, service.id, day!, day!),
    enabled: !!day,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  // keep the chosen day visible in the strip
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [day]);

  const free = slots.data?.filter((s) => s.available) ?? [];
  const multiDay = service.duration_minutes >= 1440;

  return (
    <div className="step">
      <StepHeader title="Когда удобно приехать?" step={2} total={4} onBack={onBack} onClose={onClose} />
      <Text type="supporting" color="secondary" display="block" className="step__sub">
        {service.name} · {durationLabel(service.duration_minutes)}
        {multiDay ? ' — машина остаётся в боксе на всё время работ' : ''}
      </Text>

      {notice ? <Banner status="warning" title={notice} /> : null}

      <div className="day-strip" ref={stripRef} role="group" aria-label="День">
        {days.map(({ day: d, closed }) => {
          const l = dayLabel(d, tenant.today);
          return (
            <button
              key={d}
              type="button"
              className={`day ${d === day ? 'is-selected' : ''}`}
              aria-pressed={d === day}
              disabled={closed}
              onClick={() => setDay(d)}
              aria-label={`${l.top}, ${l.bottom}${closed ? ', выходной' : ''}`}
            >
              <span className="day__top">{l.top}</span>
              <span className="day__bottom">{closed ? 'вых.' : l.bottom}</span>
            </button>
          );
        })}
      </div>

      {nearest.data?.[0] && nearest.data[0].local_day !== day ? (
        <button type="button" className="nearest-hint" onClick={() => setDay(nearest.data![0]!.local_day)}>
          Ближайшее свободное: {fmtDayTime(nearest.data[0].starts_at, tz)}
        </button>
      ) : null}

      <div className="slots" aria-live="polite" aria-busy={slots.isFetching}>
        {!day || slots.isPending ? (
          <div className="slot-grid">
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} height={44} radius={2} index={i} />
            ))}
          </div>
        ) : slots.isError ? (
          <ErrorState compact error={slots.error} onRetry={() => void slots.refetch()} />
        ) : slots.data.length === 0 ? (
          <div className="slots__empty">
            <Text type="body" color="secondary" display="block">
              В этот день онлайн-записи нет.
            </Text>
            {nearest.data?.[0] ? <Button label="Показать ближайший день" onClick={() => setDay(nearest.data![0]!.local_day)} /> : null}
          </div>
        ) : (
          <>
            {free.length === 0 ? (
              <Text type="supporting" color="secondary" display="block" className="slots__full">
                Всё время на этот день занято — выберите другой день.
              </Text>
            ) : null}
            <ul className="slot-grid" aria-label="Время">
              {slots.data.map((s) => (
                <li key={s.starts_at}>
                  <button
                    type="button"
                    className={`slot ${s.available ? '' : 'is-busy'} ${selected === s.starts_at ? 'is-selected' : ''}`}
                    disabled={!s.available}
                    aria-label={s.available ? `${s.local_time}, свободно` : `${s.local_time}, занято`}
                    onClick={() => onSelect(s.starts_at)}
                  >
                    {s.local_time}
                    {!s.available ? <span className="slot__busy">занято</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            <p className="legend" aria-hidden="true">
              <span className="legend__free" /> свободно <span className="legend__busy" /> занято
            </p>
          </>
        )}
      </div>
    </div>
  );
}
