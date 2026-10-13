import { Text } from '@astryxdesign/core';
import { Flask } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { BookingFlow } from '../booking/BookingFlow';
import { BottomNav, clientNavItems } from '../components/BottomNav';
import { ErrorState } from '../components/States';
import { StudioSkeleton } from '../components/StudioSkeleton';
import { TopBar } from '../components/TopBar';
import { api, ApiError } from '../lib/api';
import { myBookings } from '../lib/myBookings';
import { isConfigured } from '../lib/supabase';
import { applyAccent } from '../lib/accent';
import { NotFound } from '../pages/RootLanding';
import { StudioContext, type BookingRequest } from './studio';

export function StudioRoot() {
  const { slug = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const isOwner = /\/owner(\/|$)/.test(location.pathname);
  const [booking, setBooking] = useState<BookingRequest | null>(null);
  const [version, setVersion] = useState(0);

  const tenantQ = useQuery({
    queryKey: ['tenant', slug],
    queryFn: () => api.tenant(slug),
    enabled: isConfigured && !!slug,
    staleTime: 60_000,
  });

  const openBooking = useCallback((req?: BookingRequest) => setBooking(req ?? {}), []);
  const bumpMyBookings = useCallback(() => setVersion((v) => v + 1), []);

  // Manifest shortcut / deep link: /s/<slug>/?book=1
  useEffect(() => {
    if (search.get('book') === '1' && tenantQ.data) {
      setBooking({});
      search.delete('book');
      setSearch(search, { replace: true });
    }
  }, [search, setSearch, tenantQ.data]);

  useEffect(() => {
    if (tenantQ.data) applyAccent(tenantQ.data.accent_color);
  }, [tenantQ.data]);

  useEffect(() => {
    if (tenantQ.data) document.title = isOwner ? `Кабинет · ${tenantQ.data.short_name}` : tenantQ.data.name;
  }, [tenantQ.data, isOwner]);

  const myCount = useMemo(
    () => (slug ? myBookings.list(slug).filter((b) => new Date(b.startsAt).getTime() > Date.now() - 3 * 3600_000).length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug, version, location.pathname],
  );

  if (!isConfigured) {
    return (
      <main className="page page--center">
        <ErrorState error={new ApiError('not_configured', 'Приложение не подключено к базе: задайте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY (см. SETUP.md).')} />
      </main>
    );
  }
  if (tenantQ.isPending) return <StudioSkeleton />;
  if (tenantQ.isError) {
    const e = tenantQ.error;
    if (e instanceof ApiError && e.code === 'tenant_not_found') return <NotFound title="Студия не найдена" />;
    return (
      <main className="page page--center">
        <ErrorState error={e} onRetry={() => void tenantQ.refetch()} />
      </main>
    );
  }

  const tenant = tenantQ.data;
  return (
    <StudioContext.Provider value={{ slug, tenant, openBooking, myBookingsVersion: version, bumpMyBookings }}>
      {tenant.status === 'preview' ? (
        <div className="preview-banner" role="note">
          <Flask size={16} weight="fill" aria-hidden="true" />
          <Text type="supporting" color="inherit">
            Образец: записи тестовые, уведомления не отправляются
          </Text>
        </div>
      ) : null}
      <div className={isOwner ? 'owner-root' : 'client-root with-bottom-nav'}>
        {!isOwner ? <TopBar /> : null}
        <Outlet />
      </div>
      {!isOwner ? (
        <>
          <BottomNav items={clientNavItems(slug, myCount)} label="Разделы студии" />
          <BookingFlow
            request={booking}
            onClose={() => setBooking(null)}
            onBooked={(id) => {
              bumpMyBookings();
              setBooking(null);
              navigate(`/s/${slug}/my/${id}`);
            }}
          />
        </>
      ) : null}
    </StudioContext.Provider>
  );
}
