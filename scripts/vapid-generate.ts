// pnpm vapid:generate — prints a VAPID key pair for Web Push.
// Public key → VITE_VAPID_PUBLIC_KEY (frontend) and VAPID_PUBLIC_KEY (edge secret);
// private key → VAPID_PRIVATE_KEY (edge secret only, never in the frontend).
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log(`VITE_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
