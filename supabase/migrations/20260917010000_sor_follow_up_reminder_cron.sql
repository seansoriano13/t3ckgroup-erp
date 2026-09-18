-- Issue #204 Part 3 — the project's first scheduled job. Deadline warnings
-- today only fire when someone opens the register; a Follow-up reminder
-- meant to chase someone who is NOT in the portal needs a server-side
-- scheduler, so this enables pg_cron + pg_net and schedules an hourly call
-- into the `sor-follow-up-reminders` edge function.
--
-- UNVERIFIED: there is no live Supabase project or local Postgres available
-- in this sandbox to actually run `select cron.schedule(...)` against, so
-- this migration has not been exercised end-to-end. It is written to match
-- Supabase's documented pg_cron + pg_net pattern as closely as possible;
-- treat it as a careful draft, not a proven one.
--
-- The edge function's own URL and the CRON_SECRET it checks (mirroring
-- odoo-sor-sync/index.ts's own `Authorization: Bearer ${CRON_SECRET}`
-- convention) are read from Postgres settings rather than hardcoded, so the
-- same migration works unchanged across local/staging/prod: set them once
-- per environment via
--   alter database postgres set app.settings.cron_secret = '...';
--   alter database postgres set app.settings.edge_function_base_url = 'https://<project-ref>.supabase.co/functions/v1';
-- (or the local equivalent) before this job's first run. Until those
-- settings exist, the http_post below sends a blank/absent secret and the
-- function correctly refuses it with 401 rather than silently no-op'ing.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('sor-follow-up-reminders')
where exists (select 1 from cron.job where jobname = 'sor-follow-up-reminders');

select cron.schedule(
  'sor-follow-up-reminders',
  '0 * * * *', -- hourly, on the hour
  $$
  select net.http_post(
    url := coalesce(current_setting('app.settings.edge_function_base_url', true), '') || '/sor-follow-up-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.cron_secret', true), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
