-- Owner cabinet API. Every function resolves the tenant from the slug AND confirms membership
-- of auth.uid() on the server. Reads run as SECURITY INVOKER so row level security applies too.

-- ---------------------------------------------------------------- reads (RLS enforced)

create or replace function public.owner_me()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'name', t.name, 'role', m.role, 'status', t.status)
                            order by t.name), '[]'::jsonb)
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = app.current_user_id()
$$;

create or replace function public.owner_settings(p_slug text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  t public.tenants;
begin
  select * into t from public.tenants where slug = p_slug;
  if not found or not app.is_member(t.id) then
    perform app.fail('forbidden', 'Нет доступа к этой студии');
  end if;
  return jsonb_build_object(
    'tenant', to_jsonb(t) - 'config_hash',
    'today', app.local_today(t.timezone),
    'resources', coalesce((select jsonb_agg(to_jsonb(r) order by r.sort, r.name)
                           from public.resources r where r.tenant_id = t.id), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object(
                             'resource_ids', (select coalesce(jsonb_agg(sr.resource_id), '[]'::jsonb)
                                              from public.service_resources sr
                                              where sr.tenant_id = t.id and sr.service_id = s.id))
                           order by s.sort, s.name)
                          from public.services s where s.tenant_id = t.id), '[]'::jsonb),
    'working_hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', w.weekday,
                                 'opens', to_char(w.opens, 'HH24:MI'), 'closes', to_char(w.closes, 'HH24:MI'))
                                 order by w.weekday, w.opens)
                               from public.working_hours w where w.tenant_id = t.id), '[]'::jsonb),
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'day', e.day, 'closed', e.closed,
                              'opens', to_char(e.opens, 'HH24:MI'), 'closes', to_char(e.closes, 'HH24:MI'), 'note', e.note)
                              order by e.day)
                            from public.schedule_exceptions e
                            where e.tenant_id = t.id and e.day >= app.local_today(t.timezone) - 7), '[]'::jsonb),
    'info_cards', coalesce((select jsonb_agg(to_jsonb(c) order by c.position)
                            from public.info_cards c where c.tenant_id = t.id), '[]'::jsonb),
    'gallery', coalesce((select jsonb_agg(to_jsonb(g) order by g.sort, g.created_at)
                         from public.gallery_items g where g.tenant_id = t.id and g.removed_at is null), '[]'::jsonb),
    'blocks', coalesce((select jsonb_agg(to_jsonb(rb) order by rb.starts_at)
                        from public.resource_blocks rb
                        where rb.tenant_id = t.id and rb.removed_at is null and rb.ends_at > now() - interval '1 day'),
                       '[]'::jsonb)
  );
end;
$$;

-- Bookings in an absolute time range, with money received per booking.
create or replace function public.owner_bookings(p_slug text, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  t public.tenants;
begin
  select * into t from public.tenants where slug = p_slug;
  if not found or not app.is_member(t.id) then
    perform app.fail('forbidden', 'Нет доступа к этой студии');
  end if;
  if p_to <= p_from or p_to - p_from > interval '62 days' then
    perform app.fail('invalid_range', 'Диапазон до двух месяцев');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'status', b.status, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
      'occupied_until', b.occupied_until,
      'service_id', b.service_id, 'service_name', b.service_name, 'resource_id', b.resource_id,
      'resource_name', r.name, 'price_cents', b.price_cents, 'price_is_from', b.price_is_from,
      'client_name', b.client_name, 'client_phone', b.client_phone, 'car', b.car, 'comment', b.comment,
      'source', b.source, 'is_demo', b.is_demo, 'created_at', b.created_at,
      'arrived_at', b.arrived_at, 'completed_at', b.completed_at, 'cancelled_at', b.cancelled_at,
      'cancelled_by', b.cancelled_by, 'cancel_reason', b.cancel_reason,
      'paid_cents', coalesce(p.paid, 0), 'refunded_cents', coalesce(p.refunded, 0)
    ) order by b.starts_at)
    from public.bookings b
    join public.resources r on r.tenant_id = b.tenant_id and r.id = b.resource_id
    left join lateral (
      select sum(amount_cents) filter (where kind = 'payment') as paid,
             sum(amount_cents) filter (where kind = 'refund') as refunded
      from public.payments pm where pm.tenant_id = b.tenant_id and pm.booking_id = b.id
    ) p on true
    where b.tenant_id = t.id
      and b.starts_at < p_to and b.occupied_until > p_from
  ), '[]'::jsonb);
