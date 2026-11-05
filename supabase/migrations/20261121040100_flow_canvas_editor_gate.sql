-- Issue #884 (part of #878 / #907): only Super Admins and Flow editors may edit
-- or publish the Flow Canvas.
--
-- 20260930030000_open_flow_canvas_writes_to_all_employees.sql reopened every
-- Flow Canvas write to any signed-in employee. Decision on #907 reverses that:
-- writes need is_super_admin() or can_edit_sales_flows(), the gate
-- 20260922000000 first set. Everyone else keeps read access and sees the canvas
-- read-only (no menu entry, no write controls).
--
-- Three layers change together:
--   1. Row level policies on every Flow Canvas table, including the two Access
--      tables and the snapshot insert that lock_sales_flow makes.
--   2. lock_sales_flow (publish) refuses non-editors with a clear message.
--   3. restore_flow_snapshot is guarded in 20261121180002, because later
--      migrations (724, 744, 745) re-create it and would drop a guard added here.
--
-- lock_sales_flow is re-created in full, not patched. Its body is copied from
-- 20260911030000 with only the guard added.

-- ─── Write policies ───────────────────────────────────────────────────────

drop policy if exists "sale_types_write" on public."sale_types";
create policy "sale_types_write" on public."sale_types"
  as permissive for all to authenticated
  using (is_super_admin() or can_edit_sales_flows())
  with check (is_super_admin() or can_edit_sales_flows());

drop policy if exists "sales_flows_write" on public."sales_flows";
create policy "sales_flows_write" on public."sales_flows"
  as permissive for all to authenticated
  using (is_super_admin() or can_edit_sales_flows())
  with check (is_super_admin() or can_edit_sales_flows());

drop policy if exists "flow_stages_write" on public."flow_stages";
create policy "flow_stages_write" on public."flow_stages"
  as permissive for all to authenticated
  using (is_super_admin() or can_edit_sales_flows())
  with check (is_super_admin() or can_edit_sales_flows());

drop policy if exists "flow_edges_write" on public."flow_edges";
create policy "flow_edges_write" on public."flow_edges"
  as permissive for all to authenticated
  using (is_super_admin() or can_edit_sales_flows())
  with check (is_super_admin() or can_edit_sales_flows());

drop policy if exists "flow_stage_actions_write" on public."flow_stage_actions";
create policy "flow_stage_actions_write" on public."flow_stage_actions"
  as permissive for all to authenticated
  using (is_super_admin() or can_edit_sales_flows())
  with check (is_super_admin() or can_edit_sales_flows());

drop policy if exists "stage_conditions_write" on public."stage_conditions";
create policy "stage_conditions_write" on public."stage_conditions"
  as permissive for all to authenticated
  using (is_super_admin() or can_edit_sales_flows())
  with check (is_super_admin() or can_edit_sales_flows());

drop policy if exists flow_stage_fields_write on public.flow_stage_fields;
create policy flow_stage_fields_write on public.flow_stage_fields
  for all to authenticated
  using (is_super_admin() or can_edit_sales_flows())
  with check (is_super_admin() or can_edit_sales_flows());

drop policy if exists flow_form_fields_write on public.flow_form_fields;
create policy flow_form_fields_write on public.flow_form_fields
  for all to authenticated
  using (is_super_admin() or can_edit_sales_flows())
  with check (is_super_admin() or can_edit_sales_flows());

drop policy if exists flow_stage_follow_ups_write on public.flow_stage_follow_ups;
create policy flow_stage_follow_ups_write on public.flow_stage_follow_ups
  for all to authenticated
  using (is_super_admin() or can_edit_sales_flows())
  with check (is_super_admin() or can_edit_sales_flows());

drop policy if exists flow_access_settings_write on public.flow_access_settings;
create policy flow_access_settings_write on public.flow_access_settings
  for all to authenticated
  using (is_super_admin() or can_edit_sales_flows())
  with check (is_super_admin() or can_edit_sales_flows());

drop policy if exists flow_stage_access_write on public.flow_stage_access;
create policy flow_stage_access_write on public.flow_stage_access
  for all to authenticated
  using (is_super_admin() or can_edit_sales_flows())
  with check (is_super_admin() or can_edit_sales_flows());

-- Snapshots stay "own name only" and now also need the editor gate. Publishing
-- is the only thing that inserts one.
drop policy if exists "flow_snapshots_write" on public."flow_snapshots";
create policy "flow_snapshots_write" on public."flow_snapshots"
  as permissive
  for insert
  to authenticated
  with check (
    created_by = get_employee_id()
    and (is_super_admin() or can_edit_sales_flows())
  );

-- ─── lock_sales_flow (publish) ────────────────────────────────────────────

create or replace function public.lock_sales_flow(
  p_flow_id uuid,
  p_actor_id uuid,
  p_snapshot_data jsonb,
  p_note text default null
)
returns json
language plpgsql
as $$
declare
  v_flow record;
  v_major integer;
  v_minor integer;
  v_snapshot record;
  v_latest_data jsonb;
begin
  -- #884: a signed-in employee must be a Super Admin or a Flow editor. RLS would
  -- refuse the writes below anyway; this says so plainly, before anything changes.
  -- With no signed-in user (the service role, or a direct database connection
  -- such as scripts/transfer-sales-flows.mjs) auth.role() is not
  -- 'authenticated', so operator tooling is not gated here.
  if auth.role() = 'authenticated' and not (is_super_admin() or can_edit_sales_flows()) then
    raise exception 'Only a Super Admin or a Flow editor can publish a Sales Flow.'
      using errcode = '42501';
  end if;
  select * into v_flow from sales_flows where id = p_flow_id for update;
  if not found then
    raise exception 'Sales Flow not found.';
  end if;
  if v_flow.state <> 'draft' then
    raise exception 'This Sales Flow is locked. Unlock it first, with a reason, to make changes.';
  end if;

  select fs.snapshot_data
    into v_latest_data
  from flow_snapshots fs
  where fs.flow_id = p_flow_id
  order by fs.version desc, fs.version_minor desc
  limit 1;

  if v_latest_data is not null and v_latest_data = p_snapshot_data then
    raise exception 'This draft is identical to the latest version. There is nothing to publish.';
  end if;

  select version_major, version_minor
    into v_major, v_minor
  from public.flow_snapshot_next_version(p_flow_id, p_snapshot_data);

  update sales_flows set
    state = 'locked',
    locked_at = now(),
    locked_by = p_actor_id,
    updated_at = now()
  where id = p_flow_id
  returning * into v_flow;

  insert into flow_snapshots (flow_id, version, version_minor, snapshot_data, created_by, note)
  values (p_flow_id, v_major, v_minor, p_snapshot_data, p_actor_id, nullif(trim(p_note), ''))
  returning * into v_snapshot;

  return json_build_object('flow', row_to_json(v_flow), 'snapshot', row_to_json(v_snapshot));
end;
$$;

grant execute on function public.lock_sales_flow(uuid, uuid, jsonb, text) to authenticated;
