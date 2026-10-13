-- Public (anonymous) API. Only these functions are executable by anon; no table is readable by anon.

create or replace function public.get_tenant_public(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := app.public_tenant(p_slug);
  return jsonb_build_object(
    'id', t.id,
    'slug', t.slug,
    'status', t.status,
    'name', t.name,
    'short_name', t.short_name,
    'tagline', t.tagline,
    'description', t.description,
    'address', t.address,
    'map_url', t.map_url,
    'phone', t.phone,
    'messenger_url', t.messenger_url,
    'timezone', t.timezone,
    'currency', t.currency,
    'locale', t.locale,
    'accent_color', t.accent_color,
    'logo_path', t.logo_path,
    'hero_path', t.hero_path,
    'slot_step_minutes', t.slot_step_minutes,
    'max_days_ahead', t.max_days_ahead,
    'cancel_cutoff_hours', t.cancel_cutoff_hours,
    'cancellation_policy', t.cancellation_policy,
    'today', app.local_today(t.timezone),
    'resources_count', (select count(*) from public.resources r where r.tenant_id = t.id and r.active),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'key', s.key, 'name', s.name, 'description', s.description, 'category', s.category,
        'duration_minutes', s.duration_minutes, 'price_cents', s.price_cents, 'price_is_from', s.price_is_from,
        'image_path', s.image_path
      ) order by s.sort, s.name)
      from public.services s
      where s.tenant_id = t.id and s.active and cardinality(app.service_resource_ids(t.id, s.id)) > 0
    ), '[]'::jsonb),
    'info_cards', coalesce((
      select jsonb_agg(jsonb_build_object('position', c.position, 'icon', c.icon, 'title', c.title, 'body', c.body)
                       order by c.position)
      from public.info_cards c where c.tenant_id = t.id
    ), '[]'::jsonb),
    'gallery', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'image_path', g.image_path, 'caption', g.caption)
                       order by g.sort, g.created_at)
      from public.gallery_items g where g.tenant_id = t.id and g.removed_at is null
    ), '[]'::jsonb),
    'working_hours', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', w.weekday, 'opens', to_char(w.opens, 'HH24:MI'),
                                          'closes', to_char(w.closes, 'HH24:MI')) order by w.weekday, w.opens)
      from public.working_hours w where w.tenant_id = t.id
    ), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object('day', e.day, 'closed', e.closed,
                                          'opens', to_char(e.opens, 'HH24:MI'), 'closes', to_char(e.closes, 'HH24:MI'),
                                          'note', e.note) order by e.day, e.opens)
      from public.schedule_exceptions e
      where e.tenant_id = t.id and e.day between app.local_today(t.timezone) and app.local_today(t.timezone) + 60
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_availability(p_slug text, p_service_id uuid, p_from date, p_to date)
returns table (starts_at timestamptz, local_day date, local_time text, available boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := app.public_tenant(p_slug);
  perform app.enforce_rate_limit('avail:' || app.client_key(), 240, 60);
  if p_to < p_from or p_to - p_from > 14 then
    perform app.fail('invalid_range', 'Диапазон не больше двух недель');
  end if;
  return query
    select a.starts_at, a.local_day, to_char(a.local_time, 'HH24:MI'), a.available
    from app.availability(t.id, p_service_id, p_from, p_to) a;
end;
$$;

create or replace function public.get_nearest_slots(p_slug text, p_service_id uuid, p_limit int default 5)
returns table (starts_at timestamptz, local_day date, local_time text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := app.public_tenant(p_slug);
  perform app.enforce_rate_limit('avail:' || app.client_key(), 240, 60);
  if not exists (select 1 from public.services s where s.id = p_service_id and s.tenant_id = t.id and s.active) then
    perform app.fail('service_not_found', 'Услуга не найдена');
  end if;
  return query
    select n.starts_at, n.local_day, to_char(n.local_time, 'HH24:MI')
    from app.nearest_slots(t.id, p_service_id, least(greatest(coalesce(p_limit, 5), 1), 20)) n;
end;
$$;

create or replace function public.create_booking(
  p_slug text,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_client_name text,
  p_client_phone text,
  p_car text,
  p_comment text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := app.public_tenant(p_slug);
  -- Replays of an existing idempotency key are answered before rate limiting.
  if exists (select 1 from public.bookings b where b.tenant_id = t.id and b.idempotency_key = btrim(coalesce(p_idempotency_key, ''))) then
    return app.create_booking(t, p_service_id, p_starts_at, p_client_name, p_client_phone, p_car, p_comment,
                              p_idempotency_key, 'client');
  end if;
  perform app.enforce_rate_limit('book:ip:' || app.client_key(), 12, 600);
  perform app.enforce_rate_limit('book:tenant:' || t.id, 400, 3600);
  return app.create_booking(t, p_service_id, p_starts_at, p_client_name, p_client_phone, p_car, p_comment,
                            p_idempotency_key, 'client');
end;
$$;

create or replace function public.get_booking(p_booking_id uuid, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  perform app.enforce_rate_limit('booking-read:' || app.client_key(), 120, 60);
  b := app.booking_by_token(p_booking_id, p_token);
  return app.booking_json(b);
end;
$$;

create or replace function public.cancel_my_booking(p_booking_id uuid, p_token text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  t public.tenants;
begin
  perform app.enforce_rate_limit('booking-write:' || app.client_key(), 30, 600);
  b := app.booking_by_token(p_booking_id, p_token);
  select * into t from public.tenants where id = b.tenant_id;
  if b.status = 'cancelled' then
    return app.booking_json(b);
  end if;
  if not app.can_client_cancel(b, t) then
    if b.status = 'confirmed' then
      perform app.fail('cancel_too_late',
        format('Онлайн-отмена возможна не позднее чем за %s ч. Позвоните в студию: %s', t.cancel_cutoff_hours, t.phone));
    end if;
    perform app.fail('cannot_cancel', 'Эту запись уже нельзя отменить');
  end if;
  b := app.cancel_booking(b.tenant_id, b.id, 'client', p_reason);
  return app.booking_json(b);
end;
$$;

-- Client opts into a reminder for one booking.
create or replace function public.save_booking_push(
  p_booking_id uuid, p_token text, p_endpoint text, p_p256dh text, p_auth text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  t public.tenants;
begin
  perform app.enforce_rate_limit('booking-write:' || app.client_key(), 30, 600);
  b := app.booking_by_token(p_booking_id, p_token);
  select * into t from public.tenants where id = b.tenant_id;
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or char_length(coalesce(p_p256dh, '')) not between 20 and 200
     or char_length(coalesce(p_auth, '')) not between 8 and 100 then
    perform app.fail('invalid_subscription', 'Некорректная подписка');
  end if;
  insert into public.push_subscriptions(tenant_id, booking_id, endpoint, p256dh, auth)
  values (b.tenant_id, b.id, p_endpoint, p_p256dh, p_auth)
  on conflict (booking_id, endpoint) where booking_id is not null
  do update set p256dh = excluded.p256dh, auth = excluded.auth, disabled_at = null;
  return jsonb_build_object(
    'saved', true,
    'delivers', t.status = 'live' and not b.is_demo,
    'reminder_at', case when b.starts_at - interval '24 hours' > now() then b.starts_at - interval '24 hours' end
  );
end;
$$;
