-- SOR chat posts time out ("statement timeout", stuck on Sending), and the chat rule is the top CPU cost.
--
-- Cause: #1042 made sor_log_read compare each row against sor_readable_visit_ids() and
-- sor_readable_log_sor_ids(). Those work out the answer for EVERY SOR the caller can see (about 25 ms an
-- SOR), on every read, however few rows the read asks for. On prod (2026-11-23) a Sales user sees ~450
-- SORs, so reading back the one row a chat post just wrote took 23 s - past the 8 s statement timeout.
-- Realtime runs the same rule for every subscriber on every new log row, so it also burned the CPU.
--
-- Fix: check each row against its own SOR only, with the same rule functions sor_logs_for_sors uses
-- (sor_visible_visit_ids / sor_access_level). Measured on prod as that user: one row 0.18 s, one SOR's
-- 15 rows 0.3 s. The multi-SOR read keeps going through sor_logs_for_sors (#1042), so the per-row cost
-- never meets thousands of rows. Same answer as before (ADR 0021 unchanged), different shape.
--
-- sor_readable_visit_ids / sor_readable_log_sor_ids stay defined; nothing in the policy uses them now.
--
-- SAFE TO RUN AT ANY TIME. Idempotent.

drop policy if exists sor_log_read on public.sales_opportunity_logs;
create policy sor_log_read on public.sales_opportunity_logs
  for select to authenticated
  using (
    (select public.is_super_admin())
    or (stage_visit_id is not null
        and stage_visit_id in (select public.sor_visible_visit_ids(opportunity_id)))
    or (stage_visit_id is null
        and public.sor_access_level(opportunity_id) = any (array['full', 'participant']))
  );
