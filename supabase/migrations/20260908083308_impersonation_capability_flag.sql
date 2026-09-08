-- Issue #124 / #128 — replace the hardcoded impersonation email with a
-- capability flag on the employee record, revocable from the interface
-- instead of by migration.
--
-- The literal 'arkadatax03@gmail.com' appeared in two places: the
-- `employees` UPDATE RLS policy, and the role simulator in the sidebar
-- (src/components/RoleSwitcher.jsx). Both now read `is_role_simulator`.
-- Same power as before, granted to the one account that already had it, so
-- this is a no-op for what anyone can currently do.

alter table public.employees
  add column if not exists is_role_simulator boolean not null default false;

update public.employees
set is_role_simulator = true
where email = 'arkadatax03@gmail.com';

create or replace function public.is_role_simulator()
returns boolean
language sql
security definer
as $$
  select is_role_simulator from public.employees where email = auth.jwt() ->> 'email';
$$;

drop policy if exists "Allow Super Admin and HR to update employees" on public.employees;

create policy "Allow Super Admin and HR to update employees"
on public.employees
for update
using (
  is_super_admin() = true
  or is_hr() = true
  or is_role_simulator() = true
  or can_manage_leaves() = true
)
with check (
  is_super_admin() = true
  or is_hr() = true
  or is_role_simulator() = true
  or can_manage_leaves() = true
);

-- Second occurrence of the literal: the role-escalation trigger's own
-- exception clause for the tester account.
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

  -- Bypasses role escalation checks for the flagged tester/simulator account
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
