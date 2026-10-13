-- Tenant pipeline (called by scripts/tenant/*.ts with the database owner role).
-- business.json is the input; the database is the runtime source. Re-publishing never touches
-- bookings, payments, owner-uploaded photos or anything the owner changed in the cabinet
-- (unless --force is passed, and even then bookings/payments/owner photos are kept).

create or replace function app.ensure_tenant(p_slug text, p_name text, p_short_name text, p_timezone text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  tid uuid;
begin
  select id into tid from public.tenants where slug = p_slug;
  if tid is null then
    insert into public.tenants(slug, name, short_name, timezone, status)
    values (p_slug, p_name, p_short_name, p_timezone, 'preview')
    returning id into tid;
  end if;
  return tid;
end;
$$;

create or replace function app.publish_tenant(p_config jsonb, p_media jsonb, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  kept text[] := '{}';
  deactivated text[] := '{}';
  r jsonb;
  s jsonb;
  g jsonb;
  c jsonb;
  h jsonb;
  e jsonb;
  sid uuid;
  rid uuid;
  existing record;
  rk text;
  pos int;
  hash text := md5(p_config::text || coalesce(p_media::text, ''));
  owner_touched boolean;
begin
  select * into t from public.tenants where slug = p_config ->> 'slug' for update;
  if not found then
    perform app.fail('tenant_not_found', 'call app.ensure_tenant first');
  end if;

  -- Tenant profile and schedule ------------------------------------------------------------
  owner_touched := t.owner_updated_at is not null and not p_force;
  if owner_touched then
    kept := kept || 'tenant profile and schedule'::text;
  end if;

  update public.tenants set
    -- identity, install metadata and booking rules always follow the config
    timezone = p_config ->> 'timezone',
    currency = p_config ->> 'currency',
    locale = p_config ->> 'locale',
    accent_color = p_config ->> 'accent_color',
    slot_step_minutes = (p_config #>> '{booking,slot_step_minutes}')::int,
    -- owner-editable fields only when the owner has not changed them
    name = case when owner_touched then name else p_config ->> 'name' end,
    short_name = case when owner_touched then short_name else p_config ->> 'short_name' end,
    tagline = case when owner_touched then tagline else coalesce(p_config ->> 'tagline', '') end,
    description = case when owner_touched then description else coalesce(p_config ->> 'description', '') end,
    address = case when owner_touched then address else p_config ->> 'address' end,
    map_url = case when owner_touched then map_url else p_config ->> 'map_url' end,
    phone = case when owner_touched then phone else p_config ->> 'phone' end,
    messenger_url = case when owner_touched then messenger_url else p_config ->> 'messenger_url' end,
    min_lead_minutes = case when owner_touched then min_lead_minutes else (p_config #>> '{booking,min_lead_minutes}')::int end,
    max_days_ahead = case when owner_touched then max_days_ahead else (p_config #>> '{booking,max_days_ahead}')::int end,
    cancel_cutoff_hours = case when owner_touched then cancel_cutoff_hours else (p_config #>> '{booking,cancel_cutoff_hours}')::int end,
    cancellation_policy = case when owner_touched then cancellation_policy else coalesce(p_config #>> '{booking,cancellation_policy}', '') end,
    logo_path = case when owner_touched and logo_path is not null then logo_path else p_media ->> 'logo' end,
    hero_path = case when owner_touched and hero_path is not null then hero_path else p_media ->> 'hero' end,
    owner_updated_at = case when p_force then null else owner_updated_at end,
    config_version = config_version + 1,
    config_hash = hash,
    published_at = now()
  where id = t.id
  returning * into t;

  if not owner_touched then
    delete from public.working_hours where tenant_id = t.id;
    for h in select * from jsonb_array_elements(p_config -> 'working_hours') loop
      insert into public.working_hours(tenant_id, weekday, opens, closes)
      values (t.id, (h ->> 'weekday')::smallint, (h ->> 'opens')::time, (h ->> 'closes')::time);
    end loop;
    delete from public.schedule_exceptions where tenant_id = t.id;
    for e in select * from jsonb_array_elements(coalesce(p_config -> 'exceptions', '[]')) loop
      insert into public.schedule_exceptions(tenant_id, day, closed, opens, closes, note)
      values (t.id, (e ->> 'day')::date, coalesce((e ->> 'closed')::boolean, true),
              (e ->> 'opens')::time, (e ->> 'closes')::time, coalesce(e ->> 'note', ''));
    end loop;
  end if;

  -- Resources --------------------------------------------------------------------------------
  pos := 0;
  for r in select * from jsonb_array_elements(p_config -> 'resources') loop
    pos := pos + 1;
    select * into existing from public.resources where tenant_id = t.id and key = r ->> 'key';
    if not found then
      insert into public.resources(tenant_id, key, name, sort, source)
      values (t.id, r ->> 'key', r ->> 'name', pos, 'config');
    elsif existing.owner_updated_at is not null and not p_force then
      kept := kept || ('resource ' || (r ->> 'key'));
    else
      update public.resources set name = r ->> 'name', sort = pos, active = true, owner_updated_at = null
       where id = existing.id;
    end if;
  end loop;
  for existing in
    select * from public.resources
    where tenant_id = t.id and source = 'config' and active
      and not (key in (select x ->> 'key' from jsonb_array_elements(p_config -> 'resources') x))
  loop
    update public.resources set active = false where id = existing.id;
    deactivated := deactivated || ('resource ' || existing.key);
  end loop;

  -- Services ---------------------------------------------------------------------------------
  pos := 0;
  for s in select * from jsonb_array_elements(p_config -> 'services') loop
    pos := pos + 1;
    select * into existing from public.services where tenant_id = t.id and key = s ->> 'key';
    if not found then
      insert into public.services(tenant_id, key, name, description, category, duration_minutes, buffer_minutes,
                                  price_cents, price_is_from, image_path, sort, source)
      values (t.id, s ->> 'key', s ->> 'name', coalesce(s ->> 'description', ''), coalesce(s ->> 'category', ''),
              (s ->> 'duration_minutes')::int, coalesce((s ->> 'buffer_minutes')::int, 0),
              (s ->> 'price_cents')::bigint, coalesce((s ->> 'price_is_from')::boolean, false),
              p_media #>> array['services', s ->> 'key'], pos, 'config')
      returning id into sid;
    elsif existing.owner_updated_at is not null and not p_force then
      kept := kept || ('service ' || (s ->> 'key'));
      continue;
    else
      update public.services set
        name = s ->> 'name', description = coalesce(s ->> 'description', ''), category = coalesce(s ->> 'category', ''),
        duration_minutes = (s ->> 'duration_minutes')::int, buffer_minutes = coalesce((s ->> 'buffer_minutes')::int, 0),
        price_cents = (s ->> 'price_cents')::bigint, price_is_from = coalesce((s ->> 'price_is_from')::boolean, false),
        image_path = coalesce(p_media #>> array['services', s ->> 'key'], image_path),
        sort = pos, active = true, owner_updated_at = null
      where id = existing.id
      returning id into sid;
    end if;
    delete from public.service_resources where tenant_id = t.id and service_id = sid;
    for rk in select jsonb_array_elements_text(s -> 'resources') loop
      select id into rid from public.resources where tenant_id = t.id and key = rk;
      if rid is null then
        perform app.fail('unknown_resource', rk);
      end if;
      insert into public.service_resources(tenant_id, service_id, resource_id) values (t.id, sid, rid);
    end loop;
  end loop;
  for existing in
    select * from public.services
    where tenant_id = t.id and source = 'config' and active
      and not (key in (select x ->> 'key' from jsonb_array_elements(p_config -> 'services') x))
  loop
    update public.services set active = false where id = existing.id;
    deactivated := deactivated || ('service ' || existing.key);
  end loop;

  -- Info cards (owner-edited cards are kept) -------------------------------------------------
  pos := 0;
  for c in select * from jsonb_array_elements(coalesce(p_config -> 'info_cards', '[]')) loop
    pos := pos + 1;
    insert into public.info_cards(tenant_id, position, icon, title, body, source)
    values (t.id, pos, c ->> 'icon', c ->> 'title', coalesce(c ->> 'body', ''), 'config')
    on conflict (tenant_id, position) do update
      set icon = excluded.icon, title = excluded.title, body = excluded.body
      where public.info_cards.source = 'config' or p_force;
  end loop;

  -- Gallery: config items by key; owner items and owner-edited config items are kept ---------
  pos := 0;
  for g in select * from jsonb_array_elements(coalesce(p_config -> 'gallery', '[]')) loop
    pos := pos + 1;
    -- a photo without an uploaded file (e.g. SQL-only seed) is added on the next publish with media
    continue when p_media #>> array['gallery', g ->> 'key'] is null;
    insert into public.gallery_items(tenant_id, config_key, image_path, caption, sort, source)
    values (t.id, g ->> 'key', p_media #>> array['gallery', g ->> 'key'], coalesce(g ->> 'caption', ''), pos, 'config')
    on conflict (tenant_id, config_key) do update
      set image_path = excluded.image_path, caption = excluded.caption, sort = excluded.sort
      where public.gallery_items.source = 'config';
  end loop;

  return jsonb_build_object(
    'tenant_id', t.id, 'slug', t.slug, 'status', t.status, 'config_version', t.config_version,
    'kept_owner_changes', to_jsonb(kept), 'deactivated', to_jsonb(deactivated));
end;
$$;

create or replace function app.add_member(p_tenant_id uuid, p_user_id uuid, p_role text default 'owner')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.tenant_members(tenant_id, user_id, role) values (p_tenant_id, p_user_id, p_role)
  on conflict (tenant_id, user_id) do update set role = excluded.role
$$;

-- Readiness checks for going live. Returns a list of problems (empty = ready).
create or replace function app.tenant_readiness(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  problems text[] := '{}';
begin
  select * into t from public.tenants where slug = p_slug;
  if not found then
    return jsonb_build_array('Студия не опубликована');
  end if;
  if char_length(t.phone) < 6 then problems := problems || 'Не указан телефон'::text; end if;
  if char_length(t.address) < 5 then problems := problems || 'Не указан адрес'::text; end if;
  if t.hero_path is null then problems := problems || 'Нет главного фото'::text; end if;
  if not exists (select 1 from public.working_hours where tenant_id = t.id) then
    problems := problems || 'Не заданы часы работы'::text;
  end if;
  if not exists (
    select 1 from public.services s where s.tenant_id = t.id and s.active
      and cardinality(app.service_resource_ids(t.id, s.id)) > 0
  ) then
    problems := problems || 'Нет активных услуг с постами'::text;
  end if;
  if exists (
    select 1 from public.services s where s.tenant_id = t.id and s.active and s.price_cents = 0
  ) then
    problems := problems || 'Есть услуги с нулевой ценой'::text;
  end if;
  if not exists (select 1 from public.tenant_members where tenant_id = t.id) then
    problems := problems || 'Нет владельца с доступом в кабинет'::text;
  end if;
  return to_jsonb(problems);
end;
$$;

-- Switch a verified tenant to live: demo bookings are removed, real notifications start.
create or replace function app.activate_tenant(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  problems jsonb;
  removed int;
begin
  problems := app.tenant_readiness(p_slug);
  if jsonb_array_length(problems) > 0 then
    return jsonb_build_object('activated', false, 'problems', problems);
  end if;
  select * into t from public.tenants where slug = p_slug for update;
  delete from public.bookings where tenant_id = t.id and is_demo;
  get diagnostics removed = row_count;
  update public.tenants set status = 'live', activated_at = coalesce(activated_at, now()) where id = t.id;
  return jsonb_build_object('activated', true, 'demo_bookings_removed', removed);
end;
$$;
