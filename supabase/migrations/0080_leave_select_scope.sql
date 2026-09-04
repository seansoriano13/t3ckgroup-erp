-- ==============================================================================
-- 0080_leave_select_scope.sql
--
-- Ticket #77: offset_leaves_select and sil_leaves_select let ANY signed-in
-- employee read ANY other employee's APPROVED record (the bare
-- `status = 'APPROVED'` OR-branch), reason and attachments included — not
-- just a summary. That's what let an unrelated employee pull someone else's
-- medical reason through the verification page's authenticated branch.
--
-- Scope SELECT to: the record's own employee, or HR / Super Admin / a
-- leave-management capability holder (who needs read access to actually work
-- the approval queue #61 built them for).
-- ==============================================================================

DROP POLICY IF EXISTS offset_leaves_select ON public.offset_leaves;
CREATE POLICY offset_leaves_select ON public.offset_leaves
  FOR SELECT
  USING (
    (employee_id = get_employee_id())
    OR (EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = get_employee_id() AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves)
    ))
  );

DROP POLICY IF EXISTS sil_leaves_select ON public.sil_leaves;
CREATE POLICY sil_leaves_select ON public.sil_leaves
  FOR SELECT
  USING (
    (employee_id = get_employee_id())
    OR (EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = get_employee_id() AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves)
    ))
  );
