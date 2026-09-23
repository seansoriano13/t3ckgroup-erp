-- Reverses the write gate from 20260922000000_can_edit_sales_flows.sql (#291)
-- and 20260923000000_flow_access_settings.sql (#292): every employee may edit
-- the Flow Canvas again. Business decision — accepted trade-off: since #208,
-- access to an SOR follows flow configuration, so any employee can add
-- themselves as an action assignee / Always-sees entry and read their way in.
--
-- "Employee" = a signed-in user with an employees row (get_employee_id() not
-- null), not merely any authenticated JWT. The can_edit_sales_flows column and
-- function stay in place but no longer gate anything.

drop policy if exists "sale_types_write" on public."sale_types";
create policy "sale_types_write" on public."sale_types"
  as permissive for all to authenticated
  using (get_employee_id() is not null)
  with check (get_employee_id() is not null);

drop policy if exists "sales_flows_write" on public."sales_flows";
create policy "sales_flows_write" on public."sales_flows"
  as permissive for all to authenticated
  using (get_employee_id() is not null)
  with check (get_employee_id() is not null);

drop policy if exists "flow_stages_write" on public."flow_stages";
create policy "flow_stages_write" on public."flow_stages"
  as permissive for all to authenticated
  using (get_employee_id() is not null)
  with check (get_employee_id() is not null);

drop policy if exists "flow_edges_write" on public."flow_edges";
create policy "flow_edges_write" on public."flow_edges"
  as permissive for all to authenticated
  using (get_employee_id() is not null)
  with check (get_employee_id() is not null);

drop policy if exists "flow_stage_actions_write" on public."flow_stage_actions";
create policy "flow_stage_actions_write" on public."flow_stage_actions"
  as permissive for all to authenticated
  using (get_employee_id() is not null)
  with check (get_employee_id() is not null);

drop policy if exists "stage_conditions_write" on public."stage_conditions";
create policy "stage_conditions_write" on public."stage_conditions"
  as permissive for all to authenticated
  using (get_employee_id() is not null)
  with check (get_employee_id() is not null);

drop policy if exists flow_stage_fields_write on public.flow_stage_fields;
create policy flow_stage_fields_write on public.flow_stage_fields
  for all to authenticated
  using (get_employee_id() is not null)
  with check (get_employee_id() is not null);

drop policy if exists flow_form_fields_write on public.flow_form_fields;
create policy flow_form_fields_write on public.flow_form_fields
  for all to authenticated
  using (get_employee_id() is not null)
  with check (get_employee_id() is not null);

drop policy if exists flow_stage_follow_ups_write on public.flow_stage_follow_ups;
create policy flow_stage_follow_ups_write on public.flow_stage_follow_ups
  for all to authenticated
  using (get_employee_id() is not null)
  with check (get_employee_id() is not null);

drop policy if exists flow_access_settings_write on public.flow_access_settings;
create policy flow_access_settings_write on public.flow_access_settings
  for all to authenticated
  using (get_employee_id() is not null)
  with check (get_employee_id() is not null);

drop policy if exists flow_stage_access_write on public.flow_stage_access;
create policy flow_stage_access_write on public.flow_stage_access
  for all to authenticated
  using (get_employee_id() is not null)
  with check (get_employee_id() is not null);

-- Snapshots stay "own name only" (which already implies an employee row);
-- this also reopens lock_sales_flow, a SECURITY INVOKER RPC gated by these
-- policies.
drop policy if exists "flow_snapshots_write" on public."flow_snapshots";
create policy "flow_snapshots_write" on public."flow_snapshots"
  as permissive
  for insert
  to authenticated
  with check (created_by = get_employee_id());
