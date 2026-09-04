-- ==============================================================================
-- 0072_allow_all_flow_canvas.sql
--
-- Relaxes the RLS policies for Flow Canvas tables so that anyone can edit them,
-- not just super-admins.
--
-- Recovered 2026-08-31 from the staging ledger, where it had been applied
-- directly as version 0072 without ever being committed. Its absence from the
-- repo is why the repo numbered flow_canvas_realtime 0072 while staging's
-- ledger records it as 0073. See .scratch/codebase-cleanup/ROLLBACK-REFERENCE.md.
-- ==============================================================================

-- 1. sales_flows
drop policy if exists sales_flows_write on public.sales_flows;

create policy sales_flows_write on public.sales_flows
  for all to authenticated
  using (true)
  with check (true);

-- 2. flow_stages
drop policy if exists flow_stages_write on public.flow_stages;

create policy flow_stages_write on public.flow_stages
  for all to authenticated
  using (true)
  with check (true);

-- 3. flow_edges
drop policy if exists flow_edges_write on public.flow_edges;

create policy flow_edges_write on public.flow_edges
  for all to authenticated
  using (true)
  with check (true);

-- 4. flow_stage_actions
drop policy if exists flow_stage_actions_write on public.flow_stage_actions;

create policy flow_stage_actions_write on public.flow_stage_actions
  for all to authenticated
  using (true)
  with check (true);

-- 5. stage_conditions
drop policy if exists stage_conditions_write on public.stage_conditions;

create policy stage_conditions_write on public.stage_conditions
  for all to authenticated
  using (true)
  with check (true);
