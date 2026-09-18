-- ==============================================================================
-- 0045_stage_gate_rls_fix.sql
--
-- `sor_requirement_status` (0041) and `sales_opportunity_members` (0044) were
-- both designed to carry NO row-level security — the same "authorization
-- lives in the service layer, not the database" convention
-- `sales_opportunity_logs` already uses (0001) — because neither migration
-- calls `enable row level security`.
--
-- But this project runs a schema-wide `rls_auto_enable` event trigger that
-- force-enables RLS on every newly created table regardless of what its own
-- migration says. Both tables were silently created RLS-enabled with zero
-- policies — the strictest possible state, not the "open" one their design
-- intended: every read and write both services attempt (stageRequirementService
-- reading status rows via the gate check, opportunityService writing them on
-- satisfaction, addMember) has been failing against this live database.
--
-- Fix: explicit policies matching `sales_opportunity_logs`' own shape exactly
-- (`sor_log_read` / `sor_log_insert` — read and insert for any authenticated
-- user, no update/delete policy because neither table's rows are ever revised
-- after being written — D31 "satisfied stays satisfied", membership additive
-- and permanent).
-- ==============================================================================

drop policy if exists sor_requirement_status_read on public.sor_requirement_status;
create policy sor_requirement_status_read on public.sor_requirement_status
  for select to authenticated using (true);

drop policy if exists sor_requirement_status_insert on public.sor_requirement_status;
create policy sor_requirement_status_insert on public.sor_requirement_status
  for insert to authenticated with check (true);

drop policy if exists sales_opportunity_members_read on public.sales_opportunity_members;
create policy sales_opportunity_members_read on public.sales_opportunity_members
  for select to authenticated using (true);

drop policy if exists sales_opportunity_members_insert on public.sales_opportunity_members;
create policy sales_opportunity_members_insert on public.sales_opportunity_members
  for insert to authenticated with check (true);
