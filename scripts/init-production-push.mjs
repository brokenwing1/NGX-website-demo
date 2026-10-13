// Creates ignored local push credentials once. Never logs key values.
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import webPush from 'web-push';
const path = '.env.notify-worker.local';
if (!existsSync(path)) {
  const keys = webPush.generateVAPIDKeys();
  writeFileSync(path, [
    `VAPID_PUBLIC_KEY=${keys.publicKey}`,
    `VAPID_PRIVATE_KEY=${keys.privateKey}`,
    'VAPID_SUBJECT=https://ngx-website-demo.vercel.app',
    `NOTIFY_WORKER_SECRET=${randomBytes(32).toString('hex')}`,
    '',
  ].join('\n'), { mode: 0o600 });
  console.log('Created ignored push secrets file.');
} else console.log('Reusing existing push secrets.');
