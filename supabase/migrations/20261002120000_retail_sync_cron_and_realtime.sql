-- Retail keeps itself current (#455).
--
-- 1. SCHEDULING. The in-function Deno.cron in odoo-sor-sync stopped firing
--    (staging stopped updating on 2026-09-29), so the sync now runs from the
--    database: pg_cron calls the function through pg_net, every 5 minutes, plus
--    a nightly run with ?mode=full that also re-reads orders whose notes were
--    touched in the last two days (ADR 0032). Needs pg_cron and pg_net, which
--    20260917010000_sor_follow_up_reminder_cron enables.
--
--    This deliberately does NOT copy 20260917010000_sor_follow_up_reminder_cron:
--    that job reads its URL and secret from `app.settings.*` database settings,
--    which a hosted project cannot set, so on staging every run fails with
--    `invalid URL "/sor-follow-up-reminders": Bad scheme`. These jobs read their
--    URL and key from Vault instead, once per environment:
--
--      select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--      select vault.create_secret('<the project''s anon key>',          'anon_key');
--
--    The anon key is a publishable key (the legacy eyJ... JWT, not sb_publishable_);
--    it only gets the request past the Edge Functions gateway (verify_jwt). Until
--    both secrets exist the jobs fail loudly in cron.job_run_details instead of
--    silently doing nothing.
--
--    The function also refuses any request whose Authorization is not exactly
--    `Bearer ${CRON_SECRET}` whenever a CRON_SECRET function secret is set. A JWT
--    gateway and that check cannot both pass, so CRON_SECRET must stay unset on a
--    project these jobs run against; the function is then callable with the
--    public anon key, as it already was. Hardening that is a separate change.
--
--    NOTE: a cron "succeeded" row only means the request was queued. Whether the
--    function answered is in net._http_response (status_code, kept ~6 hours).
--
-- 2. LIVE. retail_orders broadcasts a change signal (the row id, never a column),
--    the same pattern and the same realtime.messages policy as
--    sales_opportunities and tasks (docs/realtime-policy.md). An update that wrote
--    the values already stored (updated_at aside) is not announced.
--
-- Staging only: prod has no retail_orders. SAFE TO RUN AT ANY TIME: functions are
-- CREATE OR REPLACE, the trigger is dropped and recreated, the jobs are
-- unscheduled before they are scheduled.

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

create or replace function public.invoke_retail_sync(p_mode text default null)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_url text;
  v_key text;
begin
  if p_mode is not null and p_mode <> 'full' then
    raise exception 'invoke_retail_sync: mode must be null or ''full'', got %', p_mode;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'anon_key';
  if v_url is null or v_key is null then
    raise exception 'invoke_retail_sync: Vault secrets project_url and anon_key must both exist';
  end if;

  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/odoo-sor-sync'
      || case when p_mode is null then '' else '?mode=' || p_mode end,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    -- the nightly run re-reads more orders' notes than a 5-minute run; give it room
    timeout_milliseconds := case when p_mode = 'full' then 300000 else 120000 end
  );
end;
$function$;

-- Only the cron job (running as the owner) calls this; it must not be a way for
-- any signed-in user to trigger an Odoo sync.
revoke all on function public.invoke_retail_sync(text) from public, anon, authenticated;

select cron.unschedule(jobname)
from cron.job
where jobname in ('retail-sync-5min', 'retail-sync-nightly');

select cron.schedule(
  'retail-sync-5min',
  '*/5 * * * *',
  $$select public.invoke_retail_sync();$$
);

-- 18:02 UTC = 02:02 in Manila. Off the :00/:05 boundary so it does not start in
-- the same second as a 5-minute run.
select cron.schedule(
  'retail-sync-nightly',
  '2 18 * * *',
  $$select public.invoke_retail_sync('full');$$
);

-- ---------------------------------------------------------------------------
-- Live
-- ---------------------------------------------------------------------------

-- Lets a signed-in client receive on a private topic. `tasks` and
-- sales_opportunities already created it on staging and prod; guarded twice:
-- not recreated if present, skipped where the Realtime service has not made
-- `realtime.messages` yet (a local stack).
do $$
begin
  if to_regclass('realtime.messages') is not null
     and not exists (
       select 1 from pg_policies
       where schemaname = 'realtime' and tablename = 'messages'
         and policyname = 'authenticated can receive broadcasts'
     ) then
    create policy "authenticated can receive broadcasts"
      on "realtime"."messages"
      for select
      to authenticated
      using (true);
  end if;
end $$;

-- Wrapped in its own exception handler, like tasks_broadcast_change: where
-- `realtime.send` does not exist, a broadcast failure must never roll back the
-- sync write it is only a notification about.
create or replace function public.retail_orders_broadcast_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- The sync upserts a whole window every run; only a row that actually
  -- changed is news. updated_at is bumped by trg_retail_orders_updated_at.
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return null;
  end if;
  begin
    perform realtime.send(
      jsonb_build_object('id', coalesce(new.id, old.id)),
      tg_op,
      'retail_orders-changes',
      true -- private: gated by the realtime.messages policy, not public
    );
  exception when others then
    null;
  end;
  return null;
end;
$function$;

drop trigger if exists retail_orders_broadcast_change_trigger on public.retail_orders;

create trigger retail_orders_broadcast_change_trigger
after insert or update or delete on public.retail_orders
for each row execute function public.retail_orders_broadcast_change();
