import { ASSISTANT_ENABLED } from '../lib/supabase';
import { lazy, Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { PageLoader } from '../components/States';
import { NotFound, RootLanding } from '../pages/RootLanding';
import { StudioRoot } from './StudioRoot';
import { Home } from '../pages/client/Home';

// Client pages are small and eager; the owner cabinet is a separate chunk.
const Services = lazy(() => import('../pages/client/Services').then((m) => ({ default: m.Services })));
const MyBookings = lazy(() => import('../pages/client/MyBookings').then((m) => ({ default: m.MyBookings })));
const BookingDetails = lazy(() => import('../pages/client/BookingDetails').then((m) => ({ default: m.BookingDetails })));
const Profile = lazy(() => import('../pages/client/Profile').then((m) => ({ default: m.Profile })));
const AssistantPage = lazy(() => import('../pages/client/AssistantPage').then((m) => ({ default: m.AssistantPage })));
const OwnerApp = lazy(() => import('../owner/OwnerApp').then((m) => ({ default: m.OwnerApp })));

const s = (node: ReactNode) => <Suspense fallback={<PageLoader />}>{node}</Suspense>;

export const routes: RouteObject[] = [
  { path: '/', element: <RootLanding /> },
  {
    path: '/s/:slug',
    element: <StudioRoot />,
    children: [
      { index: true, element: <Home /> },
      { path: 'services', element: s(<Services />) },
      { path: 'my', element: s(<MyBookings />) },
      { path: 'profile', element: s(<Profile />) },
      { path: 'my/:bookingId', element: s(<BookingDetails />) },
      ...(ASSISTANT_ENABLED ? [{ path: 'assistant', element: s(<AssistantPage />) }] : []),
      { path: 'owner/*', element: s(<OwnerApp />) },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '*', element: <NotFound /> },
];
