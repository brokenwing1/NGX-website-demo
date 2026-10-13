-- Core multi-tenant model. Every dependent row carries tenant_id and references its parent
-- through a composite (tenant_id, id) foreign key, so a row can never point into another tenant.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  status text not null default 'preview' check (status in ('preview', 'live', 'suspended')),
  name text not null check (char_length(name) between 1 and 80),
  short_name text not null check (char_length(short_name) between 1 and 24),
  tagline text not null default '' check (char_length(tagline) <= 140),
  description text not null default '' check (char_length(description) <= 2000),
  address text not null default '' check (char_length(address) <= 200),
  map_url text check (map_url is null or map_url ~ '^https://'),
  phone text not null default '' check (char_length(phone) <= 32),
  messenger_url text check (messenger_url is null or messenger_url ~ '^https://'),
  timezone text not null default 'Europe/Moscow',
  currency text not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  locale text not null default 'ru-RU',
  accent_color text not null default '#4690FF' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  slot_step_minutes int not null default 30 check (slot_step_minutes in (10, 15, 20, 30, 60)),
  min_lead_minutes int not null default 60 check (min_lead_minutes between 0 and 10080),
  max_days_ahead int not null default 30 check (max_days_ahead between 1 and 180),
  cancel_cutoff_hours int not null default 3 check (cancel_cutoff_hours between 0 and 168),
  cancellation_policy text not null default '' check (char_length(cancellation_policy) <= 600),
  logo_path text,
  hero_path text,
  config_version int not null default 0,
  config_hash text,
  published_at timestamptz,
  activated_at timestamptz,
  owner_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function app.validate_tenant_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception using errcode = 'P0001', message = 'invalid_timezone', detail = new.timezone;
  end if;
  return new;
end;
$$;

create trigger tenants_validate_timezone before insert or update of timezone on public.tenants
for each row execute function app.validate_tenant_timezone();

create table public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user_idx on public.tenant_members(user_id);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,40}$'),
  name text not null check (char_length(name) between 1 and 60),
  active boolean not null default true,
  sort int not null default 0,
  source text not null default 'config' check (source in ('config', 'owner')),
  owner_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, key)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 600),
  category text not null default '' check (char_length(category) <= 40),
  duration_minutes int not null check (duration_minutes between 10 and 20160),
  buffer_minutes int not null default 0 check (buffer_minutes between 0 and 720),
  price_cents bigint not null check (price_cents >= 0),
  price_is_from boolean not null default false,
  image_path text,
  active boolean not null default true,
  sort int not null default 0,
  source text not null default 'config' check (source in ('config', 'owner')),
  owner_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, key)
);

-- Which resources can perform a service.
create table public.service_resources (
  tenant_id uuid not null,
  service_id uuid not null,
  resource_id uuid not null,
  primary key (tenant_id, service_id, resource_id),
  foreign key (tenant_id, service_id) references public.services(tenant_id, id) on delete cascade,
  foreign key (tenant_id, resource_id) references public.resources(tenant_id, id) on delete cascade
);

-- Price history: every change of a service price is appended here; bookings snapshot the price.
create table public.service_price_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  service_id uuid not null,
  price_cents bigint not null,
  price_is_from boolean not null,
  valid_from timestamptz not null default now(),
  foreign key (tenant_id, service_id) references public.services(tenant_id, id) on delete cascade
);

-- Weekly working hours define the moments a car can be accepted. ISO weekday 1=Mon..7=Sun.
create table public.working_hours (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  opens time not null,
  closes time not null,
  check (closes > opens)
);
create index working_hours_tenant_idx on public.working_hours(tenant_id, weekday);

-- Date overrides: closed day or special hours (replace the weekly hours for that date).
create table public.schedule_exceptions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day date not null,
  closed boolean not null default true,
  opens time,
  closes time,
  note text not null default '' check (char_length(note) <= 120),
  check (closed or (opens is not null and closes is not null and closes > opens)),
  unique (tenant_id, day, opens)
);
create index schedule_exceptions_tenant_day_idx on public.schedule_exceptions(tenant_id, day);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null,
  resource_id uuid not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'arrived', 'completed', 'cancelled', 'no_show')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  occupied_until timestamptz not null,
  service_name text not null,
  duration_minutes int not null,
  buffer_minutes int not null,
  price_cents bigint not null,
  price_is_from boolean not null,
  client_name text not null check (char_length(client_name) between 1 and 80),
  client_phone text not null check (client_phone ~ '^\+?[0-9]{10,15}$'),
  car text not null check (char_length(car) between 1 and 80),
  comment text not null default '' check (char_length(comment) <= 500),
  source text not null default 'client' check (source in ('client', 'owner')),
  is_demo boolean not null default false,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  request_fingerprint text not null,
  created_at timestamptz not null default now(),
  arrived_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('client', 'owner')),
  cancel_reason text check (char_length(cancel_reason) <= 300),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and occupied_until >= ends_at),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, service_id) references public.services(tenant_id, id),
  foreign key (tenant_id, resource_id) references public.resources(tenant_id, id)
);
create index bookings_tenant_start_idx on public.bookings(tenant_id, starts_at);

