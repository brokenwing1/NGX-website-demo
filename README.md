# Онлайн‑запись для автосервисов и детейлинг‑студий

PWA: клиент записывается по ссылке без регистрации и может установить приложение на экран «Домой»;
владелец ведёт записи, деньги и настройки в кабинете. Одна сборка обслуживает много студий —
у каждой свой адрес `/s/<slug>/`, иконка и оформление.

- **SETUP.md** — запуск локально, деплой Supabase + Vercel
- **CLONE-IN-6-MINUTES.md** — как подготовить новую студию без изменения кода
- **dist-pages/** после `pnpm demo:build` — демо‑сайт для GitHub Pages (устанавливается на телефон)

Стек: TypeScript, React, Vite, React Router, Astryx + Phosphor, TanStack Query, Zod, Supabase
(Postgres, RLS, Auth, Storage, Edge Functions), date‑fns‑tz, vite‑plugin‑pwa + Workbox, liquid‑gl,
Vercel, pnpm.

```bash
pnpm install
ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm local:up
# → http://localhost:5173/s/ngx-detailing/
```
