// Web Push delivery (VAPID). Isolated behind an interface so the worker can be tested without network.
import webpush from 'web-push';
import { requireEnv } from './env.ts';

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushOutcome {
  ok: boolean;
  gone: boolean;
  status: number;
  error?: string;
}

export type PushSender = (sub: PushSubscriptionRow, payload: string, opts: { ttl: number; topic?: string }) => Promise<PushOutcome>;

let configured = false;

export const webPushSender: PushSender = async (sub, payload, opts) => {
  if (!configured) {
    webpush.setVapidDetails(requireEnv('VAPID_SUBJECT'), requireEnv('VAPID_PUBLIC_KEY'), requireEnv('VAPID_PRIVATE_KEY'));
    configured = true;
  }
  try {
    const res = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: opts.ttl, urgency: 'normal', topic: opts.topic?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) },
    );
    return { ok: true, gone: false, status: res.statusCode };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode ?? 0;
    return { ok: false, gone: status === 404 || status === 410, status, error: (e as Error).message?.slice(0, 200) };
  }
};
