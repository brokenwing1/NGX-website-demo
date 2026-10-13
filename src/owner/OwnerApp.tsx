import { ASSISTANT_ENABLED } from '../lib/supabase';
import { Button, Heading, IconButton, Text } from '@astryxdesign/core';
import { CalendarDots, ChartBar, ChatCircleDots, GearSix, SignOut, Storefront } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { mediaUrl } from '../lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { Route, Routes } from 'react-router';
import { useStudio } from '../app/studio';
import { BottomNav } from '../components/BottomNav';
import { ErrorState, PageLoader } from '../components/States';
import { ownerApi, type OwnerSettings } from '../lib/api';
import { Login } from './Login';
import { OwnerAssistant } from './OwnerAssistant';
import { Schedule } from './Schedule';
import { Settings } from './Settings';
import { Stats } from './Stats';
import { useOwnerSession } from './session';

interface OwnerCtx {
  slug: string;
  settings: OwnerSettings;
  signOut: () => Promise<void>;
  email: string;
}
const OwnerContext = createContext<OwnerCtx | null>(null);
export function useOwner(): OwnerCtx {
  const c = useContext(OwnerContext);
  if (!c) throw new Error('useOwner outside OwnerApp');
  return c;
}

export function OwnerApp() {
  const { slug, tenant } = useStudio();
  const { state, signIn, signOut } = useOwnerSession();
  const signedIn = state.status === 'signed_in';
  const userId = signedIn ? state.session.user.id : null;

  const me = useQuery({ queryKey: ['owner', userId, 'me'], queryFn: ownerApi.me, enabled: signedIn });
  const member = me.data?.some((s) => s.slug === slug) ?? false;
  const settings = useQuery({
    queryKey: ['owner', userId, slug, 'settings'],
    queryFn: () => ownerApi.settings(slug),
    enabled: signedIn && member,
  });

  if (state.status === 'loading') return <PageLoader />;
  if (state.status === 'signed_out') return <Login studioName={tenant.name} onSignIn={signIn} />;
  if (me.isPending) return <PageLoader label="Проверяем доступ…" />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  if (!member) {
    return (
      <main className="page page--center">
        <Heading level={1}>Нет доступа</Heading>
        <Text type="body" color="secondary" display="block">
          Аккаунт {state.session.user.email} не привязан к «{tenant.name}». Войдите другим аккаунтом.
        </Text>
        <Button label="Выйти" onClick={() => void signOut()} />
      </main>
    );
  }
  if (settings.isPending) return <PageLoader label="Загружаем кабинет…" />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;

  const base = `/s/${slug}/owner`;
  return (
    <OwnerContext.Provider value={{ slug, settings: settings.data, signOut, email: state.session.user.email ?? '' }}>
      <div className="owner with-bottom-nav">
        <header className="owner-bar">
          <div className="owner-bar__brand">
            {settings.data.tenant.logo_path ? <img className="topbar__logo" src={mediaUrl(settings.data.tenant.logo_path)} alt="" width={32} height={32} /> : null}
            <span className="owner-bar__title">
              <span className="owner-bar__eyebrow">Кабинет</span>
              <span className="owner-bar__name">{settings.data.tenant.short_name}</span>
            </span>
          </div>
          <div className="owner-bar__actions">
            <Link to={`/s/${slug}/`} className="topbar__profile" aria-label="Открыть витрину студии">
              <Storefront size={20} aria-hidden="true" />
            </Link>
            <IconButton variant="ghost" label="Выйти из кабинета" icon={<SignOut size={20} />} onClick={() => void signOut()} />
          </div>
        </header>
        <Routes>
          <Route index element={<Schedule />} />
          <Route path="stats" element={<Stats />} />
          {ASSISTANT_ENABLED ? <Route path="assistant" element={<OwnerAssistant />} /> : null}
          <Route path="settings/*" element={<Settings />} />
          <Route path="*" element={<Schedule />} />
        </Routes>
        <BottomNav
          label="Разделы кабинета"
          items={[
            { to: `${base}/`, label: 'Записи', icon: CalendarDots, end: true },
            { to: `${base}/stats`, label: 'Статистика', icon: ChartBar },
            ...(ASSISTANT_ENABLED ? [{ to: `${base}/assistant`, label: 'Помощник', icon: ChatCircleDots }] : []),
            { to: `${base}/settings`, label: 'Настройки', icon: GearSix },
          ]}
        />
      </div>
    </OwnerContext.Provider>
  );
}
