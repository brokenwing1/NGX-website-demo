-- LLM budget: shared atomic daily counters per tenant and globally.
create table app.llm_usage_global (
  day date primary key,
  requests int not null default 0,
  tokens bigint not null default 0
);

-- Reserve an estimated amount before calling the model. Returns false (and reserves nothing)
-- if either the tenant or the global daily cap would be exceeded.
create or replace function app.reserve_llm_budget(
  p_tenant_id uuid, p_tokens int, p_tenant_cap bigint, p_global_cap bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  d date := (now() at time zone 'UTC')::date;
  ok boolean;
begin
  insert into app.llm_usage as u(tenant_id, day, requests, tokens)
  values (p_tenant_id, d, 1, p_tokens)
  on conflict (tenant_id, day) do update
    set requests = u.requests + 1, tokens = u.tokens + p_tokens
    where u.tokens + p_tokens <= p_tenant_cap
  returning true into ok;
  if ok is null or p_tokens > p_tenant_cap then
    return false;
  end if;

  insert into app.llm_usage_global as g(day, requests, tokens)
  values (d, 1, p_tokens)
  on conflict (day) do update
    set requests = g.requests + 1, tokens = g.tokens + p_tokens
    where g.tokens + p_tokens <= p_global_cap
  returning true into ok;
  if ok is null or p_tokens > p_global_cap then
    -- undo the tenant reservation inside this same transaction
    update app.llm_usage set requests = requests - 1, tokens = tokens - p_tokens
     where tenant_id = p_tenant_id and day = d;
    return false;
  end if;
  return true;
end;
$$;

-- Correct a reservation with the real usage reported by the provider (delta may be negative).
create or replace function app.settle_llm_budget(p_tenant_id uuid, p_delta int)
returns void
language sql
security definer
set search_path = ''
as $$
  update app.llm_usage set tokens = greatest(0, tokens + p_delta)
   where tenant_id = p_tenant_id and day = (now() at time zone 'UTC')::date;
  update app.llm_usage_global set tokens = greatest(0, tokens + p_delta)
   where day = (now() at time zone 'UTC')::date;
$$;
