-- Notification outbox processing (called only by the notify-worker edge function with the DB owner role).

create or replace function app.format_local(p_ts timestamptz, p_tz text)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_ts at time zone p_tz, 'DD.MM в HH24:MI')
$$;

-- Lease up to p_limit due jobs. A job whose lease expired (crashed worker) is picked up again.
-- Jobs that no longer match their booking (cancelled, moved, no subscriptions) are closed here.
create or replace function app.claim_notification_jobs(p_worker text, p_limit int default 20, p_lease_seconds int default 120)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.notification_jobs;
  b public.bookings;
  t public.tenants;
  subs jsonb;
  out jsonb := '[]'::jsonb;
  title text;
  body text;
  url text;
begin
  for j in
    with picked as (
      select id from public.notification_jobs
      where (status = 'pending' and due_at <= now())
         or (status = 'processing' and lease_until < now())
      order by due_at
      limit p_limit
      for update skip locked
    )
    update public.notification_jobs nj
       set status = 'processing', lease_until = now() + make_interval(secs => p_lease_seconds),
           locked_by = p_worker, attempts = nj.attempts + 1
      from picked where nj.id = picked.id
    returning nj.*
  loop
    select * into t from public.tenants where id = j.tenant_id;
    select * into b from public.bookings where id = j.booking_id;

    if t.status <> 'live' or b.is_demo then
      update public.notification_jobs set status = 'skipped', last_error = 'preview_or_demo', lease_until = null where id = j.id;
      continue;
    end if;

    if j.kind = 'client_reminder' then
      if b.status <> 'confirmed' or b.starts_at <> (j.payload ->> 'starts_at')::timestamptz then
        update public.notification_jobs set status = 'cancelled', last_error = 'booking_changed', lease_until = null where id = j.id;
        continue;
      end if;
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
        into subs
        from public.push_subscriptions s where s.booking_id = b.id and s.disabled_at is null;
      title := t.short_name || ': напоминание';
      body := format('Ждём вас %s — %s. %s', app.format_local(b.starts_at, t.timezone), b.service_name, t.address);
      url := '/s/' || t.slug || '/my/' || b.id;
    else
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
        into subs
        from public.push_subscriptions s
        join public.tenant_members m on m.tenant_id = s.tenant_id and m.user_id = s.user_id
       where s.tenant_id = t.id and s.user_id is not null and s.disabled_at is null;
      if j.kind = 'owner_new_booking' then
        title := 'Новая запись';
        body := format('%s, %s — %s, %s', app.format_local(b.starts_at, t.timezone), b.service_name, b.client_name, b.car);
      else
        title := 'Клиент отменил запись';
        body := format('%s, %s — %s', app.format_local(b.starts_at, t.timezone), b.service_name, b.client_name);
      end if;
      url := '/s/' || t.slug || '/owner/';
    end if;

    if jsonb_array_length(subs) = 0 then
      update public.notification_jobs set status = 'skipped', last_error = 'no_subscriptions', lease_until = null where id = j.id;
      continue;
    end if;

    out := out || jsonb_build_array(jsonb_build_object(
      'job_id', j.id, 'kind', j.kind, 'attempt', j.attempts,
      'title', title, 'body', body, 'url', url, 'tag', j.dedupe_key,
      'subscriptions', subs));
  end loop;
  return out;
end;
$$;

-- Finish a leased job. Only the worker that holds the lease can finish it.
create or replace function app.complete_notification_job(
  p_job_id bigint, p_worker text, p_ok boolean, p_error text default null, p_gone_subscriptions uuid[] default '{}'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.notification_jobs;
begin
  select * into j from public.notification_jobs where id = p_job_id for update;
  if not found or j.status <> 'processing' or j.locked_by is distinct from p_worker then
    return 'lease_lost';
  end if;
  if cardinality(p_gone_subscriptions) > 0 then
    update public.push_subscriptions set disabled_at = now() where id = any(p_gone_subscriptions);
  end if;
  if p_ok then
    update public.notification_jobs
       set status = 'sent', sent_at = now(), lease_until = null, last_error = p_error
     where id = j.id;
    return 'sent';
  elsif j.attempts >= 5 then
    update public.notification_jobs set status = 'failed', lease_until = null, last_error = p_error where id = j.id;
    return 'failed';
  else
    update public.notification_jobs
       set status = 'pending', lease_until = null, locked_by = null, last_error = p_error,
           due_at = now() + make_interval(mins => (2 ^ j.attempts)::int)
     where id = j.id;
    return 'retry';
  end if;
end;
$$;
