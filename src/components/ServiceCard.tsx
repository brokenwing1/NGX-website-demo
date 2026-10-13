import { Button, Text } from '@astryxdesign/core';
import { Clock } from '@phosphor-icons/react';
import type { Service } from '../lib/api';
import { durationLabel, priceLabel } from '../lib/time';
import { Photo } from './Photo';

export function ServiceCard({ service, currency, onBook }: { service: Service; currency: string; onBook: () => void }) {
  return (
    <article className="service-card">
      <div className="service-card__media">
        <Photo path={service.image_path} alt="" />
      </div>
      <div className="service-card__body">
        <h3 className="service-card__title">{service.name}</h3>
        {service.description ? (
          <Text type="supporting" color="secondary" display="block" maxLines={2}>
            {service.description}
          </Text>
        ) : null}
        <div className="service-card__meta">
          <span className="service-card__price">{priceLabel(service.price_cents, service.price_is_from, currency)}</span>
          <span className="service-card__duration">
            <Clock size={14} aria-hidden="true" />
            {durationLabel(service.duration_minutes)}
          </span>
        </div>
      </div>
      <Button variant="primary" size="sm" label="Записаться" aria-label={`Записаться: ${service.name}`} onClick={onBook} className="service-card__cta" />
    </article>
  );
}
