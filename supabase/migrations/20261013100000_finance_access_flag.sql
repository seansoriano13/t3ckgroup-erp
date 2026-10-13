-- ==============================================================================
-- 20261013100000_finance_access_flag.sql
--
-- Issue #242 (IPAS, spec #241) — Finance access, and who may grant it.
--
-- `employees.has_finance_flow` sits beside `has_purchasing_flow` and is granted
-- the same way: a toggle in the employee form, by HR or a Super Admin. It is a
-- stored boolean on purpose and is never inferred from department text.
-- Finance access reads every IPAS, records payments and charges, and sees bank
-- details (the IPAS tables arrive in 20261013100100).
--
-- THE SELF-GRANT HOLE THIS CLOSES
-- "Employees can update their own profile" lets any signed-in employee update
-- their own `employees` row, and `prevent_role_escalation()` only protected
-- is_super_admin / is_hr / is_head / can_manage_leaves / can_edit_sales_flows /
-- hidden_nav_keys. Any employee could therefore have set their own
-- `has_purchasing_flow`, and would have been able to set `has_finance_flow`,
-- which unlocks bank account numbers. Both flags are now changed only by a
-- Super Admin or HR, and HR cannot change their own (a Super Admin can).
--
-- A change by anyone else is reverted silently, the way is_hr and is_head are,
-- so an ordinary profile save that happens to carry the old values back is not
-- an error. A caller with no employee row (the service role, a migration, the
-- seed scripts) is trusted: no signed-in employee reaches that branch, because
-- every `employees` update policy needs an employee row to match.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: one new
-- NOT NULL DEFAULT false column, new helper function, and one
-- `create or replace` that only narrows who may change two flags. Idempotent.
-- ==============================================================================

alter table public.employees
  add column if not exists has_finance_flow boolean not null default false;

comment on column public.employees.has_finance_flow is
  'Finance access (IPAS, #241): reads every IPAS, records payments and charges, sees bank details. Granted per employee by HR or a Super Admin, never inferred from department text. Enforced by ipas_can_read() and the IPAS policies; changed only through prevent_role_escalation().';

create or replace function public.has_finance_access()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = get_employee_id()
      and e.has_finance_flow
      and not coalesce(e.is_deleted, false)
  );
$$;

comment on function public.has_finance_access() is
  '#242: whether the caller holds Finance access (employees.has_finance_flow) and is not soft-deleted. Not satisfied by Super Admin; mirrors has_purchasing_access().';

grant execute on function public.has_finance_access() to authenticated;

-- Extends the role-escalation trigger (prior shape in
-- 20260922000000_can_edit_sales_flows.sql) with the Purchasing and Finance
-- access flags. Every earlier rule is kept as it was.
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

  -- Purchasing and Finance access (#242). Only a Super Admin or HR grants
  -- them, and HR cannot grant themselves (a Super Admin may). A caller with no
  -- employee row is the service role or a migration, and is trusted.
  IF v_caller_id IS NOT NULL
     AND (
       NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE)
       OR (OLD.id = v_caller_id AND NOT (v_caller_is_super_admin IS TRUE))
     )
  THEN
    IF NEW.has_purchasing_flow IS DISTINCT FROM OLD.has_purchasing_flow THEN
      NEW.has_purchasing_flow := OLD.has_purchasing_flow;
    END IF;
    IF NEW.has_finance_flow IS DISTINCT FROM OLD.has_finance_flow THEN
      NEW.has_finance_flow := OLD.has_finance_flow;
    END IF;
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
