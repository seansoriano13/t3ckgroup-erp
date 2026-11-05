-- ==============================================================================
-- 20261123000000_flow_editor_insert_guard.sql
--
-- Issue #884 (part of #878 / #907, spec decision 5): only a Super Admin may
-- give a new employee the Flow editor flag (`can_edit_sales_flows`).
--
-- prevent_role_escalation() is a BEFORE UPDATE trigger, so it guards every
-- change to an existing employee row but never an INSERT. HR can create
-- employees, so without this guard an HR user could create a row with the flag
-- already on and gain Flow Canvas edit rights. This trigger closes that gap.
--
-- The rule mirrors the update path:
--   * a Super Admin, or a role simulator (as prevent_role_escalation allows),
--     may insert the flag;
--   * a caller with no employee row (the service role, a migration, the policy
--     test seed) is trusted, as the rest of prevent_role_escalation trusts it;
--   * anyone else inserting with the flag on is refused with 42501.
--
-- Only adds a function and a trigger. Idempotent.
-- ==============================================================================

create or replace function public.prevent_flow_editor_on_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_caller_id                UUID;
  v_caller_is_super_admin    BOOLEAN;
  v_caller_is_role_simulator BOOLEAN;
BEGIN
  IF NEW.can_edit_sales_flows IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_caller_id := public.get_employee_id();

  -- No employee row: the service role or a migration. Trusted.
  IF v_caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT is_super_admin, is_role_simulator
  INTO   v_caller_is_super_admin, v_caller_is_role_simulator
  FROM   public.employees
  WHERE  id = v_caller_id;

  IF v_caller_is_role_simulator IS TRUE OR v_caller_is_super_admin IS TRUE THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Insufficient privileges: only a super-admin can give Flow editor access.'
    USING ERRCODE = '42501';
END;
$function$;

drop trigger if exists trg_prevent_flow_editor_on_insert on public.employees;
create trigger trg_prevent_flow_editor_on_insert
  before insert on public.employees
  for each row execute function public.prevent_flow_editor_on_insert();
