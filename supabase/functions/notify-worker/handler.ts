// POST /functions/v1/notify-worker  (called every minute by Supabase Cron, see supabase/cron.sql)
// Leases due jobs from public.notification_jobs, delivers Web Push, and settles each job.
// Leasing + dedupe keys make concurrent or repeated runs safe; a crashed run's lease simply expires.
import { asServer } from '../_shared/db.ts';
import { getEnv } from '../_shared/env.ts';
import { HttpError, json, safeEqual } from '../_shared/http.ts';
import { webPushSender, type PushSender, type PushSubscriptionRow } from '../_shared/push.ts';

interface LeasedJob {
  job_id: number;
  kind: string;
  attempt: number;
  title: string;
  body: string;
  url: string;
  tag: string;
  subscriptions: PushSubscriptionRow[];
}

let sender: PushSender = webPushSender;
export function setPushSender(s: PushSender) {
  sender = s;
}

export async function processOnce(workerId: string, limit = 50) {
  const jobs = await asServer(async (tx) => {
    const [r] = await tx<{ jobs: LeasedJob[] }[]>`select app.claim_notification_jobs(${workerId}, ${limit}, 120) as jobs`;
    return r!.jobs;
  });
  const summary = { claimed: jobs.length, sent: 0, retry: 0, failed: 0, lease_lost: 0 };
  for (const job of jobs) {
    const payload = JSON.stringify({ title: job.title, body: job.body, url: job.url, tag: job.tag });
    const outcomes = await Promise.all(
      job.subscriptions.map(async (s) => ({ s, r: await sender(s, payload, { ttl: job.kind === 'client_reminder' ? 6 * 3600 : 3600, topic: job.tag }) })),
    );
    const gone = outcomes.filter((o) => o.r.gone).map((o) => o.s.id);
    const delivered = outcomes.some((o) => o.r.ok);
    const errors = outcomes.filter((o) => !o.r.ok).map((o) => `${o.r.status} ${o.r.error ?? ''}`.trim());
    // All subscriptions gone counts as done (nothing left to deliver to), not as a retryable failure.
    const done = delivered || (outcomes.length > 0 && gone.length === outcomes.length);
    const status = await asServer(async (tx) => {
      const [r] = await tx<{ s: string }[]>`
        select app.complete_notification_job(${job.job_id}, ${workerId}, ${done},
                 ${errors.length ? errors.join('; ').slice(0, 500) : null}, ${gone}::uuid[]) as s`;
      return r!.s;
    });
    if (status === 'sent') summary.sent++;
    else if (status === 'retry') summary.retry++;
    else if (status === 'failed') summary.failed++;
    else summary.lease_lost++;
  }
  return summary;
}

export async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'POST only');
    const secret = getEnv('NOTIFY_WORKER_SECRET');
    const header = req.headers.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!secret || !safeEqual(token, secret)) throw new HttpError(401, 'unauthorized', 'bad secret');

    const workerId = `edge-${crypto.randomUUID().slice(0, 8)}`;
    const started = Date.now();
    const total = { claimed: 0, sent: 0, retry: 0, failed: 0, lease_lost: 0, rounds: 0 };
    // Drain in rounds, staying well inside the platform time limit.
    while (Date.now() - started < 25_000) {
      const s = await processOnce(workerId);
      total.rounds++;
      for (const k of ['claimed', 'sent', 'retry', 'failed', 'lease_lost'] as const) total[k] += s[k];
      if (s.claimed === 0) break;
    }
    return json(total);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code }, e.status);
    console.error('notify-worker', e);
    return json({ error: 'internal' }, 500);
  }
}