-- Manual resource blocks (repairs, private events).
create table public.resource_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  resource_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '' check (char_length(reason) <= 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  check (ends_at > starts_at),
  unique (tenant_id, id),
  foreign key (tenant_id, resource_id) references public.resources(tenant_id, id)
);

-- The single source of truth for "is this resource busy". Bookings and blocks both land here,
-- and the exclusion constraint makes double occupancy impossible regardless of the caller.
create table public.resource_occupancies (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  resource_id uuid not null,
  kind text not null check (kind in ('booking', 'block')),
  booking_id uuid,
  block_id uuid,
  during tstzrange not null check (not isempty(during) and lower_inc(during) and not upper_inc(during)),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'booking' and booking_id is not null and block_id is null)
      or (kind = 'block' and block_id is not null and booking_id is null)),
  foreign key (tenant_id, resource_id) references public.resources(tenant_id, id),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade,
  foreign key (tenant_id, block_id) references public.resource_blocks(tenant_id, id) on delete cascade,
  constraint resource_occupancies_no_overlap
    exclude using gist (tenant_id with =, resource_id with =, during with &&)
    where (released_at is null)
);
create unique index resource_occupancies_active_booking_uidx
  on public.resource_occupancies(booking_id) where released_at is null and booking_id is not null;
create index resource_occupancies_lookup_idx
  on public.resource_occupancies using gist (tenant_id, resource_id, during) where released_at is null;

-- Access to exactly one booking without registration. Only the SHA-256 of the token is stored.
create table public.booking_access_tokens (
  booking_id uuid primary key,
  tenant_id uuid not null,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);

-- Money actually received or returned. Never derived from booking prices.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  kind text not null check (kind in ('payment', 'refund')),
  amount_cents bigint not null check (amount_cents > 0),
  method text not null check (method in ('cash', 'card', 'transfer')),
  note text not null default '' check (char_length(note) <= 200),
  idempotency_key text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);
create index payments_tenant_created_idx on public.payments(tenant_id, created_at);

-- Public content managed by the owner: three info cards and the works gallery.
create table public.info_cards (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  icon text not null default 'Sparkle' check (icon ~ '^[A-Za-z]{2,40}$'),
  title text not null check (char_length(title) between 1 and 40),
  body text not null default '' check (char_length(body) <= 160),
  source text not null default 'config' check (source in ('config', 'owner')),
  owner_updated_at timestamptz,
  primary key (tenant_id, position)
);

create table public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  config_key text,
  image_path text not null,
  caption text not null default '' check (char_length(caption) <= 120),
  sort int not null default 0,
  source text not null default 'config' check (source in ('config', 'owner')),
  owner_updated_at timestamptz,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (tenant_id, config_key)
);
create index gallery_items_tenant_idx on public.gallery_items(tenant_id, sort);

-- Web Push subscriptions: either for one booking (client) or for an owner account.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_id uuid,
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  check ((booking_id is null) <> (user_id is null)),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);
create unique index push_subscriptions_booking_uidx
  on public.push_subscriptions(booking_id, endpoint) where booking_id is not null;
create unique index push_subscriptions_user_uidx
  on public.push_subscriptions(tenant_id, user_id, endpoint) where user_id is not null;

-- Outbox for notifications with leasing and deduplication.
create table public.notification_jobs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_id uuid,
  kind text not null check (kind in ('client_reminder', 'owner_new_booking', 'owner_cancelled')),
  dedupe_key text not null unique,
  due_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped')),
  attempts int not null default 0,
  lease_until timestamptz,
  locked_by text,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);
create index notification_jobs_due_idx on public.notification_jobs(due_at) where status in ('pending', 'processing');

-- Shared atomic counters for public rate limits and the LLM budget.
create table app.rate_counters (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

create table app.llm_usage (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day date not null,
  requests int not null default 0,
  tokens bigint not null default 0,
  primary key (tenant_id, day)
);

-- Keep updated_at fresh on bookings.
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger bookings_touch before update on public.bookings
for each row execute function app.touch_updated_at();

-- Record price history on insert/update of a service price.
create or replace function app.record_price_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.price_cents is distinct from old.price_cents
     or new.price_is_from is distinct from old.price_is_from then
    insert into public.service_price_history(tenant_id, service_id, price_cents, price_is_from)
    values (new.tenant_id, new.id, new.price_cents, new.price_is_from);
  end if;
  return new;
end;
$$;

create trigger services_price_history after insert or update of price_cents, price_is_from on public.services
for each row execute function app.record_price_history();
