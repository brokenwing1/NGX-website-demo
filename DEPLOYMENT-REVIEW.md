# Проверка перед production-развёртыванием

Целевая схема: существующий Supabase **NGX-autoservise-demo** + Vercel + GitHub
`brokenwing1/NGX-website-demo`. Удалённая база проверена; 10 миграций применены
после явного подтверждения пользователя. Сайт развёрнут на Vercel:
https://ngx-website-demo.vercel.app/ (корень перенаправляет на NGX).
Подключён существующий проект `eejslqvgghhbdfeactss` (NGX-autoservise-demo),
регион eu-west-1, PostgreSQL 17, статус ACTIVE_HEALTHY.

## Архитектура

- React 19 / TypeScript / Vite 7, статическая сборка `dist/`.
- `build/tenant-shells.ts` создаёт `dist/s/<slug>/index.html`; Vercel направляет
  клиентские и owner-маршруты на эту оболочку. Корень показывает общую страницу.
- PostgreSQL: бронирования, оплата, настройки, разграничение студий через tenant_id.
  Клиент вызывает RPC, владельцы входят через Supabase Auth. Прямые изменения таблиц
  клиентскими ролями запрещены; серверные функции проверяют членство.
- Storage: публичные фотографии в `media`. PWA: общий sw.js с отдельными scope студий.
- `notify-worker`: Web Push и обработка очереди. `assistant` выключен и не нужен для запуска.
- Приложенный `ngx-detailing.html` имеет встроенные изображения, демонстрационные
  реквизиты входа и localStorage; production использует исходники проекта, не этот HTML.
- По решению пользователя существующие демонстрационные контакты и услуги сохраняются.

## SQL-изменения — подтверждены пользователем и применены

Десять миграций `20261012000100`–`20261012001000`:

| Область | Объекты |
|---|---|
| Студии и доступ | public.tenants, public.tenant_members |
| Услуги и посты | public.resources, public.services, public.service_resources, public.service_price_history |
| Расписание | public.working_hours, public.schedule_exceptions |
| Записи | public.bookings, public.resource_blocks, public.resource_occupancies, public.booking_access_tokens |
| Деньги и контент | public.payments, public.info_cards, public.gallery_items |
| Уведомления | public.push_subscriptions, public.notification_jobs |
| Приватная схема | app.secrets, app.rate_counters, app.llm_usage, app.llm_usage_global |

Создаются схемы app/extensions, расширения btree_gist/pgcrypto, индексы,
составные FK, защита от пересечения занятости, триггеры времени/истории цен,
SQL-функции API, бронирования, публикации, уведомлений и лимитов.

RLS включается на всех 17 таблицах public. Создаются 14 SELECT-политик:
`tenants_member_read`, `members_read` и `<table>_member_read` для resources,
services, service_resources, service_price_history, working_hours,
schedule_exceptions, bookings, resource_blocks, resource_occupancies, payments,
info_cards, gallery_items. Чтение ограничено членством пользователя в студии.
booking_access_tokens, push_subscriptions, notification_jobs не получают клиентских
политик или grants. Anon получает только разрешённые публичные RPC;
authenticated — публичные и owner RPC. Меняются default privileges создающей роли.

Storage: создаётся либо обновляется bucket `media`: публичный доступ,
лимит 8 MiB, JPEG/PNG/WebP. Создаются `media_owner_insert` и `media_owner_update`
для файлов `<tenant_id>/owner/` с проверкой членства.
**Если media уже существует и содержит приватные файлы, это изменение нельзя
применять до проверки содержимого и отдельного решения.**

## Операции, которые нельзя запускать вслепую

- В миграциях нет DROP TABLE/TRUNCATE или отключения RLS. DELETE находится внутри
  определений функций и не выполняется самим CREATE FUNCTION.
- CREATE TABLE/CREATE POLICY может конфликтовать с существующими объектами;
  CREATE OR REPLACE FUNCTION заменит одноимённую функцию.
- `app.publish_tenant` заменяет расписание/исключения и связи услуг в рамках
  студии, а удалённые из конфига услуги/посты деактивирует. `--force` не применять.
- `app.activate_tenant` удаляет бронирования is_demo с каскадными зависимостями.
  Перед активацией отдельно показать количество и получить разрешение на удаление.
- `supabase/cron.sql` заменяет задания notify-worker/rate-counters-cleanup и
  планирует удаление счётчиков старше 2 дней и статистики LLM старше 90 дней.
  Согласовать вместе с SQL; перед запуском проверить существующие задания.
