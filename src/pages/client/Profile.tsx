// Profile: one place to choose who you are here — a client (your bookings on this device)
// or the studio owner (sign in to the cabinet). Plus the studio's contacts and install hint.
import { Heading, Text } from '@astryxdesign/core';
import { ArrowRight, CalendarCheck, DeviceMobile, Key, Phone, User } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useStudio } from '../../app/studio';
import { myBookings } from '../../lib/myBookings';
import { InstallButton } from '../../components/Install';
import { isStandalone } from '../../lib/pwa';
import { plural } from '../../lib/time';

export function Profile() {
  const { tenant, slug, openBooking, myBookingsVersion } = useStudio();
  const upcoming = useMemo(
    () => myBookings.list(slug).filter((b) => new Date(b.startsAt).getTime() > Date.now() - 3 * 3600_000).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug, myBookingsVersion],
  );
  const standalone = isStandalone();

  return (
    <main className="page page--home">
      <div className="page__body">
        <header className="page-title">
          <Heading level={1}>Профиль</Heading>
          <Text type="body" color="secondary" display="block">
            Выберите, как вы пользуетесь приложением «{tenant.short_name}».
          </Text>
        </header>

        <section className="role-card" aria-labelledby="role-client">
          <span className="role-card__icon" aria-hidden="true">
            <User size={22} />
          </span>
          <div className="role-card__text">
            <h2 id="role-client" className="role-card__title">
              Я клиент
            </h2>
            <span className="role-card__sub">
              {upcoming
                ? `${upcoming} ${plural(upcoming, ['запись', 'записи', 'записей'])} на этом устройстве`
                : 'Записи сохраняются на этом устройстве, регистрация не нужна'}
            </span>
          </div>
          <div className="role-card__actions">
            <Link to={`/s/${slug}/my`} className="pill-link">
              <CalendarCheck size={18} aria-hidden="true" /> Мои записи
            </Link>
            <button type="button" className="pill-link pill-link--accent" onClick={() => openBooking()}>
              Записаться <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </button>
          </div>
        </section>

        <section className="role-card" aria-labelledby="role-owner">
          <span className="role-card__icon role-card__icon--owner" aria-hidden="true">
            <Key size={22} />
          </span>
          <div className="role-card__text">
            <h2 id="role-owner" className="role-card__title">
              Я владелец
            </h2>
            <span className="role-card__sub">Расписание, деньги, услуги и витрина студии. Вход по почте и паролю.</span>
          </div>
          <div className="role-card__actions">
            <Link to={`/s/${slug}/owner/`} className="pill-link pill-link--accent">
              Войти в кабинет <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </Link>
          </div>
        </section>

        {!standalone ? (
          <section className="install-card" aria-labelledby="install-title">
            <span className="role-card__icon" aria-hidden="true">
              <DeviceMobile size={22} />
            </span>
            <div className="role-card__text">
              <h2 id="install-title" className="role-card__title">
                Приложение на экране «Домой»
              </h2>
              <span className="role-card__sub">С иконкой {tenant.short_name}, открывается без адресной строки.</span>
            </div>
            <div className="role-card__actions">
              <InstallButton />
            </div>
          </section>
        ) : null}

        <section className="contacts__card profile-contacts" aria-label="Контакты студии">
          <span className="profile-contacts__name">{tenant.name}</span>
          <span className="role-card__sub">{tenant.address}</span>
          <a className="pill-link" href={`tel:${tenant.phone.replace(/[^+\d]/g, '')}`}>
            <Phone size={18} aria-hidden="true" /> {tenant.phone}
          </a>
        </section>
      </div>
    </main>
  );
}