end;
$$;

create or replace function public.owner_booking_payments(p_slug text, p_booking_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  t public.tenants;
begin
  select * into t from public.tenants where slug = p_slug;
  if not found or not app.is_member(t.id) then
    perform app.fail('forbidden', 'Нет доступа к этой студии');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'amount_cents', p.amount_cents,
                                        'method', p.method, 'note', p.note, 'created_at', p.created_at)
                     order by p.created_at)
    from public.payments p where p.tenant_id = t.id and p.booking_id = p_booking_id
  ), '[]'::jsonb);
end;
$$;

-- Statistics computed in SQL. Visits, completed orders and money received are separate numbers;
-- the value of future bookings is reported as "expected", never as revenue.
create or replace function app.stats(p_tenant_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  t public.tenants;
  lo timestamptz;
  hi timestamptz;
  res jsonb;
begin
  select * into t from public.tenants where id = p_tenant_id;
  lo := app.local_to_ts(p_from, '00:00', t.timezone);
  hi := app.local_to_ts(p_to + 1, '00:00', t.timezone);
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'timezone', t.timezone, 'currency', t.currency,
    'visits', (select count(*) from public.bookings b
               where b.tenant_id = t.id and b.status in ('arrived', 'completed')
                 and b.starts_at >= lo and b.starts_at < hi),
    'completed_orders', (select count(*) from public.bookings b
               where b.tenant_id = t.id and b.status = 'completed'
                 and b.completed_at >= lo and b.completed_at < hi),
    'bookings_total', (select count(*) from public.bookings b
               where b.tenant_id = t.id and b.status <> 'cancelled'
                 and b.starts_at >= lo and b.starts_at < hi),
    'cancelled', (select count(*) from public.bookings b
               where b.tenant_id = t.id and b.status = 'cancelled'
                 and b.starts_at >= lo and b.starts_at < hi),
    'no_show', (select count(*) from public.bookings b
               where b.tenant_id = t.id and b.status = 'no_show'
                 and b.starts_at >= lo and b.starts_at < hi),
    'received_cents', (select coalesce(sum(case when p.kind = 'payment' then p.amount_cents else -p.amount_cents end), 0)
               from public.payments p where p.tenant_id = t.id and p.created_at >= lo and p.created_at < hi),
    'payments_cents', (select coalesce(sum(p.amount_cents), 0)
               from public.payments p where p.tenant_id = t.id and p.kind = 'payment' and p.created_at >= lo and p.created_at < hi),
    'refunds_cents', (select coalesce(sum(p.amount_cents), 0)
               from public.payments p where p.tenant_id = t.id and p.kind = 'refund' and p.created_at >= lo and p.created_at < hi),
    'expected_cents', (select coalesce(sum(b.price_cents), 0) from public.bookings b
               where b.tenant_id = t.id and b.status = 'confirmed'
                 and b.starts_at >= greatest(lo, now()) and b.starts_at < hi),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object(
                  'day', d.day,
                  'visits', (select count(*) from public.bookings b
                             where b.tenant_id = t.id and b.status in ('arrived', 'completed')
                               and b.starts_at >= app.local_to_ts(d.day, '00:00', t.timezone)
                               and b.starts_at < app.local_to_ts(d.day + 1, '00:00', t.timezone)),
                  'received_cents', (select coalesce(sum(case when p.kind = 'payment' then p.amount_cents else -p.amount_cents end), 0)
                             from public.payments p where p.tenant_id = t.id
                               and p.created_at >= app.local_to_ts(d.day, '00:00', t.timezone)
                               and p.created_at < app.local_to_ts(d.day + 1, '00:00', t.timezone))
                ) order by d.day), '[]'::jsonb)
               from (select generate_series(p_from, least(p_to, p_from + 92), interval '1 day')::date as day) d)
  ) into res;
  return res;
end;
$$;

