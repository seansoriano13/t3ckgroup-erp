-- HR files overtime / offset / SIL / undertime on an employee's behalf through
-- ApplyLeaveModal's `showEmployeeSelector` path (issue #107). That path sets the
-- row's `employee_id` to the selected employee, not the HR user filing it.
--
-- The four `_insert` policies only ever permitted `employee_id = get_employee_id()`
-- -- a self-application -- so every HR-on-behalf-of submission failed with
-- "new row violates row-level security policy". The matching `_select` and
-- `_update` policies already carry the HR-capability clause
-- (is_hr / is_super_admin / can_manage_leaves); INSERT was the one that never got it.
--
-- Widen the four `_insert` WITH CHECK clauses to the same capability set, so an
-- HR user may create a request row for any employee while an ordinary employee
-- is still confined to their own.

alter policy "overtime_requests_insert" on public.overtime_requests
with check (
  employee_id = public.get_employee_id()
  or exists (
    select 1 from public.employees e
    where e.id = public.get_employee_id()
      and (e.is_hr or e.is_super_admin or e.can_manage_leaves)
  )
);

alter policy "offset_leaves_insert" on public.offset_leaves
with check (
  employee_id = public.get_employee_id()
  or exists (
    select 1 from public.employees e
    where e.id = public.get_employee_id()
      and (e.is_hr or e.is_super_admin or e.can_manage_leaves)
  )
);

alter policy "sil_leaves_insert" on public.sil_leaves
with check (
  employee_id = public.get_employee_id()
  or exists (
    select 1 from public.employees e
    where e.id = public.get_employee_id()
      and (e.is_hr or e.is_super_admin or e.can_manage_leaves)
  )
);

alter policy "undertime_requests_insert" on public.undertime_requests
with check (
  employee_id = public.get_employee_id()
  or exists (
    select 1 from public.employees e
    where e.id = public.get_employee_id()
      and (e.is_hr or e.is_super_admin or e.can_manage_leaves)
  )
);
