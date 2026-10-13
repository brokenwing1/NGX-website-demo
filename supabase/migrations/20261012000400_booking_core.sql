-- Atomic booking operations shared by client and owner entry points.

-- Try to place an occupancy on the first free resource from the list.
-- Each attempt runs in its own subtransaction; the EXCLUDE constraint is the arbiter,
-- so two concurrent callers can never both win the same resource and time.
create or replace function app.try_occupy(
  p_tenant_id uuid, p_booking_id uuid, p_resources uuid[], p_range tstzrange
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r uuid;
begin
  foreach r in array p_resources loop
    begin
      insert into public.resource_occupancies(tenant_id, resource_id, kind, booking_id, during)
      values (p_tenant_id, r, 'booking', p_booking_id, p_range);
      return r;
    exception when exclusion_violation then
      -- busy, try the next suitable resource
    end;
  end loop;
  return null;
end;
$$;

create or replace function app.service_resource_ids(p_tenant_id uuid, p_service_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(r.id order by r.sort, r.name), '{}')
  from public.service_resources sr
  join public.resources r on r.tenant_id = sr.tenant_id and r.id = sr.resource_id and r.active
  where sr.tenant_id = p_tenant_id and sr.service_id = p_service_id
$$;

create or replace function app.can_client_cancel(b public.bookings, t public.tenants)
returns boolean
language sql
stable
set search_path = ''
as $$
  select b.status = 'confirmed' and now() <= b.starts_at - make_interval(hours => t.cancel_cutoff_hours)
$$;

-- Public representation of one booking (for the client who owns the token).
create or replace function app.booking_json(b public.bookings)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id,
    'status', b.status,
    'starts_at', b.starts_at,
    'ends_at', b.ends_at,
    'service_id', b.service_id,
    'service_name', b.service_name,
    'duration_minutes', b.duration_minutes,
    'price_cents', b.price_cents,
    'price_is_from', b.price_is_from,
    'client_name', b.client_name,
    'client_phone', b.client_phone,
    'car', b.car,
    'comment', b.comment,
    'is_demo', b.is_demo,
    'resource_name', r.name,
    'cancelled_at', b.cancelled_at,
    'can_cancel', app.can_client_cancel(b, t),
    'cancel_deadline', b.starts_at - make_interval(hours => t.cancel_cutoff_hours),
    'tenant', jsonb_build_object(
      'slug', t.slug, 'name', t.name, 'address', t.address, 'phone', t.phone,
      'map_url', t.map_url, 'timezone', t.timezone, 'currency', t.currency,
      'cancel_cutoff_hours', t.cancel_cutoff_hours, 'cancellation_policy', t.cancellation_policy,
      'status', t.status
    )
  )
  from public.tenants t
  join public.resources r on r.tenant_id = t.id and r.id = b.resource_id
  where t.id = b.tenant_id
$$;