create or replace function public.owner_stats(p_slug text, p_period text default null, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  t public.tenants;
  f date;
  tt date;
  lbl text;
begin
  select * into t from public.tenants where slug = p_slug;
  if not found or not app.is_member(t.id) then
    perform app.fail('forbidden', 'Нет доступа к этой студии');
  end if;
  if p_period is not null then
    select pd.from_day, pd.to_day, pd.label into f, tt, lbl from app.period_days(p_period, t.timezone) pd;
  else
    f := p_from; tt := p_to; lbl := 'Период';
    if f is null or tt is null or tt < f or tt - f > 366 then
      perform app.fail('invalid_range', 'Неверный период');
    end if;
  end if;
  return app.stats(t.id, f, tt) || jsonb_build_object('label', lbl, 'period', p_period);
end;
$$;

-- ---------------------------------------------------------------- booking writes

create or replace function public.owner_create_booking(
  p_slug text, p_service_id uuid, p_starts_at timestamptz, p_client_name text, p_client_phone text,
  p_car text, p_comment text, p_resource_id uuid, p_idempotency_key text, p_allow_off_grid boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
  res jsonb;
begin
  res := app.create_booking(t, p_service_id, p_starts_at, p_client_name, p_client_phone, p_car, p_comment,
                            p_idempotency_key, 'owner', p_resource_id, coalesce(p_allow_off_grid, false));
  return res - 'token';
end;
$$;

create or replace function public.owner_reschedule_booking(
  p_slug text, p_booking_id uuid, p_new_start timestamptz, p_resource_id uuid default null,
  p_allow_off_grid boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
  b public.bookings;
begin
  b := app.reschedule_booking(t.id, p_booking_id, p_new_start, p_resource_id, coalesce(p_allow_off_grid, false));
  return app.booking_json(b);
end;
$$;

create or replace function public.owner_cancel_booking(p_slug text, p_booking_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
  b public.bookings;
begin
  b := app.cancel_booking(t.id, p_booking_id, 'owner', p_reason);
  return app.booking_json(b);
end;
$$;

-- Status flow: confirmed -> arrived -> completed; confirmed -> no_show; arrived -> confirmed (undo).
create or replace function public.owner_set_booking_status(p_slug text, p_booking_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id and tenant_id = t.id for update;
  if not found then
    perform app.fail('booking_not_found', 'Запись не найдена');
  end if;
  if b.status = p_status then
    return app.booking_json(b);
  end if;
  if not ((b.status = 'confirmed' and p_status in ('arrived', 'completed', 'no_show'))
       or (b.status = 'arrived' and p_status in ('completed', 'confirmed'))
       or (b.status = 'completed' and p_status = 'arrived')) then
    perform app.fail('invalid_transition', format('Нельзя перевести запись из «%s» в «%s»', b.status, p_status));
  end if;

  update public.bookings
     set status = p_status,
         arrived_at = case when p_status in ('arrived', 'completed') then coalesce(arrived_at, now())
                           when p_status = 'confirmed' then null else arrived_at end,
         completed_at = case when p_status = 'completed' then now() when p_status = 'arrived' then null else completed_at end
   where id = b.id
  returning * into b;

  if p_status = 'no_show' then
    update public.resource_occupancies set released_at = now() where booking_id = b.id and released_at is null;
    perform app.cancel_reminders(b.id);
  elsif p_status = 'completed' then
    -- The car is ready: free the rest of the occupied range.
    update public.resource_occupancies
       set during = tstzrange(lower(during), greatest(now(), lower(during) + interval '1 minute'), '[)')
     where booking_id = b.id and released_at is null and upper(during) > now();
    perform app.cancel_reminders(b.id);
  end if;
  return app.booking_json(b);
end;
$$;

create or replace function public.owner_add_payment(
  p_slug text, p_booking_id uuid, p_kind text, p_amount_cents bigint, p_method text,
  p_note text, p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
  b public.bookings;
  paid bigint;
  refunded bigint;
  p public.payments;
begin
  if p_kind not in ('payment', 'refund') then
    perform app.fail('invalid_request', 'kind');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000 then
    perform app.fail('invalid_amount', 'Сумма должна быть больше нуля');
  end if;
  select * into p from public.payments where tenant_id = t.id and idempotency_key = p_idempotency_key;
  if found then
    return to_jsonb(p);
  end if;
  -- Serialise money operations per booking.
  select * into b from public.bookings where id = p_booking_id and tenant_id = t.id for update;
  if not found then
    perform app.fail('booking_not_found', 'Запись не найдена');
  end if;
  select coalesce(sum(amount_cents) filter (where kind = 'payment'), 0),
         coalesce(sum(amount_cents) filter (where kind = 'refund'), 0)
    into paid, refunded
    from public.payments where tenant_id = t.id and booking_id = b.id;
  if p_kind = 'refund' and p_amount_cents > paid - refunded then
    perform app.fail('refund_exceeds_paid', 'Возврат больше полученной суммы');
  end if;
  insert into public.payments(tenant_id, booking_id, kind, amount_cents, method, note, idempotency_key, created_by)
  values (t.id, b.id, p_kind, p_amount_cents, p_method, left(btrim(coalesce(p_note, '')), 200),
          p_idempotency_key, app.current_user_id())
  returning * into p;
  return to_jsonb(p);
end;
$$;

-- ---------------------------------------------------------------- resource blocks

create or replace function public.owner_block_resource(
  p_slug text, p_resource_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
  blk public.resource_blocks;
begin
  if not exists (select 1 from public.resources r where r.id = p_resource_id and r.tenant_id = t.id) then
    perform app.fail('resource_not_found', 'Пост не найден');
  end if;
  if p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '60 days' then
    perform app.fail('invalid_range', 'Проверьте период блокировки');
  end if;
  insert into public.resource_blocks(tenant_id, resource_id, starts_at, ends_at, reason, created_by)
  values (t.id, p_resource_id, p_starts_at, p_ends_at, left(btrim(coalesce(p_reason, '')), 200), app.current_user_id())
  returning * into blk;
  begin
    insert into public.resource_occupancies(tenant_id, resource_id, kind, block_id, during)
    values (t.id, p_resource_id, 'block', blk.id, tstzrange(p_starts_at, p_ends_at, '[)'));
  exception when exclusion_violation then
    perform app.fail('slot_taken', 'На это время на посту уже есть записи. Перенесите их или выберите другой период.');
  end;
  return to_jsonb(blk);
end;
$$;

create or replace function public.owner_remove_block(p_slug text, p_block_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
begin
  update public.resource_blocks set removed_at = now()
   where id = p_block_id and tenant_id = t.id and removed_at is null;
  update public.resource_occupancies set released_at = now()
   where block_id = p_block_id and tenant_id = t.id and released_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- settings writes

create or replace function app.assert_media_path(p_tenant_id uuid, p_path text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_path is not null and p_path !~ ('^' || p_tenant_id::text || '/[A-Za-z0-9._/-]{1,200}$') then
    perform app.fail('invalid_media_path', 'Файл должен лежать в папке студии');
  end if;
end;
$$;

create or replace function public.owner_update_tenant(p_slug text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
  k text;
  allowed text[] := array['name', 'short_name', 'tagline', 'description', 'address', 'map_url', 'phone',
                          'messenger_url', 'cancellation_policy', 'cancel_cutoff_hours', 'min_lead_minutes',
                          'max_days_ahead', 'logo_path', 'hero_path'];
begin
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any(allowed)) then
      perform app.fail('invalid_field', k);
    end if;
  end loop;
  if p_patch ? 'logo_path' then perform app.assert_media_path(t.id, p_patch ->> 'logo_path'); end if;
  if p_patch ? 'hero_path' then perform app.assert_media_path(t.id, p_patch ->> 'hero_path'); end if;
  update public.tenants set
    name = coalesce(p_patch ->> 'name', name),
    short_name = coalesce(p_patch ->> 'short_name', short_name),
    tagline = coalesce(p_patch ->> 'tagline', tagline),
    description = coalesce(p_patch ->> 'description', description),
    address = coalesce(p_patch ->> 'address', address),
    map_url = case when p_patch ? 'map_url' then nullif(p_patch ->> 'map_url', '') else map_url end,
    phone = coalesce(p_patch ->> 'phone', phone),
    messenger_url = case when p_patch ? 'messenger_url' then nullif(p_patch ->> 'messenger_url', '') else messenger_url end,
    cancellation_policy = coalesce(p_patch ->> 'cancellation_policy', cancellation_policy),
    cancel_cutoff_hours = coalesce((p_patch ->> 'cancel_cutoff_hours')::int, cancel_cutoff_hours),
    min_lead_minutes = coalesce((p_patch ->> 'min_lead_minutes')::int, min_lead_minutes),
    max_days_ahead = coalesce((p_patch ->> 'max_days_ahead')::int, max_days_ahead),
    logo_path = case when p_patch ? 'logo_path' then p_patch ->> 'logo_path' else logo_path end,
    hero_path = case when p_patch ? 'hero_path' then p_patch ->> 'hero_path' else hero_path end,
    owner_updated_at = now()
  where id = t.id
  returning * into t;
  return to_jsonb(t) - 'config_hash';
end;
$$;

-- Replace the weekly schedule. p_hours: [{"weekday":1,"opens":"09:00","closes":"21:00"}, ...]
create or replace function public.owner_set_working_hours(p_slug text, p_hours jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
  h jsonb;
begin
  if jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) > 21 then
    perform app.fail('invalid_hours', 'Неверный формат расписания');
  end if;
  delete from public.working_hours where tenant_id = t.id;
  for h in select * from jsonb_array_elements(p_hours) loop
    if (h ->> 'closes')::time <= (h ->> 'opens')::time then
      perform app.fail('invalid_hours', 'Время закрытия должно быть позже открытия');
    end if;
    insert into public.working_hours(tenant_id, weekday, opens, closes)
    values (t.id, (h ->> 'weekday')::smallint, (h ->> 'opens')::time, (h ->> 'closes')::time);
  end loop;
  update public.tenants set owner_updated_at = now() where id = t.id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.owner_upsert_exception(
  p_slug text, p_day date, p_closed boolean, p_opens time, p_closes time, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
begin
  delete from public.schedule_exceptions where tenant_id = t.id and day = p_day;
  insert into public.schedule_exceptions(tenant_id, day, closed, opens, closes, note)
  values (t.id, p_day, p_closed, case when p_closed then null else p_opens end,
          case when p_closed then null else p_closes end, left(btrim(coalesce(p_note, '')), 120));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.owner_delete_exception(p_slug text, p_day date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
begin
  delete from public.schedule_exceptions where tenant_id = t.id and day = p_day;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.owner_upsert_resource(p_slug text, p_resource_id uuid, p_name text, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
  r public.resources;
begin
  if p_resource_id is null then
    insert into public.resources(tenant_id, key, name, active, sort, source, owner_updated_at)
    values (t.id, 'own-' || substr(md5(random()::text), 1, 10), btrim(p_name), coalesce(p_active, true),
            (select coalesce(max(sort), 0) + 1 from public.resources where tenant_id = t.id), 'owner', now())
    returning * into r;
  else
    update public.resources
       set name = coalesce(nullif(btrim(p_name), ''), name), active = coalesce(p_active, active), owner_updated_at = now()
     where id = p_resource_id and tenant_id = t.id
    returning * into r;
    if not found then
      perform app.fail('resource_not_found', 'Пост не найден');
    end if;
  end if;
  return to_jsonb(r);
end;
$$;

-- Create or update a service. Changing the price never touches existing bookings (they keep their snapshot).
create or replace function public.owner_upsert_service(
  p_slug text, p_service_id uuid, p_fields jsonb, p_resource_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
  s public.services;
  r uuid;
begin
  if p_fields ? 'image_path' then perform app.assert_media_path(t.id, p_fields ->> 'image_path'); end if;
  if p_service_id is null then
    insert into public.services(tenant_id, key, name, description, category, duration_minutes, buffer_minutes,
                                price_cents, price_is_from, image_path, active, sort, source, owner_updated_at)
    values (t.id, 'own-' || substr(md5(random()::text), 1, 10),
            btrim(p_fields ->> 'name'), coalesce(p_fields ->> 'description', ''), coalesce(p_fields ->> 'category', ''),
            (p_fields ->> 'duration_minutes')::int, coalesce((p_fields ->> 'buffer_minutes')::int, 0),
            (p_fields ->> 'price_cents')::bigint, coalesce((p_fields ->> 'price_is_from')::boolean, false),
            p_fields ->> 'image_path', coalesce((p_fields ->> 'active')::boolean, true),
            (select coalesce(max(sort), 0) + 1 from public.services where tenant_id = t.id), 'owner', now())
    returning * into s;
  else
    update public.services set
      name = coalesce(nullif(btrim(p_fields ->> 'name'), ''), name),
      description = coalesce(p_fields ->> 'description', description),
      category = coalesce(p_fields ->> 'category', category),
      duration_minutes = coalesce((p_fields ->> 'duration_minutes')::int, duration_minutes),
      buffer_minutes = coalesce((p_fields ->> 'buffer_minutes')::int, buffer_minutes),
      price_cents = coalesce((p_fields ->> 'price_cents')::bigint, price_cents),
      price_is_from = coalesce((p_fields ->> 'price_is_from')::boolean, price_is_from),
      image_path = case when p_fields ? 'image_path' then p_fields ->> 'image_path' else image_path end,
      active = coalesce((p_fields ->> 'active')::boolean, active),
      owner_updated_at = now()
    where id = p_service_id and tenant_id = t.id
    returning * into s;
    if not found then
      perform app.fail('service_not_found', 'Услуга не найдена');
    end if;
  end if;
  if p_resource_ids is not null then
    delete from public.service_resources where tenant_id = t.id and service_id = s.id;
    foreach r in array p_resource_ids loop
      insert into public.service_resources(tenant_id, service_id, resource_id) values (t.id, s.id, r);
    end loop;
  end if;
  return to_jsonb(s);
end;
$$;

create or replace function public.owner_update_info_card(p_slug text, p_position int, p_icon text, p_title text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
  c public.info_cards;
begin
  insert into public.info_cards(tenant_id, position, icon, title, body, source, owner_updated_at)
  values (t.id, p_position, coalesce(nullif(p_icon, ''), 'Sparkle'), btrim(p_title), btrim(coalesce(p_body, '')), 'owner', now())
  on conflict (tenant_id, position) do update
    set icon = excluded.icon, title = excluded.title, body = excluded.body, source = 'owner', owner_updated_at = now()
  returning * into c;
  return to_jsonb(c);
end;
$$;

-- Gallery: add a card, replace one photo, or edit one caption. Other cards are never touched.
create or replace function public.owner_add_gallery_item(p_slug text, p_image_path text, p_caption text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
  g public.gallery_items;
begin
  perform app.assert_media_path(t.id, p_image_path);
  if (select count(*) from public.gallery_items where tenant_id = t.id and removed_at is null) >= 40 then
    perform app.fail('gallery_full', 'В галерее уже 40 работ');
  end if;
  insert into public.gallery_items(tenant_id, image_path, caption, sort, source, owner_updated_at)
  values (t.id, p_image_path, left(btrim(coalesce(p_caption, '')), 120),
          (select coalesce(max(sort), 0) + 1 from public.gallery_items where tenant_id = t.id), 'owner', now())
  returning * into g;
  return to_jsonb(g);
end;
$$;

create or replace function public.owner_update_gallery_item(p_slug text, p_item_id uuid, p_image_path text, p_caption text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
  g public.gallery_items;
begin
  if p_image_path is not null then
    perform app.assert_media_path(t.id, p_image_path);
  end if;
  update public.gallery_items
     set image_path = coalesce(p_image_path, image_path),
         caption = coalesce(left(btrim(p_caption), 120), caption),
         source = 'owner', owner_updated_at = now()
   where id = p_item_id and tenant_id = t.id and removed_at is null
  returning * into g;
  if not found then
    perform app.fail('gallery_item_not_found', 'Карточка не найдена');
  end if;
  return to_jsonb(g);
end;
$$;

create or replace function public.owner_remove_gallery_item(p_slug text, p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
begin
  update public.gallery_items set removed_at = now(), source = 'owner', owner_updated_at = now()
   where id = p_item_id and tenant_id = t.id and removed_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.owner_save_push(p_slug text, p_endpoint text, p_p256dh text, p_auth text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants := app.require_member(p_slug);
begin
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000 then
    perform app.fail('invalid_subscription', 'Некорректная подписка');
  end if;
  insert into public.push_subscriptions(tenant_id, user_id, endpoint, p256dh, auth)
  values (t.id, app.current_user_id(), p_endpoint, p_p256dh, p_auth)
  on conflict (tenant_id, user_id, endpoint) where user_id is not null
  do update set p256dh = excluded.p256dh, auth = excluded.auth, disabled_at = null;
  return jsonb_build_object('saved', true, 'delivers', t.status = 'live');
end;
$$;
