drop policy if exists "sales_flows_write" on public."sales_flows";
create policy "sales_flows_write" on public."sales_flows"
  as permissive for all to authenticated
  using (true)
  with check (true);

drop policy if exists "flow_stages_write" on public."flow_stages";
create policy "flow_stages_write" on public."flow_stages"
  as permissive for all to authenticated
  using (true)
  with check (true);

drop policy if exists "flow_edges_write" on public."flow_edges";
create policy "flow_edges_write" on public."flow_edges"
  as permissive for all to authenticated
  using (true)
  with check (true);

drop policy if exists "flow_stage_actions_write" on public."flow_stage_actions";
create policy "flow_stage_actions_write" on public."flow_stage_actions"
  as permissive for all to authenticated
  using (true)
  with check (true);

drop policy if exists "stage_conditions_write" on public."stage_conditions";
create policy "stage_conditions_write" on public."stage_conditions"
  as permissive for all to authenticated
  using (true)
  with check (true);

drop policy if exists "sale_types_write" on public."sale_types";
create policy "sale_types_write" on public."sale_types"
  as permissive for all to authenticated
  using (true)
  with check (true);
