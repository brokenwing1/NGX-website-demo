import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { readBoot } from './lib/boot';
import { registerServiceWorker } from './lib/pwa';
import './styles/app.css';

const boot = readBoot();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App boot={boot} />
  </StrictMode>,
);

if (boot && import.meta.env.VITE_DEMO !== '1') {
  // Each studio gets its own service worker registration and caches (scope /s/<slug>/).
  window.addEventListener('load', () => void registerServiceWorker(boot.slug));
}
