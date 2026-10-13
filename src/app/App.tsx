import { LayerProvider, Theme } from '@astryxdesign/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider, createBrowserRouter, createMemoryRouter } from 'react-router';
import { applyAccent, DEMO, demoStartPath } from '../lib/accent';
import type { TenantBoot } from '../lib/boot';
import { DEFAULT_ACCENT } from '../lib/boot';
import { ApiError } from '../lib/api';
import { studioTheme } from './theme';
import { routes } from './routes';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (count, err) => {
          const code = err instanceof ApiError ? err.code : '';
          if (['forbidden', 'not_authenticated', 'tenant_not_found', 'booking_not_found', 'rate_limited'].includes(code)) return false;
          return count < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function App({ boot }: { boot: TenantBoot | null }) {
  applyAccent(boot?.accent ?? DEFAULT_ACCENT);
  const [queryClient] = useState(makeQueryClient);
  const [router] = useState(() => (DEMO ? createMemoryRouter(routes, { initialEntries: [demoStartPath()] }) : createBrowserRouter(routes)));
  return (
    <Theme theme={studioTheme(boot?.accent ?? DEFAULT_ACCENT)} mode="dark">
      <LayerProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </LayerProvider>
    </Theme>
  );
}
