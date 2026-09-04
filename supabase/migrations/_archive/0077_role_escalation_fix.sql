-- ==============================================================================
-- 0077_role_escalation_fix.sql
--
-- Ticket #72: prevent_role_escalation resolves the caller via
-- `employees.id = auth.uid()`, but in this schema employees.id and
-- auth.users.id are different id spaces (zero of 45 employee rows match by
-- id). That silently blinds every branch of the trigger, including the one
-- meant to narrow a capability-only holder's write to just the two leave
-- balances, and refuses every Super Admin can_manage_leaves grant/revoke.
--
-- Fix: resolve the caller with get_employee_id(), the helper every other
-- policy/function in this migration set already uses. Also gives the
-- "Allow Super Admin and HR to update employees" policy an explicit
-- WITH CHECK matching its USING clause — without one, Postgres reuses USING
-- as the check, which means the trigger's column-scoping was the only thing
-- narrowing a capability holder's write, and that enforcement was silently
-- off for the same reason above.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id                UUID;
  v_caller_is_super_admin    BOOLEAN;
  v_caller_is_hr             BOOLEAN;
  v_caller_can_manage_leaves BOOLEAN;
BEGIN
  v_caller_id := public.get_employee_id();

  SELECT is_super_admin, is_hr, can_manage_leaves
  INTO   v_caller_is_super_admin, v_caller_is_hr, v_caller_can_manage_leaves
  FROM   public.employees
  WHERE  id = v_caller_id;

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

DROP POLICY IF EXISTS "Allow Super Admin and HR to update employees" ON public.employees;
CREATE POLICY "Allow Super Admin and HR to update employees" ON public.employees
  FOR UPDATE
  USING (
    (is_super_admin() = true) OR (is_hr() = true) OR (email = 'arkadatax03@gmail.com'::text) OR (can_manage_leaves() = true)
  )
  WITH CHECK (
    (is_super_admin() = true) OR (is_hr() = true) OR (email = 'arkadatax03@gmail.com'::text) OR (can_manage_leaves() = true)
  );
