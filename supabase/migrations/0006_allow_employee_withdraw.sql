-- Allow employees to update their own requests (specifically needed so they can withdraw/cancel)

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