- `seed.sql`, `db reset`, локальный bootstrap и опубликованные demo-пароли
  не использовать для production.

## Окружение и доступ

| Место | Переменные |
|---|---|
| Vercel, публичная сборка | VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_VAPID_PUBLIC_KEY, VITE_ASSISTANT_ENABLED=false, PUBLIC_SITE_URL |
| Локальный закрытый pipeline | DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, PUBLIC_SITE_URL |
| Supabase Edge secrets | NOTIFY_WORKER_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT; проверить доступность SUPABASE_DB_URL либо задать DATABASE_URL |
| Supabase Vault | project_url, notify_worker_secret |

Не помещать service_role, DB-пароль, приватный VAPID или LLM-ключ в VITE_*.
Не выводить значения секретов в отчёты. .env-файлы и .vercel исключены из Git.
Серверные секреты в Vercel для этого статического frontend не нужны.

## Оставшиеся действия

1. Получить email владельца, создать/привязать аккаунт, проверить вход и owner RPC.
2. Активировать студию после проверки готовности. Сейчас status=preview:
   бронирования считаются демонстрационными, push для них не отправляется.
   Перед активацией проверить количество demo-записей; удаление потребует разрешения.
3. Проверить доставку push на реальное подписанное устройство.
4. Очистка старых счётчиков не включена: создан только недеструктивный notify-worker Cron.

Успешная локальная сборка без настоящих переменных не подтверждает доступ к backend.
Развёрнутый frontend подключён к реальному Supabase, автономный HTML не используется.

## Фактически выполненные проверки

- Node 24.21.0, Git 2.53.0, pnpm 10.28.0 через npx, Supabase CLI 2.120.0,
  Vercel CLI 63.1.2 доступны. Глобальный pnpm 11 не использован для установки.
- Исправлен lockfile: удалены записи зависимостей, которых уже нет в package.json.
  Повторный `pnpm@10.28.0 install --frozen-lockfile --offline` успешен.
- `pnpm@10.28.0 build` успешен, включая TypeScript и Workbox service worker.
  Первоначальный запуск из sandbox дал ошибки разрешения транзитивных типов;
  сборка с доступом к установленным пакетам завершилась без изменения исходников.
- Обе студии проходят tenant:validate. Оболочки, scope/start_url манифестов,
  наличие иконок и sw.js проверены в dist/.
- Установщик предупреждает о peer dependency OpenAI 5 / Zod 4;
  текущая сборка проходит, assistant остаётся выключенным.
- Vercel: вход выполнен пользователем; проект ngx-website-demo
  в scope brokenwing1 связан с локальным каталогом. Production deployment успешен.
  Служебные .env.local и .vercel/project.json проверены на исключение из Git.
- Supabase: браузерная авторизация завершена, checkout связан с существующим проектом.
  Прочитано состояние: public/app без таблиц, buckets пуст, Auth users = 0,
  таблицы истории миграций не было. Dry-run перечислил ровно 10 локальных миграций,
  seeds/roles не запланированы. Все 10 миграций применены после подтверждения.
- Docker CLI установлен, Docker daemon не запущен; SQL локально ещё не выполнен.
- Загружен NGX: 6 услуг, 3 поста, 6 фотографий галереи. Штатная обработка изображений
  и app.publish_tenant использованы через scripts/tenant/publish-cli.ts без DB-пароля.
- Проверено 17/17 public-таблиц с RLS, 14 read-политик. Anon-чтение bookings: HTTP 401.
- get_tenant_public возвращает студию и услуги; get_nearest_slots возвращает 3 слота.
- Production Auth URL настроен; публичная регистрация выключена. Аккаунт владельца
  пока не создан: пользователь ещё не указал email. Вход/изоляция двух владельцев не проверены.
- notify-worker развёрнут; секреты сохранены в Supabase, Vault содержит две настройки.
  Ручной защищённый вызов: HTTP 200. Cron дал 3 успешных запуска с HTTP 200.
- Приватные VAPID/worker/service_role значения не найдены в frontend dist/.
  Файлы секретов исключены из Git и Vercel-upload; временный SQL с секретом удалён.
- Исправлен rewrite для trailingSlash=true. Корень, services, owner, my, profile,
  manifest и sw.js проверены без авторизации Vercel: все возвращают HTTP 200.
- Встроенный браузер не подключился; визуальная проверка браузером пока недоступна.
