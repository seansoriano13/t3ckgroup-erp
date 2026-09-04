-- ==============================================================================
-- 0071_leave_management_capability.sql
--
-- Ticket #61: HR Assistants cannot reach Leaves Manager today because only
-- the HR head carries `is_hr`, and `is_hr` is deliberately not reused for
-- this — in production it also grants unscoped INSERT/UPDATE on every
-- employee row. `can_manage_leaves` is a narrower, dedicated capability.
-- ==============================================================================

alter table public.employees add column if not exists can_manage_leaves boolean not null default false;

-- Caller-lookup helper, mirroring is_hr()/is_super_admin() below. Needed
-- because inside the employees table's OWN policies, an unqualified
-- `can_manage_leaves` would mean the TARGET row, not the caller.
create or replace function public.can_manage_leaves()
returns boolean
language sql
security definer
as $function$
  SELECT can_manage_leaves FROM public.employees WHERE email = auth.jwt() ->> 'email';
$function$;

-- A capability holder may reach another employee's row (to move a leave
-- balance while approving); the role-escalation trigger below is what
-- actually restricts which columns they may change once they're in.
alter policy "Allow Super Admin and HR to update employees" on public.employees
using (
  (is_super_admin() = true)
  or (is_hr() = true)
  or (email = 'arkadatax03@gmail.com'::text)
  or (can_manage_leaves() = true)
);

-- Leave/overtime queues: a capability holder works the same queue is_hr does.
alter policy "offset_leaves_select" on public.offset_leaves
using (
  (employee_id = get_employee_id())
  or (status = 'APPROVED'::text)
  or (exists (select 1 from employees e where e.id = get_employee_id() and (e.is_hr or e.is_super_admin or e.can_manage_leaves)))
);

alter policy "offset_leaves_update" on public.offset_leaves
using (
  (employee_id = get_employee_id())
  or (exists (select 1 from employees e where e.id = get_employee_id() and (e.is_hr or e.is_super_admin or e.can_manage_leaves)))
);

alter policy "overtime_requests_select" on public.overtime_requests
using (
  (employee_id = get_employee_id())
  or (exists (select 1 from employees e where e.id = get_employee_id() and (e.is_hr or e.is_super_admin or e.can_manage_leaves)))
);

alter policy "overtime_requests_update" on public.overtime_requests
using (
  (employee_id = get_employee_id())
  or (exists (select 1 from employees e where e.id = get_employee_id() and (e.is_hr or e.is_super_admin or e.can_manage_leaves)))
);

alter policy "sil_leaves_select" on public.sil_leaves
using (
  (employee_id = get_employee_id())
  or (status = 'APPROVED'::text)
  or (exists (select 1 from employees e where e.id = get_employee_id() and (e.is_hr or e.is_super_admin or e.can_manage_leaves)))
);

alter policy "sil_leaves_update" on public.sil_leaves
using (
  (employee_id = get_employee_id())
  or (exists (select 1 from employees e where e.id = get_employee_id() and (e.is_hr or e.is_super_admin or e.can_manage_leaves)))
);

-- Role-escalation trigger: `can_manage_leaves` is protected the same way
-- `is_super_admin` already is (only a super-admin may flip it — even an HR
-- user, who can already freely toggle is_hr/is_head on anyone, must not be
-- able to hand out this narrower capability). It also column-scopes what a
-- capability-only caller (not also HR/super-admin) may touch on a DIFFERENT
-- employee's row: just the two leave balances an approval moves, and
-- updated_at. Everything else reverts to its prior value, exactly like the
-- role-flag freeze below already does for is_super_admin/is_hr/is_head.
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_caller_is_super_admin    BOOLEAN;
  v_caller_is_hr             BOOLEAN;
  v_caller_can_manage_leaves BOOLEAN;
BEGIN
  SELECT is_super_admin, is_hr, can_manage_leaves
  INTO   v_caller_is_super_admin, v_caller_is_hr, v_caller_can_manage_leaves
  FROM   public.employees
  WHERE  id = auth.uid();

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
     AND OLD.id IS DISTINCT FROM auth.uid()
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

-- Seed the two current HR Assistants: sub-department HR, not OJT, and not
-- already privileged (the head already has full access via is_hr/is_head).
-- A one-time application of the documented rule, never evaluated at runtime.
--
-- The trigger just installed above is disabled for this one statement: a
-- migration runs with no authenticated caller (auth.uid() is null), which
-- the trigger correctly treats as "not a super-admin" and refuses.
alter table public.employees disable trigger trg_prevent_role_escalation;

update public.employees
set can_manage_leaves = true
where sub_department = 'HR'
  and employment_status is distinct from 'OJT'
  and is_hr = false
  and is_super_admin = false;

alter table public.employees enable trigger trg_prevent_role_escalation;
