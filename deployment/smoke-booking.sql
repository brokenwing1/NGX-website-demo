-- Transactional smoke test: no booking or notification survives ROLLBACK.
begin;
set local role anon;
do $test$
declare
  studio jsonb;
  service_id uuid;
  slot timestamptz;
  result jsonb;
  replay jsonb;
  cancelled jsonb;
  request_key text := 'deployment-smoke-' || md5(clock_timestamp()::text);
begin
  studio := public.get_tenant_public('ngx-detailing');
  service_id := (studio #>> '{services,0,id}')::uuid;
  select starts_at into slot
  from public.get_availability('ngx-detailing', service_id,
    (studio ->> 'today')::date + 2, (studio ->> 'today')::date + 3)
  where available order by starts_at limit 1;
  if slot is null then raise exception 'No future slot for smoke test'; end if;

  result := public.create_booking('ngx-detailing', service_id, slot,
    'Deployment smoke test', '+79000000099', 'Test vehicle', 'Rolled back automatically', request_key);
  replay := public.create_booking('ngx-detailing', service_id, slot,
    'Deployment smoke test', '+79000000099', 'Test vehicle', 'Rolled back automatically', request_key);
  if replay #>> '{booking,id}' is distinct from result #>> '{booking,id}'
     or replay ->> 'replayed' is distinct from 'true' then
    raise exception 'Booking idempotency failed';
  end if;
  perform public.get_booking((result #>> '{booking,id}')::uuid, result ->> 'token');
  begin
    perform public.get_booking((result #>> '{booking,id}')::uuid, 'invalid-deployment-token');
    raise exception 'Invalid token accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'booking_not_found' then raise; end if;
  end;
  cancelled := public.cancel_my_booking((result #>> '{booking,id}')::uuid,
    result ->> 'token', 'Transactional deployment check');
  if cancelled ->> 'status' is distinct from 'cancelled' then
    raise exception 'Cancellation failed';
  end if;
end;
$test$;
rollback;
select 'PASS: anon booking, replay, token isolation and cancellation; changes rolled back' as result;
