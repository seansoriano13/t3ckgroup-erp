-- Cron-driven edge functions authenticate with CRON_SECRET from Vault (#457).
--
-- Before: 20261002120000_retail_sync_cron_and_realtime had the retail sync
-- jobs send the project's public anon key, because the Edge Functions gateway
-- (verify_jwt) only passes a JWT, and left CRON_SECRET unset so the function
-- accepted it. Anyone holding the anon key (it ships in the web bundle) could
-- therefore trigger an Odoo sync. The follow-up reminder job (20260917010000)
-- read `app.settings.*` database settings, which a hosted project cannot set,
-- so it has failed every hour on staging with `invalid URL "/sor-follow-up-
-- reminders": Bad scheme`.
--
-- After: odoo-sor-sync and sor-follow-up-reminders are deployed with
-- verify_jwt = false (supabase/config.toml) and check the caller themselves
-- (_shared/cronAuth.ts): Bearer CRON_SECRET, or the service-role key. Both jobs
-- read their URL and secret from Vault, once per environment:
--
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');  -- already exists where #455 ran
--   select vault.create_secret('<the same value as the CRON_SECRET function secret>', 'cron_secret');
--
-- and the function secret is set with `supabase secrets set CRON_SECRET=...`.
-- The `anon_key` Vault secret is no longer read; it can be deleted.
--
-- ORDER MATTERS. Deploy the two functions first (the "Deploy edge functions"
-- workflow, naming odoo-sor-sync and sor-follow-up-reminders: the reminders
-- function is not in the default list), set CRON_SECRET, create the Vault
-- secret, then apply this migration. Until the functions carry verify_jwt =
-- false the gateway answers a CRON_SECRET bearer with 401, and until the Vault
-- secret exists the jobs fail loudly in cron.job_run_details instead of
-- silently doing nothing. A cron "succeeded" row only means the request was
-- queued: whether the function answered is in net._http_response (status_code).
--
-- SAFE TO RUN AT ANY TIME: functions are CREATE OR REPLACE, jobs are
-- unscheduled before they are scheduled.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- One place that knows how a cron job reaches an edge function.
create or replace function public.invoke_cron_edge_function(
  p_function text,
  p_query text default '',
  p_timeout_ms integer default 120000
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise exception 'invoke_cron_edge_function: Vault secrets project_url and cron_secret must both exist';
  end if;

  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/' || p_function || p_query,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := p_timeout_ms
  );
end;
$function$;

-- Only cron jobs (running as the owner) call these: they must not be a way for a
-- signed-in user to trigger an edge function, or to read the secret's use.
revoke all on function public.invoke_cron_edge_function(text, text, integer) from public, anon, authenticated;

create or replace function public.invoke_retail_sync(p_mode text default null)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_mode is not null and p_mode <> 'full' then
    raise exception 'invoke_retail_sync: mode must be null or ''full'', got %', p_mode;
  end if;

  return public.invoke_cron_edge_function(
    'odoo-sor-sync',
    case when p_mode is null then '' else '?mode=' || p_mode end,
    -- the nightly run re-reads more orders' notes than a 5-minute run; give it room
    case when p_mode = 'full' then 300000 else 120000 end
  );
end;
$function$;

revoke all on function public.invoke_retail_sync(text) from public, anon, authenticated;

create or replace function public.invoke_sor_follow_up_reminders()
returns bigint
language sql
security definer
set search_path to ''
as $function$
  select public.invoke_cron_edge_function('sor-follow-up-reminders');
$function$;

revoke all on function public.invoke_sor_follow_up_reminders() from public, anon, authenticated;

-- The retail jobs (retail-sync-5min, retail-sync-nightly) already call
-- public.invoke_retail_sync(), so redefining it above is all they need.

select cron.unschedule(jobname)
from cron.job
where jobname = 'sor-follow-up-reminders';

select cron.schedule(
  'sor-follow-up-reminders',
  '0 * * * *', -- hourly, on the hour
  $$select public.invoke_sor_follow_up_reminders();$$
);
