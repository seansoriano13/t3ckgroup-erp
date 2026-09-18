-- Issue #291 (part of #208, ADR 0021) — a Flow editor capability.
--
-- ADR 0019 left every Flow Canvas table writable by any signed-in employee
-- (20260908034000 and its siblings for flow_snapshots/flow_stage_fields/
-- flow_form_fields/flow_stage_follow_ups). That was fine while the canvas
-- only configured how deals move; once access to an SOR follows flow
-- configuration (#208), anyone could add themselves as an action's assignee
-- or an Always-sees entry and read their way in. `can_edit_sales_flows`,
-- granted only by a Super Admin, closes that — same pattern as
-- `can_manage_leaves`: a capability instead of overloading an existing role.

alter table public.employees
  add column if not exists can_edit_sales_flows boolean not null default false;

comment on column public.employees.can_edit_sales_flows is
  'Grants write access to the Flow Canvas tables and lock_sales_flow. Granted only by a Super Admin (enforced in prevent_role_escalation()).';

create or replace function public.can_edit_sales_flows()
 returns boolean
 language sql
 security definer
as $function$
  SELECT can_edit_sales_flows FROM public.employees WHERE email = auth.jwt() ->> 'email';
$function$
;

-- Extends the role-escalation trigger (prior shape in
-- 20260908093616_hidden_nav_overrides.sql) with the same super-admin-only
-- rule can_manage_leaves already gets.
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_caller_id                UUID;
  v_caller_is_super_admin    BOOLEAN;
  v_caller_is_hr             BOOLEAN;
  v_caller_can_manage_leaves BOOLEAN;
  v_caller_is_role_simulator BOOLEAN;
BEGIN
  v_caller_id := public.get_employee_id();

  SELECT is_super_admin, is_hr, can_manage_leaves, is_role_simulator
  INTO   v_caller_is_super_admin, v_caller_is_hr, v_caller_can_manage_leaves, v_caller_is_role_simulator
  FROM   public.employees
  WHERE  id = v_caller_id;

  IF v_caller_is_role_simulator IS TRUE THEN
    RETURN NEW;
  END IF;

  IF NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE) THEN
    IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
      NEW.is_super_admin := OLD.is_super_admin;
    END IF;
    IF NEW.is_hr IS DISTINCT FROM OLD.is_hr THEN
      NEW.is_hr := OLD.is_hr;
    END IF;
    IF NEW.is_head IS DISTINCT FROM OLD.is_head THEN
      NEW.is_head := OLD.is_head;
    END IF;
  END IF;

  IF NEW.is_super_admin = TRUE
     AND OLD.is_super_admin = FALSE
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can grant super-admin status.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_manage_leaves IS DISTINCT FROM OLD.can_manage_leaves
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can change leave-management access.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_edit_sales_flows IS DISTINCT FROM OLD.can_edit_sales_flows
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can change Flow editor access.'
      USING ERRCODE = '42501';
  END IF;

  -- Nobody edits their own hidden-navigation override — server-side, not by
  -- hiding the control — and only HR/Super Admin may edit anyone else's.
  IF NEW.hidden_nav_keys IS DISTINCT FROM OLD.hidden_nav_keys THEN
    IF OLD.id = v_caller_id OR NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE) THEN
      NEW.hidden_nav_keys := OLD.hidden_nav_keys;
    END IF;
  END IF;

  IF v_caller_can_manage_leaves IS TRUE
     AND NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE)
     AND OLD.id IS DISTINCT FROM v_caller_id
  THEN
    NEW := jsonb_populate_record(OLD, jsonb_build_object(
      'offset_hours_balance', NEW.offset_hours_balance,
      'sil_hours_balance', NEW.sil_hours_balance,
      'updated_at', NEW.updated_at
    ));
  END IF;

  RETURN NEW;
END;
$function$;

-- ─── Flow Canvas write policies ────────────────────────────────────────────
--
-- Every table 20260908034000 and its siblings opened to "any signed-in
-- employee" now requires is_super_admin() or can_edit_sales_flows(). The
-- ON DELETE RESTRICT foreign keys that made the open policy safe (a Stage in
-- use cannot be deleted) are untouched — this only narrows who may write.

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

-- flow_snapshots keeps its "own name only" check and gains the same gate.
-- lock_sales_flow (20260911030000) is SECURITY INVOKER and makes exactly this
-- insert plus a sales_flows update, so gating both tables' policies gates the
-- RPC too, without touching its body.
drop policy if exists "flow_snapshots_write" on public."flow_snapshots";
create policy "flow_snapshots_write" on public."flow_snapshots"
  as permissive
  for insert
  to authenticated
  with check (
    created_by = get_employee_id()
    and (is_super_admin() or can_edit_sales_flows())
  );
