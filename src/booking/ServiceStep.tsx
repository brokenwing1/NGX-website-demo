import { Clock } from '@phosphor-icons/react';
import type { Service } from '../lib/api';
import { durationLabel, priceLabel } from '../lib/time';
import { Photo } from '../components/Photo';
import { StepHeader } from './StepHeader';

export function ServiceStep({
  services,
  currency,
  selected,
  onSelect,
  onClose,
}: {
  services: Service[];
  currency: string;
  selected?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="step">
      <StepHeader title="Какая услуга нужна?" step={1} total={4} onClose={onClose} />
      <ul className="choice-list" aria-label="Услуги">
        {services.map((s) => (
          <li key={s.id}>
            <button type="button" className={`choice ${selected === s.id ? 'is-selected' : ''}`} onClick={() => onSelect(s.id)} aria-pressed={selected === s.id}>
              <span className="choice__thumb">
                <Photo path={s.image_path} alt="" />
              </span>
              <span className="choice__text">
                <span className="choice__title">{s.name}</span>
                <span className="choice__meta">
                  <span>{priceLabel(s.price_cents, s.price_is_from, currency)}</span>
                  <span className="dot" aria-hidden="true" />
                  <Clock size={13} aria-hidden="true" />
                  <span>{durationLabel(s.duration_minutes)}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
