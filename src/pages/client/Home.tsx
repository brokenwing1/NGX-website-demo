import { Button, Heading, Lightbox, Text } from '@astryxdesign/core';
import { ArrowUpRight, ChatCircleDots, Clock, Garage, MapPin, NavigationArrow, Phone, Tag, Wrench } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useStudio } from '../../app/studio';
import { cardIcon } from '../../components/icons';
import { InstallCard } from '../../components/Install';
import { Photo } from '../../components/Photo';
import { Reveal } from '../../components/Reveal';
import { ServiceCard } from '../../components/ServiceCard';
import { ASSISTANT_ENABLED, mediaUrl } from '../../lib/supabase';
import { WEEKDAYS_SHORT, openState, plural, priceLabel } from '../../lib/time';

export function Home() {
  const { tenant, slug, openBooking } = useStudio();
  const navigate = useNavigate();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const status = useMemo(() => openState(tenant.working_hours, tenant.exceptions, tenant.timezone), [tenant]);

  const popular = tenant.services.slice(0, 3);
  const minPrice = tenant.services.length ? Math.min(...tenant.services.map((s) => s.price_cents)) : 0;
  const boxes = tenant.resources_count ?? 0;
  const priced = tenant.services.find((s) => s.price_is_from) ?? tenant.services[0];
  const prompts = [
    'Когда ближайшее окно?',
    priced ? `Сколько стоит ${priced.name.toLowerCase()}?` : 'Сколько стоят услуги?',
    'Как найти студию?',
  ];

  return (
    <main className="page page--home">
      <div className="page__body home">
        {/* Main photo in a rounded frame; the glass button lives inside the frame and scrolls with it. */}
        <section className="hero-card" aria-label="Главное фото студии">
          <Photo path={tenant.hero_path} alt="" eager sizes="(min-width: 720px) 680px, 100vw" className="hero-card__photo" />
          <span className="hero-card__shade" aria-hidden="true" />
          <span className={`status-pill hero-card__status ${status.open ? 'is-open' : ''}`}>
            <Clock size={14} weight="bold" aria-hidden="true" />
            {status.text}
          </span>
          <button type="button" className="glass glass--button hero-card__cta hero__cta" onClick={() => openBooking()}>
            <span className="glass__label">Записаться</span>
            <span className="hero-card__arrow" aria-hidden="true">
              <ArrowUpRight size={20} weight="bold" />
            </span>
          </button>
        </section>

        <header className="home__intro">
          <Heading level={1} className="home__title">
            {tenant.name}
          </Heading>
          {tenant.tagline ? (
            <Text type="body" color="secondary" display="block" className="home__tagline">
              {tenant.tagline}
            </Text>
          ) : null}
        </header>

        <InstallCard />

        <section className="stat-tiles" aria-label="Коротко о студии">
          <div className="stat-tile">
            <span className="stat-tile__value">
              <Wrench size={18} weight="bold" aria-hidden="true" />
              {tenant.services.length}
            </span>
            <span className="stat-tile__label">{plural(tenant.services.length, ['услуга', 'услуги', 'услуг'])} в прайсе</span>
          </div>
          <div className="stat-tile">
            <span className="stat-tile__value">
              <Garage size={18} weight="bold" aria-hidden="true" />
              {boxes}
            </span>
            <span className="stat-tile__label">{plural(boxes, ['бокс', 'бокса', 'боксов'])} в работе</span>
          </div>
          {tenant.services.length ? (
            <div className="stat-tile stat-tile--wide">
              <span className="stat-tile__value">
                <Tag size={18} weight="bold" aria-hidden="true" />
                {priceLabel(minPrice, true, tenant.currency)}
              </span>
              <span className="stat-tile__label">за услугу</span>
            </div>
          ) : null}
        </section>

        {tenant.description ? (
          <Reveal>
            <Text type="body" color="secondary" display="block" className="lead">
              {tenant.description}
            </Text>
          </Reveal>
        ) : null}

        <Reveal as="section" className="section" delay={40}>
          <Heading level={2} className="section__title section__title--booking">
            Запись в студию
          </Heading>
          <div className="booking-card">
            <span className="booking-card__title">Выберите услугу и удобное время</span>
            <Text type="body" color="secondary" display="block">
              Подтверждение сразу, без регистрации. Остальное возьмём на себя.
            </Text>
            <div className="booking-card__actions">
              <Button variant="primary" size="lg" label="Выбрать услугу и время" onClick={() => openBooking()} width="100%" />
              <Button variant="secondary" size="lg" label="Мои записи" onClick={() => navigate(`/s/${slug}/my`)} width="100%" />
            </div>
          </div>
        </Reveal>

        {tenant.info_cards.length ? (
          <Reveal as="section" className="info-cards" delay={60}>
            <h2 className="visually-hidden">Почему мы</h2>
            <ul className="info-cards__list">
              {tenant.info_cards.map((c) => {
                const Icon = cardIcon(c.icon);
                return (
                  <li key={c.position} className="info-card">
                    <span className="info-card__icon">
                      <Icon size={20} weight="regular" aria-hidden="true" />
                    </span>
                    <span className="info-card__title">{c.title}</span>
                    {c.body ? <span className="info-card__body">{c.body}</span> : null}
                  </li>
                );
              })}
            </ul>
          </Reveal>
        ) : null}

        <Reveal as="section" className="section">
          <div className="section__head">
            <Heading level={2} className="section__title">
              Услуги и цены
            </Heading>
            <Link to={`/s/${slug}/services`} className="section__link">
              Все услуги
            </Link>
          </div>
          <div className="stack-3">
            {popular.map((s) => (
              <ServiceCard key={s.id} service={s} currency={tenant.currency} onBook={() => openBooking({ serviceId: s.id })} />
            ))}
          </div>
        </Reveal>

        {tenant.gallery.length ? (
          <Reveal as="section" className="section">
            <Heading level={2} className="section__title">
              Наши работы
            </Heading>
            <ul className="gallery" aria-label="Фотографии работ">
              {tenant.gallery.map((g, i) => (
                <li key={g.id} className="gallery__item">
                  <button type="button" className="gallery__button" onClick={() => setLightbox(i)} aria-label={`Открыть фото: ${g.caption || 'работа'}`}>
                    <Photo path={g.image_path} alt={g.caption || 'Работа студии'} />
                    {g.caption ? <span className="gallery__caption">{g.caption}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            <Lightbox
              isOpen={lightbox !== null}
              onOpenChange={(open) => !open && setLightbox(null)}
              index={lightbox ?? 0}
              onIndexChange={setLightbox}
              media={tenant.gallery.map((g) => ({ src: mediaUrl(g.image_path) ?? '', alt: g.caption || 'Работа студии', caption: g.caption }))}
            />
          </Reveal>
        ) : null}

        {ASSISTANT_ENABLED ? (
          <Reveal as="section" className="section">
            <Heading level={2} className="section__title">
              Спросить помощника
            </Heading>
            <div className="prompt-chips">
              {prompts.map((p) => (
                <button key={p} type="button" className="chip" onClick={() => navigate(`/s/${slug}/assistant?q=${encodeURIComponent(p)}`)}>
                  <ChatCircleDots size={16} aria-hidden="true" />
                  {p}
                </button>
              ))}
            </div>
          </Reveal>
        ) : null}

        <Reveal as="section" className="section contacts" delay={40}>
          <Heading level={2} className="section__title">
            Как нас найти
          </Heading>
          <div className="contacts__card">
            <p className="contacts__row">
              <MapPin size={20} aria-hidden="true" className="accent-icon" />
              <span>{tenant.address}</span>
            </p>
            <dl className="hours">
              {Array.from({ length: 7 }, (_, i) => i + 1).map((d) => {
                const h = tenant.working_hours.filter((w) => w.weekday === d);
                return (
                  <div key={d} className="hours__row">
                    <dt>{WEEKDAYS_SHORT[d]}</dt>
                    <dd>{h.length ? h.map((x) => `${x.opens}–${x.closes}`).join(', ') : 'выходной'}</dd>
                  </div>
                );
              })}
            </dl>
            <div className="contacts__actions">
              <Button label="Позвонить" icon={<Phone size={18} />} href={`tel:${tenant.phone.replace(/[^+\d]/g, '')}`} />
              {tenant.map_url ? (
                <Button label="Маршрут" icon={<NavigationArrow size={18} />} href={tenant.map_url} target="_blank" rel="noopener noreferrer" />
              ) : null}
            </div>
          </div>
        </Reveal>
      </div>
    </main>
  );
}
