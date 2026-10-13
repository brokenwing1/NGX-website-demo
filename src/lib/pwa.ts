// PWA capabilities: install state, service worker per studio scope, honest push availability.
import { VAPID_PUBLIC_KEY } from './supabase';

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
}

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'unsupported' | 'ios_needs_install' | 'denied' | 'no_service_worker' };

/** Web Push on iPhone works only for an app added to the Home Screen (iOS 16.4+). We say so instead of pretending. */
export function pushSupport(): PushSupport {
  if (!VAPID_PUBLIC_KEY) return { ok: false, reason: 'not_configured' };
  if (!('serviceWorker' in navigator)) return { ok: false, reason: 'no_service_worker' };
  if (isIos() && !isStandalone()) return { ok: false, reason: 'ios_needs_install' };
  if (!('PushManager' in window) || !('Notification' in window)) return { ok: false, reason: 'unsupported' };
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };
  return { ok: true };
}

export const PUSH_REASON_TEXT: Record<Exclude<PushSupport, { ok: true }>['reason'], string> = {
  not_configured: 'Напоминания пока не настроены студией. Добавьте запись в календарь — он напомнит сам.',
  unsupported: 'Этот браузер не поддерживает уведомления. Добавьте запись в календарь.',
  ios_needs_install: 'На iPhone уведомления работают только у приложения на экране «Домой»: «Поделиться» → «На экран Домой», затем откройте его и включите напоминание.',
  denied: 'Уведомления запрещены в настройках браузера. Разрешите их или добавьте запись в календарь.',
  no_service_worker: 'Браузер не поддерживает фоновые уведомления. Добавьте запись в календарь.',
};

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function registerServiceWorker(slug: string): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: `/s/${slug}/` });
  } catch {
    return null;
  }
}

export async function subscribePush(slug: string): Promise<PushSubscriptionJSON> {
  const support = pushSupport();
  if (!support.ok) throw new Error(PUSH_REASON_TEXT[support.reason]);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(PUSH_REASON_TEXT.denied);
  const reg = (await navigator.serviceWorker.getRegistration(`/s/${slug}/`)) ?? (await registerServiceWorker(slug));
  if (!reg) throw new Error(PUSH_REASON_TEXT.no_service_worker);
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource }));
  return sub.toJSON();
}

// "Add to Home Screen" prompt (Chromium). iOS has no prompt: we show instructions instead.
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    justInstalled = true;
    listeners.forEach((l) => l());
  });
}

/** In-app browsers (Telegram, Instagram, VK…) cannot add sites to the Home Screen at all. */
export function isInAppBrowser(): boolean {
  return /Telegram|Instagram|FBAN|FBAV|VKClient|Line\//i.test(navigator.userAgent);
}

export const installPrompt = {
  available: () => deferredPrompt !== null,
  installed: () => justInstalled || isStandalone(),
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  async prompt(): Promise<boolean> {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    listeners.forEach((l) => l());
    return choice.outcome === 'accepted';
  },
};
