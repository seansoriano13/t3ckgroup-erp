-- 1. Relax CHECK constraint on overtime_requests to allow CANCELLED
ALTER TABLE public.overtime_requests DROP CONSTRAINT IF EXISTS overtime_requests_status_check;
ALTER TABLE public.overtime_requests ADD CONSTRAINT overtime_requests_status_check CHECK (status IN ('PENDING', 'APPROVED_PAID', 'APPROVED_OFFSET', 'REJECTED', 'CANCELLED'));

-- 2. Relax CHECK constraint on offset_leaves to allow CANCELLED
ALTER TABLE public.offset_leaves DROP CONSTRAINT IF EXISTS offset_leaves_status_check;
ALTER TABLE public.offset_leaves ADD CONSTRAINT offset_leaves_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'));

-- 3. Update offset_leaves SELECT policy to allow all authenticated users to read APPROVED leaves (for the global calendar)
DROP POLICY IF EXISTS offset_leaves_select ON public.offset_leaves;
CREATE POLICY offset_leaves_select ON public.offset_leaves
  FOR SELECT TO authenticated USING (
    employee_id = public.get_employee_id()
    OR status = 'APPROVED'
    OR EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = public.get_employee_id()
        AND (e.is_hr OR e.is_super_admin)
    )
  );

-- 4. Allow employees to update their own requests (specifically needed so they can withdraw/cancel)
DROP POLICY IF EXISTS overtime_requests_update ON public.overtime_requests;
CREATE POLICY overtime_requests_update ON public.overtime_requests
  FOR UPDATE TO authenticated USING (
    employee_id = public.get_employee_id()
    OR EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = public.get_employee_id()
        AND (e.is_hr OR e.is_super_admin)
    )
  );

DROP POLICY IF EXISTS offset_leaves_update ON public.offset_leaves;
CREATE POLICY offset_leaves_update ON public.offset_leaves
  FOR UPDATE TO authenticated USING (
    employee_id = public.get_employee_id()
    OR EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = public.get_employee_id()
        AND (e.is_hr OR e.is_super_admin)
    )
  );
