-- ==============================================================================
-- 20261124000000_employee_insert_privilege_guard.sql
--
-- Issue #884 (part of #878 / #907): the insert guard for employee privilege
-- flags now covers every flag the update guard protects, not only the Flow
-- editor flag added in 20261123000000.
--
-- prevent_role_escalation() is BEFORE UPDATE only, so a new employee row could
-- be created already holding a flag that only a Super Admin may grant. This
-- replaces prevent_flow_editor_on_insert() with prevent_privileged_flags_on_insert(),
-- which mirrors the update rules:
--   * is_super_admin = true: only a Super Admin may grant it (the update path
--     refuses the false-to-true change for HR too);
--   * can_manage_leaves = true: only a Super Admin may set it (the update path
--     refuses any change from anyone else);
--   * can_edit_sales_flows = true: only a Super Admin may set it (as before).
-- A role simulator passes, as it does on update. A caller with no employee row
-- (the service role, a migration, the policy test seed) is trusted, as the rest
-- of prevent_role_escalation trusts it.
--
-- Idempotent.
-- ==============================================================================

drop trigger if exists trg_prevent_flow_editor_on_insert on public.employees;
drop function if exists public.prevent_flow_editor_on_insert();

create or replace function public.prevent_privileged_flags_on_insert()
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
  IF NEW.is_super_admin IS NOT TRUE
     AND NEW.can_manage_leaves IS NOT TRUE
     AND NEW.can_edit_sales_flows IS NOT TRUE
  THEN
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

  IF NEW.is_super_admin IS TRUE THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can create a super-admin.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_manage_leaves IS TRUE THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can set leave-management access.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_edit_sales_flows IS TRUE THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can give Flow editor access.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

drop trigger if exists trg_prevent_privileged_flags_on_insert on public.employees;
create trigger trg_prevent_privileged_flags_on_insert
  before insert on public.employees
  for each row execute function public.prevent_privileged_flags_on_insert();
