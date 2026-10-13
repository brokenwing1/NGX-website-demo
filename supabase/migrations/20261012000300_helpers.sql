-- Helpers: identity, membership, rate limits, time periods and availability core.

-- Current authenticated user id, or null.
create or replace function app.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid
$$;

create or replace function app.my_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id from public.tenant_members m where m.user_id = app.current_user_id()
$$;

create or replace function app.is_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = p_tenant_id and m.user_id = app.current_user_id()
  )
$$;

-- Resolve the tenant an owner is acting on, confirmed by membership on the server.
create or replace function app.require_member(p_slug text)
returns public.tenants
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  if app.current_user_id() is null then
    perform app.fail('not_authenticated', 'Войдите в кабинет');
  end if;
  select * into t from public.tenants where slug = p_slug;
  if not found or not app.is_member(t.id) then
    -- Same answer for "no such studio" and "not your studio": no tenant enumeration.
    perform app.fail('forbidden', 'Нет доступа к этой студии');
  end if;
  return t;
end;
$$;

-- Public tenant lookup (preview and live only).
create or replace function app.public_tenant(p_slug text)
returns public.tenants
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  select * into t from public.tenants where slug = lower(p_slug) and status in ('preview', 'live');
  if not found then
    perform app.fail('tenant_not_found', 'Студия не найдена');
  end if;
  return t;
end;
$$;

-- Caller network identity from PostgREST request headers (or the edge function that set them).
create or replace function app.client_key()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  h jsonb;
  v text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  if h is null then
    return 'unknown';
  end if;
  v := coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1));
  v := btrim(coalesce(v, ''));
  return case when v = '' then 'unknown' else left(v, 64) end;
end;
$$;

-- Fixed-window counter shared by every instance. Returns false when the limit is exceeded.
create or replace function app.hit_rate_limit(p_bucket text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n int;
begin
  insert into app.rate_counters as rc(bucket, window_start, hits)
  values (p_bucket, w, 1)
  on conflict (bucket, window_start) do update set hits = rc.hits + 1
  returning hits into n;
  -- Opportunistic cleanup of stale windows (cheap, indexed by primary key prefix scan is not needed).
  if random() < 0.01 then
    delete from app.rate_counters where window_start < now() - interval '2 days';
  end if;
  return n <= p_max;
end;
$$;

create or replace function app.enforce_rate_limit(p_bucket text, p_max int, p_window_seconds int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.hit_rate_limit(p_bucket, p_max, p_window_seconds) then
    perform app.fail('rate_limited', 'Слишком много запросов. Попробуйте через минуту.');
  end if;
end;
$$;

-- Local "today" for a tenant.
create or replace function app.local_today(p_tz text)
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone p_tz)::date
$$;

-- Convert a local wall-clock day+time of a tenant into an absolute timestamp.
create or replace function app.local_to_ts(p_day date, p_time time, p_tz text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (p_day + p_time) at time zone p_tz
$$;

-- Named reporting periods, resolved in the tenant's timezone. Used by the cabinet and the assistant,
-- so "this week" means the same thing in both places. Weeks start on Monday.
create or replace function app.period_days(p_period text, p_tz text, p_ref date default null)
returns table (from_day date, to_day date, label text)
language plpgsql
stable
set search_path = ''
as $$
declare
  d date := coalesce(p_ref, app.local_today(p_tz));
  wk date := d - (extract(isodow from d)::int - 1);
  mo date := date_trunc('month', d)::date;
begin
  case p_period
    when 'today' then return query select d, d, 'Сегодня'::text;
    when 'yesterday' then return query select d - 1, d - 1, 'Вчера'::text;
    when 'tomorrow' then return query select d + 1, d + 1, 'Завтра'::text;
    when 'this_week' then return query select wk, wk + 6, 'Эта неделя'::text;
    when 'last_week' then return query select wk - 7, wk - 1, 'Прошлая неделя'::text;
    when 'next_week' then return query select wk + 7, wk + 13, 'Следующая неделя'::text;
    when 'this_month' then return query select mo, (mo + interval '1 month' - interval '1 day')::date, 'Этот месяц'::text;
    when 'last_month' then return query select (mo - interval '1 month')::date, mo - 1, 'Прошлый месяц'::text;
    when 'last_7_days' then return query select d - 6, d, 'Последние 7 дней'::text;
    when 'last_30_days' then return query select d - 29, d, 'Последние 30 дней'::text;
    else perform app.fail('invalid_period', p_period);
  end case;
end;
$$;

-- Working intervals for one local day: date exceptions override the weekly schedule.
create or replace function app.day_intervals(p_tenant_id uuid, p_day date)
returns table (opens time, closes time)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.schedule_exceptions e where e.tenant_id = p_tenant_id and e.day = p_day) then
    return query
      select e.opens, e.closes from public.schedule_exceptions e
      where e.tenant_id = p_tenant_id and e.day = p_day and not e.closed
      order by e.opens;
  else
    return query
      select w.opens, w.closes from public.working_hours w
      where w.tenant_id = p_tenant_id and w.weekday = extract(isodow from p_day)::smallint
      order by w.opens;
  end if;
end;
$$;

-- Candidate start moments for a service. Working hours define acceptance moments:
--   * a service that fits inside the working interval must also finish before closing;
--   * a longer (e.g. multi-day) service only needs to START inside working hours, and then
--     occupies its resource continuously, nights included.
create or replace function app.candidate_starts(
  p_tenant_id uuid, p_service_id uuid, p_from date, p_to date
)
returns table (starts_at timestamptz, local_day date, local_time time)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  s public.services;
  d date;
  iv record;
  step interval;
  dur interval;
  last_start timestamp;
  ts timestamp;
begin
  select * into t from public.tenants where id = p_tenant_id;
  select * into s from public.services where id = p_service_id and tenant_id = p_tenant_id;
  if s.id is null then
    return;
  end if;
  step := make_interval(mins => t.slot_step_minutes);
  dur := make_interval(mins => s.duration_minutes);
  d := p_from;
  while d <= p_to loop
    for iv in select * from app.day_intervals(p_tenant_id, d) loop
      if (iv.closes - iv.opens) >= dur then
        last_start := d + iv.closes - dur;
      else
        last_start := d + iv.closes - interval '1 minute';
      end if;
      ts := d + iv.opens;
      while ts <= last_start loop
        starts_at := ts at time zone t.timezone;
        local_day := d;
        local_time := ts::time;
        return next;
        ts := ts + step;
      end loop;
    end loop;
    d := d + 1;
  end loop;
end;
$$;

-- Is the resource free for the whole range? (used for display; the EXCLUDE constraint is the real guard)
create or replace function app.resource_is_free(p_tenant_id uuid, p_resource_id uuid, p_range tstzrange)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.resource_occupancies o
    where o.tenant_id = p_tenant_id and o.resource_id = p_resource_id
      and o.released_at is null and o.during && p_range
  )