-- Outbox: (re)create jobs for a booking. Preview tenants and demo bookings never notify.
create or replace function app.enqueue_booking_jobs(b public.bookings, p_event text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  reminder_at timestamptz;
begin
  select * into t from public.tenants where id = b.tenant_id;
  if t.status <> 'live' or b.is_demo then
    return;
  end if;

  if p_event in ('created', 'rescheduled') and b.status = 'confirmed' then
    reminder_at := b.starts_at - interval '24 hours';
    if reminder_at > now() + interval '5 minutes' then
      insert into public.notification_jobs(tenant_id, booking_id, kind, dedupe_key, due_at, payload)
      values (b.tenant_id, b.id, 'client_reminder',
              'reminder:' || b.id || ':' || extract(epoch from b.starts_at)::bigint,
              reminder_at,
              jsonb_build_object('starts_at', b.starts_at))
      on conflict (dedupe_key) do update
        set status = 'pending', due_at = excluded.due_at, attempts = 0, lease_until = null, locked_by = null
        where public.notification_jobs.status = 'cancelled';
    end if;
  end if;

  if p_event = 'created' and b.source = 'client' then
    insert into public.notification_jobs(tenant_id, booking_id, kind, dedupe_key, due_at, payload)
    values (b.tenant_id, b.id, 'owner_new_booking', 'owner_new:' || b.id, now(),
            jsonb_build_object('starts_at', b.starts_at))
    on conflict (dedupe_key) do nothing;
  end if;

  if p_event = 'cancelled' and b.cancelled_by = 'client' then
    insert into public.notification_jobs(tenant_id, booking_id, kind, dedupe_key, due_at, payload)
    values (b.tenant_id, b.id, 'owner_cancelled', 'owner_cancel:' || b.id, now(),
            jsonb_build_object('starts_at', b.starts_at))
    on conflict (dedupe_key) do nothing;
  end if;
end;
$$;

-- Cancel any not-yet-sent client reminders for a booking (on cancel or reschedule).
create or replace function app.cancel_reminders(p_booking_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notification_jobs
     set status = 'cancelled', lease_until = null, locked_by = null
   where booking_id = p_booking_id and kind = 'client_reminder' and status in ('pending', 'processing')
$$;

-- Create a booking atomically. Price, duration and tenant come from the database, never from the caller.
create or replace function app.create_booking(
  p_tenant public.tenants,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_client_name text,
  p_client_phone text,
  p_car text,
  p_comment text,
  p_idempotency_key text,
  p_source text,
  p_resource_id uuid default null,
  p_allow_off_grid boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := p_tenant;
  s public.services;
  b public.bookings;
  k text := btrim(coalesce(p_idempotency_key, ''));
  phone text;
  fp text;
  resources uuid[];
  chosen uuid;
  local_day date;
  rng tstzrange;
begin
  if char_length(k) < 8 or char_length(k) > 80 then
    perform app.fail('invalid_request', 'idempotency key');
  end if;
  phone := app.normalize_phone(p_client_phone);
  fp := md5(concat_ws('|', p_service_id::text, extract(epoch from p_starts_at)::text, phone,
                      btrim(coalesce(p_client_name, '')), btrim(coalesce(p_car, '')),
                      coalesce(p_resource_id::text, '')));

  -- Idempotent replay: same key returns the same booking and the same access token.
  select * into b from public.bookings where tenant_id = t.id and idempotency_key = k;
  if found then
    if b.request_fingerprint <> fp then
      perform app.fail('idempotency_conflict', 'Этот ключ уже использован для другой записи');
    end if;
    return jsonb_build_object('booking', app.booking_json(b), 'token', app.booking_token(b.id, k), 'replayed', true);
  end if;

  if char_length(btrim(coalesce(p_client_name, ''))) = 0 then
    perform app.fail('invalid_name', 'Укажите имя');
  end if;
  if char_length(btrim(coalesce(p_car, ''))) = 0 then
    perform app.fail('invalid_car', 'Укажите автомобиль');
  end if;

  select * into s from public.services where id = p_service_id and tenant_id = t.id and active;
  if not found then
    perform app.fail('service_not_found', 'Услуга не найдена');
  end if;

  local_day := (p_starts_at at time zone t.timezone)::date;
  if p_source = 'client' then
    if p_starts_at < now() + make_interval(mins => t.min_lead_minutes) then
      perform app.fail('too_soon', 'Это время уже недоступно для онлайн-записи');
    end if;
    if local_day > app.local_today(t.timezone) + t.max_days_ahead then
      perform app.fail('too_far', 'Запись так далеко пока не открыта');
    end if;
  end if;
  if not p_allow_off_grid and not exists (
    select 1 from app.candidate_starts(t.id, s.id, local_day, local_day) c where c.starts_at = p_starts_at
  ) then
    perform app.fail('outside_hours', 'Студия не принимает машины в это время');
  end if;

  if p_resource_id is not null then
    if not (p_resource_id = any(app.service_resource_ids(t.id, s.id))) then
      perform app.fail('resource_not_suitable', 'Этот пост не подходит для услуги');
    end if;
    resources := array[p_resource_id];
  else
    resources := app.service_resource_ids(t.id, s.id);
  end if;
  if cardinality(resources) = 0 then
    perform app.fail('no_resources', 'Для услуги не настроены посты');
  end if;

  rng := app.occupancy_range(p_starts_at, s.duration_minutes, s.buffer_minutes);

  begin
    insert into public.bookings(
      tenant_id, service_id, resource_id, status, starts_at, ends_at, occupied_until,
      service_name, duration_minutes, buffer_minutes, price_cents, price_is_from,
      client_name, client_phone, car, comment, source, is_demo, idempotency_key, request_fingerprint
    ) values (
      t.id, s.id, resources[1], 'confirmed', p_starts_at,
      p_starts_at + make_interval(mins => s.duration_minutes), upper(rng),
      s.name, s.duration_minutes, s.buffer_minutes, s.price_cents, s.price_is_from,
      btrim(p_client_name), phone, btrim(p_car), btrim(coalesce(p_comment, '')),
      p_source, t.status = 'preview', k, fp
    ) returning * into b;
  exception when unique_violation then
    -- A concurrent request with the same key committed first: return its result.
    select * into b from public.bookings where tenant_id = t.id and idempotency_key = k;
    if b.request_fingerprint <> fp then
      perform app.fail('idempotency_conflict', 'Этот ключ уже использован для другой записи');
    end if;
    return jsonb_build_object('booking', app.booking_json(b), 'token', app.booking_token(b.id, k), 'replayed', true);
  end;

  chosen := app.try_occupy(t.id, b.id, resources, rng);
  if chosen is null then
    perform app.fail('slot_taken', 'Это время только что заняли. Выберите другое.');
  end if;
  if chosen <> b.resource_id then
    update public.bookings set resource_id = chosen where id = b.id returning * into b;
  end if;

  insert into public.booking_access_tokens(booking_id, tenant_id, token_hash)
  values (b.id, t.id, app.token_hash(app.booking_token(b.id, k)));

  perform app.enqueue_booking_jobs(b, 'created');

  return jsonb_build_object('booking', app.booking_json(b), 'token', app.booking_token(b.id, k), 'replayed', false);
end;
$$;

-- Move a booking. Old occupancy is released and the new one placed in the same transaction:
-- if the new time is taken the whole call fails and the original booking stays untouched.
create or replace function app.reschedule_booking(
  p_tenant_id uuid, p_booking_id uuid, p_new_start timestamptz, p_resource_id uuid, p_allow_off_grid boolean
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  t public.tenants;
  resources uuid[];
  chosen uuid;
  rng tstzrange;
  local_day date;
begin
  select * into t from public.tenants where id = p_tenant_id;
  select * into b from public.bookings where id = p_booking_id and tenant_id = p_tenant_id for update;
  if not found then
    perform app.fail('booking_not_found', 'Запись не найдена');
  end if;
  if b.status <> 'confirmed' then
    perform app.fail('cannot_reschedule', 'Перенести можно только подтверждённую запись');
  end if;
  if b.starts_at = p_new_start and (p_resource_id is null or p_resource_id = b.resource_id) then
    return b; -- idempotent no-op
  end if;

  local_day := (p_new_start at time zone t.timezone)::date;
  if not p_allow_off_grid and not exists (
    select 1 from app.candidate_starts(t.id, b.service_id, local_day, local_day) c where c.starts_at = p_new_start
  ) then
    perform app.fail('outside_hours', 'Студия не принимает машины в это время');
  end if;

  if p_resource_id is not null then
    if not (p_resource_id = any(app.service_resource_ids(t.id, b.service_id))) then
      perform app.fail('resource_not_suitable', 'Этот пост не подходит для услуги');
    end if;
    resources := array[p_resource_id];
  else
    -- prefer keeping the same resource
    resources := array[b.resource_id] || array_remove(app.service_resource_ids(t.id, b.service_id), b.resource_id);
  end if;

  rng := app.occupancy_range(p_new_start, b.duration_minutes, b.buffer_minutes);

  update public.resource_occupancies set released_at = now()
   where booking_id = b.id and released_at is null;

  chosen := app.try_occupy(t.id, b.id, resources, rng);
  if chosen is null then
    perform app.fail('slot_taken', 'Новое время занято. Запись осталась на прежнем времени.');
  end if;

  update public.bookings
     set starts_at = p_new_start,
         ends_at = p_new_start + make_interval(mins => b.duration_minutes),
         occupied_until = upper(rng),
         resource_id = chosen
   where id = b.id
  returning * into b;

  perform app.cancel_reminders(b.id);
  perform app.enqueue_booking_jobs(b, 'rescheduled');
  return b;
end;
$$;

create or replace function app.cancel_booking(
  p_tenant_id uuid, p_booking_id uuid, p_by text, p_reason text
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id and tenant_id = p_tenant_id for update;
  if not found then
    perform app.fail('booking_not_found', 'Запись не найдена');
  end if;
  if b.status = 'cancelled' then
    return b; -- idempotent
  end if;
  if b.status <> 'confirmed' then
    perform app.fail('cannot_cancel', 'Эту запись уже нельзя отменить');
  end if;
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by,
         cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), '')
   where id = b.id
  returning * into b;
  update public.resource_occupancies set released_at = now()
   where booking_id = b.id and released_at is null;
  perform app.cancel_reminders(b.id);
  perform app.enqueue_booking_jobs(b, 'cancelled');
  return b;
end;
$$;

-- Nearest available starts for a service (scans the booking horizon week by week).
create or replace function app.nearest_slots(p_tenant_id uuid, p_service_id uuid, p_limit int)
returns table (starts_at timestamptz, local_day date, local_time time)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  d date;
  horizon date;
  found_n int := 0;
  rec record;
begin
  select * into t from public.tenants where id = p_tenant_id;
  d := app.local_today(t.timezone);
  horizon := d + t.max_days_ahead;
  while d <= horizon and found_n < p_limit loop
    for rec in
      select a.starts_at, a.local_day, a.local_time
      from app.availability(p_tenant_id, p_service_id, d, least(d + 6, horizon)) a
      where a.available
      order by a.starts_at
    loop
      starts_at := rec.starts_at; local_day := rec.local_day; local_time := rec.local_time;
      return next;
      found_n := found_n + 1;
      exit when found_n >= p_limit;
    end loop;
    d := d + 7;
  end loop;
end;
$$;
