-- Run after project_url and notify_worker_secret are stored in Vault.
-- Creates a new notification schedule; never replaces existing jobs or deletes data.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $setup$
begin
  if not exists (select 1 from cron.job where jobname = 'notify-worker') then
    perform cron.schedule('notify-worker', '* * * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/notify-worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notify_worker_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $job$);
  end if;
end;
$setup$;
