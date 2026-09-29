-- Issue #380 (part of #377) — re-assert staging's SOR policies on production.
--
-- Production's migration ledger lists the Deal Team read cutover as applied,
-- but the 9/18 rollback left the old policies live (SOR read/update `true`,
-- log-read and members-read too). Pushing migrations won't re-apply them, so
-- this drops and re-creates the four policies with staging's definitions, and
-- drops the ones production still has that staging removed.
--
-- `sor_update` is expressed through `sor_can_edit_opportunity`, whose
-- pre-#381 body is exactly staging's inline predicate (registered_by, Deal Team
-- columns, heads, Super Admins), so it is equivalent to staging today and picks
-- up Always edits (#381) whichever order the two migrations run in.
--
-- On staging and on a from-empty build it changes nothing. Idempotent; every
-- drop is `if exists`; no rows are touched. 

drop policy if exists "sor_read" on public.sales_opportunities;
create policy "sor_read" on public.sales_opportunities
  as permissive
  for select
  to authenticated
  using ((is_super_admin() OR sor_is_deal_team(sales_opportunities.*, get_employee_id()) OR sor_always_sees(sales_opportunities.*, get_employee_id())));

drop policy if exists "sor_update" on public.sales_opportunities;
create policy "sor_update" on public.sales_opportunities
  as permissive
  for update
  to authenticated
  using (sor_can_edit_opportunity(id));

drop policy if exists "sor_log_read" on public.sales_opportunity_logs;
create policy "sor_log_read" on public.sales_opportunity_logs
  as permissive
  for select
  to authenticated
  using ((is_super_admin() OR ((stage_visit_id IS NOT NULL) AND (stage_visit_id IN ( SELECT sor_visible_visit_ids(sales_opportunity_logs.opportunity_id) AS sor_visible_visit_ids))) OR ((stage_visit_id IS NULL) AND (sor_access_level(opportunity_id) = ANY (ARRAY['full'::text, 'participant'::text])))));

drop policy if exists "sales_opportunity_members_read" on public.sales_opportunity_members;
create policy "sales_opportunity_members_read" on public.sales_opportunity_members
  as permissive
  for select
  to authenticated
  using ((sor_can_edit_opportunity(opportunity_id) OR is_hr()));

-- Production-only policies staging has dropped.
drop policy if exists "Allow all read" on public.system_audit_logs;
drop policy if exists "hr_read_system_audit_logs" on public.system_audit_logs;
drop policy if exists "Authenticated users can insert task activity" on public.task_activity;
drop policy if exists "Authenticated users can read task activity" on public.task_activity;
