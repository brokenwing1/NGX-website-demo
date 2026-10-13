-- Foundation: extensions, private schema, default privileges.
-- Assumes Supabase roles exist (anon, authenticated, service_role) and the auth schema
-- with auth.users / auth.uid(). For a bare Postgres see supabase/tests/bootstrap_local.sql.

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Private schema: helpers and secrets. Never exposed through the Data API.
create schema if not exists app;
revoke all on schema app from public;
revoke all on schema app from anon, authenticated;
grant usage on schema app to service_role;

-- Functions must be granted explicitly. Postgres grants EXECUTE to PUBLIC by default;
-- we turn that off for everything created by the migration owner from now on.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema app revoke execute on functions from public;

-- Tables are not readable by API roles unless granted below (and then only through RLS).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Server-side secrets (HMAC key for booking access tokens).
create table if not exists app.secrets (
  key text primary key,
  value bytea not null,
  created_at timestamptz not null default now()
);
revoke all on app.secrets from public, anon, authenticated;

insert into app.secrets(key, value)
values ('booking_token_hmac', extensions.gen_random_bytes(32))
on conflict (key) do nothing;

-- Structured error helper: every business error is raised with SQLSTATE P0001,
-- a stable machine code in MESSAGE and human text in DETAIL.
create or replace function app.fail(p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, p_code);
end;
$$;
