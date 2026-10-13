# SETUP — запуск и деплой

Одна сборка фронтенда, один проект Supabase, у каждой студии свой адрес `/s/<slug>/`.
Данные студий разделены `tenant_id` + RLS + составными внешними ключами; все записи меняются только
через SQL‑функции, где права проверяются на сервере.

## Что нужно

- Node 22+, pnpm 10+
- Postgres 15+ (локально) — либо Docker для `supabase start`
- Для продакшена: проект Supabase, аккаунт Vercel. LLM‑провайдер и VAPID‑ключи — по желанию.

```bash
pnpm install
cp .env.example .env      # заполнить по комментариям
```

## Локально без Docker (так проект проверялся)

Нужен Postgres с суперпользователем (на macOS — Postgres.app).

```bash
ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm local:up
```

Скрипт создаёт базу `autoservice_dev`, применяет миграции и демо‑данные, поднимает локальный шлюз
(`scripts/local-gateway` — совместимые с Supabase RPC / Auth / Storage / Functions поверх этой базы),
публикует обе демо‑студии через настоящий конвейер и запускает Vite.

- Клиент: http://localhost:5173/s/ngx-detailing/ и /s/tork-service/
- Кабинет: `/s/ngx-detailing/owner/` — `owner+ngx@example.com` / `demo-ngx-2026`
  (ТОРК: `owner+tork@example.com` / `demo-tork-2026`)

С Docker можно использовать настоящий стек: `pnpm supabase start`, затем `pnpm supabase db reset`
(миграции + `supabase/seed.sql`) и `pnpm tenant:publish <slug>` с ключами из `supabase status`.

## Сборка

```bash
pnpm typecheck     # проверка типов
pnpm build         # production-сборка в dist/ (её и выкладывает Vercel)
pnpm demo:build    # демо без сервера: dist-demo/autoservice-demo.html и сайт для GitHub Pages в dist-pages/
```

## Продакшен: Supabase

```bash
pnpm supabase login
pnpm supabase link --project-ref <ref>
pnpm supabase db push                      # миграции supabase/migrations
pnpm supabase functions deploy notify-worker
pnpm supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:... NOTIFY_WORKER_SECRET=...
```

1. Authentication → Providers → Email: включить вход по паролю, **выключить регистрацию** (владельцев
   создаёт конвейер; `supabase/config.toml` уже содержит `enable_signup = false` для локального стека).
2. Включить расширения `pg_cron` и `pg_net`, положить два секрета в Vault и выполнить `supabase/cron.sql`
   (напоминания за 24 ч и уведомления владельцу идут через очередь с арендой и повторными попытками).
3. `pnpm vapid:generate` — пара ключей для Web Push (публичный ещё и в `VITE_VAPID_PUBLIC_KEY`).

ИИ‑помощник сейчас **выключен** (`VITE_ASSISTANT_ENABLED=false`): в интерфейсе его нет, функцию
`assistant` можно не деплоить. Чтобы вернуть: `functions deploy assistant`, секреты `LLM_*`
(любой OpenAI‑совместимый эндпоинт, модель меняется секретом `LLM_MODEL`) и
`VITE_ASSISTANT_ENABLED=true` в Vercel.

Ключ `service_role` и ключ LLM никогда не попадают во фронтенд: в сборку идут только переменные `VITE_*`
(URL проекта и публичный anon‑ключ).

### Развёрнутый NGX

Сайт: https://ngx-website-demo.vercel.app/ — открывает `/s/ngx-detailing/`.
Текущее состояние и оставшиеся действия описаны в `DEPLOYMENT-REVIEW.md`.
Публичные переменные задаются в Vercel; серверные ключи — только в Supabase.

На Windows используйте версию менеджера из проекта: `npx --yes pnpm@10.28.0 build`.
При отсутствии DB-пароля доступен публикационный скрипт через авторизованный CLI:

```powershell
npx --yes pnpm@10.28.0 exec tsx scripts/tenant/publish-cli.ts ngx-detailing eejslqvgghhbdfeactss
```

Он загружает контент и создаёт install assets, но не активирует студию и не меняет
аккаунты владельцев. Удалённые настройки Auth находятся в
`deployment/supabase/config.toml` (сначала `supabase config diff --workdir deployment
--project-ref <ref>`). `deployment/notify-cron.sql` создаёт только расписание worker
без очистки данных и без замены существующих заданий.

## Продакшен: Vercel

- Import Git repository, Framework: Other — всё остальное берётся из `vercel.json`
  (pnpm, `pnpm build`, `dist`, перезапись `/s/:slug/*` на оболочку студии, заголовки для SW и манифестов).
- Environment Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`,
  `PUBLIC_SITE_URL`.
- После каждого `tenant:publish` закоммитьте `tenants/<slug>/` и `public/s/<slug>/` (иконки, манифест,
  заставки iOS) — Vercel пересоберёт сайт. Код при этом не меняется.

## Где что лежит

| Путь | Что это |
|---|---|
| `tenants/<slug>/business.json` + `images/` | всё о студии: услуги, цены, длительности, посты, часы, контакты, фото |
| `schemas/business.schema.json` | JSON‑схема (подсказки в редакторе) |
| `scripts/tenant/*` | new → validate → publish → verify (`--activate`) |
| `supabase/local/bootstrap.sql` | заглушки Supabase для запуска на обычном Postgres (`pnpm local:up`) |
| `supabase/migrations` | схема, RLS, бронирование, деньги, очередь уведомлений, лимиты |
| `supabase/functions` | `notify-worker` (push), `assistant` (выключен в UI) |
| `src/` | приложение: клиент, мастер записи, кабинет владельца |
