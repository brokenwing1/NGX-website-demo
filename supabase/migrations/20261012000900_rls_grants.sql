-- Row level security and grants.
-- anon: no table access at all, only the public RPCs below.
-- authenticated: SELECT on tenant tables, filtered by membership through RLS; writes only via RPC.

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'tenants', 'tenant_members', 'resources', 'services', 'service_resources', 'service_price_history',
    'working_hours', 'schedule_exceptions', 'bookings', 'resource_blocks', 'resource_occupancies',
    'booking_access_tokens', 'payments', 'info_cards', 'gallery_items', 'push_subscriptions', 'notification_jobs'
  ] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on public.%I from anon, authenticated', tbl);
  end loop;
end;
$$;

-- The table owner (postgres, owner of the SECURITY DEFINER functions) bypasses RLS by design;
-- every definer function checks tenant and membership explicitly.

-- Helpers needed while evaluating policies and invoker functions as "authenticated".
grant usage on schema app to authenticated;
grant execute on function app.current_user_id() to authenticated;
grant execute on function app.my_tenant_ids() to authenticated;
grant execute on function app.is_member(uuid) to authenticated;
grant execute on function app.fail(text, text) to authenticated;
grant execute on function app.local_today(text) to authenticated;
grant execute on function app.local_to_ts(date, time, text) to authenticated;
grant execute on function app.period_days(text, text, date) to authenticated;
grant execute on function app.stats(uuid, date, date) to authenticated;

-- Member-scoped read policies.
create policy tenants_member_read on public.tenants
  for select to authenticated using (id in (select app.my_tenant_ids()));
create policy members_read on public.tenant_members
  for select to authenticated using (tenant_id in (select app.my_tenant_ids()));

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'resources', 'services', 'service_resources', 'service_price_history', 'working_hours',
    'schedule_exceptions', 'bookings', 'resource_blocks', 'resource_occupancies', 'payments',
    'info_cards', 'gallery_items'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (tenant_id in (select app.my_tenant_ids()))',
      tbl || '_member_read', tbl);
    execute format('grant select on public.%I to authenticated', tbl);
  end loop;
end;
$$;
grant select on public.tenants, public.tenant_members to authenticated;
-- booking_access_tokens, push_subscriptions, notification_jobs: no grants, no policies.

-- Public RPCs (anonymous clients and logged-in owners alike).
grant execute on function public.get_tenant_public(text) to anon, authenticated;
grant execute on function public.get_availability(text, uuid, date, date) to anon, authenticated;
grant execute on function public.get_nearest_slots(text, uuid, int) to anon, authenticated;
grant execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_booking(uuid, text) to anon, authenticated;
grant execute on function public.cancel_my_booking(uuid, text, text) to anon, authenticated;
grant execute on function public.save_booking_push(uuid, text, text, text, text) to anon, authenticated;

-- Owner RPCs: authenticated only; membership is checked inside every function.
grant execute on function public.owner_me() to authenticated;
grant execute on function public.owner_settings(text) to authenticated;
grant execute on function public.owner_bookings(text, timestamptz, timestamptz) to authenticated;
grant execute on function public.owner_booking_payments(text, uuid) to authenticated;
grant execute on function public.owner_stats(text, text, date, date) to authenticated;
grant execute on function public.owner_create_booking(text, uuid, timestamptz, text, text, text, text, uuid, text, boolean) to authenticated;
grant execute on function public.owner_reschedule_booking(text, uuid, timestamptz, uuid, boolean) to authenticated;
grant execute on function public.owner_cancel_booking(text, uuid, text) to authenticated;
grant execute on function public.owner_set_booking_status(text, uuid, text) to authenticated;
grant execute on function public.owner_add_payment(text, uuid, text, bigint, text, text, text) to authenticated;
grant execute on function public.owner_block_resource(text, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.owner_remove_block(text, uuid) to authenticated;
grant execute on function public.owner_update_tenant(text, jsonb) to authenticated;
grant execute on function public.owner_set_working_hours(text, jsonb) to authenticated;
grant execute on function public.owner_upsert_exception(text, date, boolean, time, time, text) to authenticated;
grant execute on function public.owner_delete_exception(text, date) to authenticated;
grant execute on function public.owner_upsert_resource(text, uuid, text, boolean) to authenticated;
grant execute on function public.owner_upsert_service(text, uuid, jsonb, uuid[]) to authenticated;
grant execute on function public.owner_update_info_card(text, int, text, text, text) to authenticated;
grant execute on function public.owner_add_gallery_item(text, text, text) to authenticated;
grant execute on function public.owner_update_gallery_item(text, uuid, text, text) to authenticated;
grant execute on function public.owner_remove_gallery_item(text, uuid) to authenticated;
grant execute on function public.owner_save_push(text, text, text, text) to authenticated;

-- Storage (only on a real Supabase project): one public bucket for studio media.
-- Owners may write only under "<tenant_id>/owner/". Config images are uploaded by the pipeline.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'storage' and c.relname = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('media', 'media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

    execute $p$
      create policy media_owner_insert on storage.objects for insert to authenticated
      with check (
        bucket_id = 'media'
        and (storage.foldername(name))[2] = 'owner'
        and app.is_member(((storage.foldername(name))[1])::uuid)
      )$p$;
    execute $p$
      create policy media_owner_update on storage.objects for update to authenticated
      using (
        bucket_id = 'media'
        and (storage.foldername(name))[2] = 'owner'
        and app.is_member(((storage.foldername(name))[1])::uuid)
      )$p$;
  end if;
end;
$$;
