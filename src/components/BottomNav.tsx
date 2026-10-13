// Bottom navigation with glass. Content gets bottom padding (see .with-bottom-nav) so nothing hides behind it.
import { CalendarCheck, House, ListBullets, UserCircle } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { NavLink } from 'react-router';
import { initLiquidGlass } from './glass';

export interface NavItem {
  to: string;
  label: string;
  icon: typeof House;
  end?: boolean;
  badge?: number;
}

export function BottomNav({ items, label }: { items: NavItem[]; label: string }) {
  useEffect(() => {
    // after first paint so the snapshot includes the page
    const id = window.setTimeout(() => void initLiquidGlass(), 400);
    return () => window.clearTimeout(id);
  }, []);

  // Hide the bar while the on-screen keyboard is open so it never covers a focused field.
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => {
      const el = document.activeElement;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
      const shrunk = vv ? vv.height < window.innerHeight * 0.8 : false;
      document.documentElement.classList.toggle('kbd-open', typing && (shrunk || matchMedia('(pointer: coarse)').matches));
    };
    const later = () => window.setTimeout(update, 50);
    vv?.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', later);
    return () => {
      vv?.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', later);
      document.documentElement.classList.remove('kbd-open');
    };
  }, []);
  return (
    <nav className="bottom-nav lg-target glass" aria-label={label}>
      <ul className="bottom-nav__list">
        {items.map(({ to, label: text, icon: Icon, end, badge }) => (
          <li key={to}>
            <NavLink to={to} end={end} className={({ isActive }) => `bottom-nav__item${isActive ? ' is-active' : ''}`}>
              {({ isActive }) => (
                <>
                  <span className="bottom-nav__icon" aria-hidden="true">
                    <Icon size={24} weight={isActive ? 'fill' : 'regular'} />
                    {badge ? <span className="bottom-nav__badge">{badge > 9 ? '9+' : badge}</span> : null}
                  </span>
                  <span className="bottom-nav__label">{text}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function clientNavItems(slug: string, myCount: number): NavItem[] {
  return [
    { to: `/s/${slug}/`, label: 'Главная', icon: House, end: true },
    { to: `/s/${slug}/services`, label: 'Услуги', icon: ListBullets },
    { to: `/s/${slug}/my`, label: 'Моя запись', icon: CalendarCheck, badge: myCount },
    { to: `/s/${slug}/profile`, label: 'Профиль', icon: UserCircle },
  ];
}
