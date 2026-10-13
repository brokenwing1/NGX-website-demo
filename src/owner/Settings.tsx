import { Heading } from '@astryxdesign/core';
import { ArrowLeft, Bell, CalendarX, Clock, Images, ListBullets, Storefront, Cards, Warehouse } from '@phosphor-icons/react';
import { Link, Route, Routes } from 'react-router';
import { useOwner } from './OwnerApp';
import { CardsSettings } from './settings/CardsSettings';
import { DeviceSettings } from './settings/DeviceSettings';
import { GallerySettings } from './settings/GallerySettings';
import { HoursSettings } from './settings/HoursSettings';
import { ResourcesSettings } from './settings/ResourcesSettings';
import { ServicesSettings } from './settings/ServicesSettings';
import { StudioSettings } from './settings/StudioSettings';
import { ExceptionsSettings } from './settings/ExceptionsSettings';

const SECTIONS = [
  { path: 'studio', title: 'Студия', hint: 'Название, адрес, телефон, логотип и главное фото', icon: Storefront, el: <StudioSettings /> },
  { path: 'services', title: 'Услуги и цены', hint: 'Цены, длительность, посты, фото', icon: ListBullets, el: <ServicesSettings /> },
  { path: 'hours', title: 'Часы работы', hint: 'Когда принимаете машины', icon: Clock, el: <HoursSettings /> },
  { path: 'days-off', title: 'Выходные и особые дни', hint: 'Праздники, сокращённые дни', icon: CalendarX, el: <ExceptionsSettings /> },
  { path: 'resources', title: 'Боксы и посты', hint: 'Сколько машин можно принять одновременно', icon: Warehouse, el: <ResourcesSettings /> },
  { path: 'gallery', title: 'Фото работ', hint: 'Добавить, заменить фото, изменить подпись', icon: Images, el: <GallerySettings /> },
  { path: 'cards', title: 'Карточки на главной', hint: 'Три коротких преимущества', icon: Cards, el: <CardsSettings /> },
  { path: 'device', title: 'Уведомления и установка', hint: 'Пуш о новых записях на этот телефон', icon: Bell, el: <DeviceSettings /> },
];

export function Settings() {
  const { slug } = useOwner();
  const base = `/s/${slug}/owner/settings`;
  return (
    <Routes>
      <Route
        index
        element={
          <main className="page page--plain owner-page">
            <div className="page__body">
              <header className="page__header">
                <Heading level={1}>Настройки</Heading>
              </header>
              <ul className="tile-grid tile-grid--settings">
                {SECTIONS.map(({ path, title, hint, icon: Icon }) => (
                  <li key={path}>
                    <Link to={`${base}/${path}`} className="tile tile--tall">
                      <span className="tile__icon" aria-hidden="true">
                        <Icon size={20} />
                      </span>
                      <span className="tile__label">{title}</span>
                      <span className="tile__hint">{hint}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </main>
        }
      />
      {SECTIONS.map((s) => (
        <Route
          key={s.path}
          path={s.path}
          element={
            <main className="page page--plain owner-page">
              <div className="page__body">
                <Link to={base} className="back-link">
                  <ArrowLeft size={18} aria-hidden="true" /> Настройки
                </Link>
                <header className="page__header">
                  <Heading level={1}>{s.title}</Heading>
                </header>
                {s.el}
              </div>
            </main>
          }
        />
      ))}
    </Routes>
  );
}
