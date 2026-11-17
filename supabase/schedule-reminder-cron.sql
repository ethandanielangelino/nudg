-- Optional minute-precision scheduler for Vercel Hobby deployments.
-- First enable pg_cron and pg_net in Supabase Database > Extensions.
-- In Supabase Vault, save these secrets (without a trailing slash on the URL):
--   nudg_app_url       = https://your-production-app.vercel.app
--   nudg_cron_secret   = the exact CRON_SECRET set in Vercel Production
-- This SQL reads credentials from Vault, not from the query text.

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'nudg_app_url') then
    raise exception 'Add nudg_app_url to Supabase Vault before scheduling reminders.';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'nudg_cron_secret') then
    raise exception 'Add nudg_cron_secret to Supabase Vault before scheduling reminders.';
  end if;
end $$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'nudg-reminders-every-minute';

select cron.schedule(
  'nudg-reminders-every-minute',
  '* * * * *',
  $$
    select net.http_get(
      url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'nudg_app_url'), '/') || '/api/cron/reminders',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'nudg_cron_secret')
      ),
      timeout_milliseconds := 10000
    );
  $$
);
