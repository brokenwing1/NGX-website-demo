/// <reference lib="webworker" />
// One service worker script, registered by every studio with its own scope (/s/<slug>/).
// Each registration gets cache names prefixed with its slug. Only public, non-personal resources
// are cached: the shared JS/CSS bundle, the studio's HTML shell and public media. API calls
// (REST/RPC, Auth, Functions) are never cached, so no private data ever lands in Cache Storage.
import { clientsClaim, setCacheNameDetails } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

const scopePath = new URL(self.registration.scope).pathname; // "/s/<slug>/"
const slug = /^\/s\/([a-z0-9-]+)\//.exec(scopePath)?.[1] ?? 'root';

setCacheNameDetails({ prefix: `studio-${slug}`, suffix: 'v1', precache: 'precache', runtime: 'runtime' });

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// HTML shell of THIS studio: network first (fresh deploys win), cached copy offline.
const shellCache = `studio-${slug}-shell-v1`;
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: shellCache,
      networkTimeoutSeconds: 4,
      plugins: [
        {
          // Every in-scope navigation is served by the same shell document.
          cacheKeyWillBeUsed: async () => scopePath,
        },
      ],
    }),
    { allowlist: [new RegExp(`^${scopePath.replace(/\//g, '\\/')}`)] },
  ),
);

// Studio install assets (icons, manifest, splash) — public.
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith(scopePath) && /\.(png|jpg|webmanifest)$/.test(url.pathname),
  new CacheFirst({ cacheName: `studio-${slug}-assets-v1`, plugins: [new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 30 * 86400 })] }),
);

// Public media from Storage (photos of works and services). Never anything under /rest, /auth, /functions.
registerRoute(
  ({ url, request }) => request.destination === 'image' && url.pathname.includes('/storage/v1/object/public/'),
  new CacheFirst({
    cacheName: `studio-${slug}-media-v1`,
    plugins: [new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 30 * 86400, purgeOnQuotaError: true })],
  }),
);

// Web Push: reminders for clients, new-booking alerts for owners.
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Напоминание', {
      body: data.body ?? '',
      tag: data.tag,
      icon: `${scopePath}icon-192.png`,
      badge: `${scopePath}icon-192.png`,
      data: { url: data.url ?? scopePath },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data as { url?: string })?.url ?? scopePath, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
          await (c as WindowClient).navigate(target).catch(() => undefined);
          return (c as WindowClient).focus();
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