$$;

-- Bookable range for a service starting at p_start: work time + buffer, continuous.
create or replace function app.occupancy_range(p_start timestamptz, p_duration int, p_buffer int)
returns tstzrange
language sql
immutable
set search_path = ''
as $$
  select tstzrange(p_start, p_start + make_interval(mins => p_duration + p_buffer), '[)')
$$;

-- Availability grid with busy slots marked.
create or replace function app.availability(
  p_tenant_id uuid, p_service_id uuid, p_from date, p_to date
)
returns table (starts_at timestamptz, local_day date, local_time time, available boolean, free_resources int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  s public.services;
  earliest timestamptz;
  horizon date;
begin
  select * into t from public.tenants where id = p_tenant_id;
  select * into s from public.services where id = p_service_id and tenant_id = p_tenant_id and active;
  if s.id is null then
    perform app.fail('service_not_found', 'Услуга не найдена');
  end if;
  earliest := now() + make_interval(mins => t.min_lead_minutes);
  horizon := app.local_today(t.timezone) + t.max_days_ahead;
  return query
    with c as (
      select cs.starts_at, cs.local_day, cs.local_time
      from app.candidate_starts(p_tenant_id, p_service_id, greatest(p_from, app.local_today(t.timezone)), least(p_to, horizon)) cs
      where cs.starts_at >= earliest
    )
    select c.starts_at, c.local_day, c.local_time,
      (fr.n > 0) as available, fr.n::int
    from c
    cross join lateral (
      select count(*) as n
      from public.service_resources sr
      join public.resources r on r.tenant_id = sr.tenant_id and r.id = sr.resource_id and r.active
      where sr.tenant_id = p_tenant_id and sr.service_id = p_service_id
        and app.resource_is_free(p_tenant_id, sr.resource_id,
              app.occupancy_range(c.starts_at, s.duration_minutes, s.buffer_minutes))
    ) fr
    order by c.starts_at;
end;
$$;

-- Normalise a phone number to +digits.
create or replace function app.normalize_phone(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  digits text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
begin
  if length(digits) = 11 and left(digits, 1) = '8' then
    digits := '7' || substr(digits, 2);
  elsif length(digits) = 10 then
    digits := '7' || digits;
  end if;
  if length(digits) < 10 or length(digits) > 15 then
    perform app.fail('invalid_phone', 'Проверьте номер телефона');
  end if;
  return '+' || digits;
end;
$$;

-- Booking access token: HMAC(server secret, booking id || idempotency key).
-- Deterministic, so a retried request with the same idempotency key gets the same access token,
-- while the database only ever stores its SHA-256.
create or replace function app.booking_token(p_booking_id uuid, p_idempotency_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select translate(encode(extensions.hmac(
           convert_to(p_booking_id::text || ':' || p_idempotency_key, 'UTF8'),
           (select value from app.secrets where key = 'booking_token_hmac'),
           'sha256'), 'base64'), '+/=', '-_')
$$;

create or replace function app.token_hash(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256')
$$;

-- Resolve a booking by id + token (constant answer for wrong id or wrong token).
create or replace function app.booking_by_token(p_booking_id uuid, p_token text)
returns public.bookings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  select bk.* into b
  from public.booking_access_tokens tk
  join public.bookings bk on bk.id = tk.booking_id and bk.tenant_id = tk.tenant_id
  where tk.booking_id = p_booking_id and tk.token_hash = app.token_hash(p_token) and tk.revoked_at is null;
  if not found then
    perform app.fail('booking_not_found', 'Запись не найдена или ссылка недействительна');
  end if;
  return b;
end;
$$;
