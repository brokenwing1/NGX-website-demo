// Client top bar: studio logo and name on the left, profile on the right. Sticky, frosted after scroll.
import { UserCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useStudio } from '../app/studio';
import { mediaUrl } from '../lib/supabase';

export function TopBar() {
  const { tenant, slug } = useStudio();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const logo = mediaUrl(tenant.logo_path);
  return (
    <header className={`topbar${scrolled ? ' is-scrolled' : ''}`}>
      <Link to={`/s/${slug}/`} className="topbar__brand" aria-label={`${tenant.name} — на главную`}>
        {logo ? <img className="topbar__logo" src={logo} alt="" width={32} height={32} /> : <span className="topbar__logo topbar__logo--empty" />}
        <span className="topbar__name">{tenant.short_name}</span>
      </Link>
      <Link to={`/s/${slug}/profile`} className="topbar__profile" aria-label="Профиль">
        <UserCircle size={24} weight="regular" aria-hidden="true" />
      </Link>
    </header>
  );
}
