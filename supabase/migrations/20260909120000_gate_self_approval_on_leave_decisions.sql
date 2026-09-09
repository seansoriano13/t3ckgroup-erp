-- Issue #180: an ordinary employee could approve their own overtime request
-- and credit their own Offset balance, with no HR involvement and no error.
--
-- `decide_overtime_request` (and its Offset/SIL siblings) is SECURITY INVOKER,
-- so the caller's own policies govern every row it touches. Two policies lined
-- up to permit the escalation:
--
--   * `overtime_requests_update` / `offset_leaves_update` / `sil_leaves_update`
--     each permitted `employee_id = get_employee_id()` — the applicant's own
--     request row — on UPDATE. That let the applicant drive the decision.
--   * "Employees can update their own profile" covers the balance write the
--     function then makes.
--
-- Between them the function completed as the applicant, stamped a valid
-- `approval_hash`, and set `hr_processed_by` to whoever the caller named — so
-- the printed TG-11/TG-12 verified against the live record.
--
-- The applicant clause belongs on SELECT, not UPDATE: an employee needs to see
-- their own request, but nothing about the workflow requires them to decide
-- it. The `_select` policies already carry the applicant clause, so this
-- migration only narrows the `_update` policies to the HR capabilities (and
-- leaves the head-stage `_head_update` policies untouched).
--
-- Withdrawal is the one legitimate reason an applicant writes their own row.
-- `withdraw_offset_leave` and `cancel_sil_leave` are SECURITY INVOKER too, and
-- overtime withdrawal is a direct client UPDATE — all three only ever move the
-- row to CANCELLED. A dedicated `_withdraw` policy keeps exactly that path
-- open: the applicant may take an undecided request of their own to CANCELLED
-- and nothing else. This mirrors issue #137's guard_head_status_change, which
-- closed the same self-approval shape one stage earlier.

-- ---------------------------------------------------------------------
-- Narrow the decision policies to the HR capabilities only.
-- ---------------------------------------------------------------------

alter policy "overtime_requests_update" on public.overtime_requests
using (
  exists (
    select 1 from public.employees e
    where e.id = public.get_employee_id()
      and (e.is_hr or e.is_super_admin or e.can_manage_leaves)
  )
);

alter policy "offset_leaves_update" on public.offset_leaves
using (
  exists (
    select 1 from public.employees e
    where e.id = public.get_employee_id()
      and (e.is_hr or e.is_super_admin or e.can_manage_leaves)
  )
);

alter policy "sil_leaves_update" on public.sil_leaves
using (
  exists (
    select 1 from public.employees e
    where e.id = public.get_employee_id()
      and (e.is_hr or e.is_super_admin or e.can_manage_leaves)
  )
);

-- ---------------------------------------------------------------------
-- Keep the withdrawal path open: applicant -> own undecided row -> CANCELLED.
-- ---------------------------------------------------------------------

drop policy if exists "overtime_requests_withdraw" on public.overtime_requests;
create policy "overtime_requests_withdraw" on public.overtime_requests
  as permissive for update to authenticated
  using (employee_id = public.get_employee_id() and status = 'PENDING')
  with check (employee_id = public.get_employee_id() and status = 'CANCELLED');

drop policy if exists "offset_leaves_withdraw" on public.offset_leaves;
create policy "offset_leaves_withdraw" on public.offset_leaves
  as permissive for update to authenticated
  using (employee_id = public.get_employee_id() and status in ('PENDING', 'APPROVED'))
  with check (employee_id = public.get_employee_id() and status = 'CANCELLED');

drop policy if exists "sil_leaves_withdraw" on public.sil_leaves;
create policy "sil_leaves_withdraw" on public.sil_leaves
  as permissive for update to authenticated
  using (employee_id = public.get_employee_id() and status in ('PENDING', 'APPROVED'))
  with check (employee_id = public.get_employee_id() and status = 'CANCELLED');
