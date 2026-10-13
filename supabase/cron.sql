-- Supabase Cron for the notification outbox. Run ONCE per project in the SQL editor (or psql)
-- after `supabase db push`, AFTER storing two secrets in Vault:
--
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<same value as NOTIFY_WORKER_SECRET>', 'notify_worker_secret');
--
-- Requires the pg_cron and pg_net extensions (Database → Extensions in the dashboard).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-runnable: drop previous schedules with the same names.
select cron.unschedule(jobid) from cron.job where jobname in ('notify-worker', 'rate-counters-cleanup');

-- Every minute: deliver due notifications (reminders 24h before, owner alerts).
select cron.schedule(
  'notify-worker',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/notify-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notify_worker_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Daily: drop old rate-limit windows and old LLM usage rows.
select cron.schedule(
  'rate-counters-cleanup',
  '17 3 * * *',
  $$
  delete from app.rate_counters where window_start < now() - interval '2 days';
  delete from app.llm_usage where day < current_date - 90;
  delete from app.llm_usage_global where day < current_date - 90;
  $$
);
