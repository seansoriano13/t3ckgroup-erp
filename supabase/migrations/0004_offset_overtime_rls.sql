-- ============================================================================
-- Migration 0004: Row Level Security (RLS) for Overtime Requests & Offset Leaves
-- ============================================================================

-- 1. Enable RLS on both tables
ALTER TABLE public.overtime_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offset_leaves ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Overtime Requests Policies
-- ----------------------------------------------------------------------------

-- SELECT: Employee can view their own requests, HR & Super Admins can view all.
DROP POLICY IF EXISTS overtime_requests_select ON public.overtime_requests;
CREATE POLICY overtime_requests_select ON public.overtime_requests
  FOR SELECT TO authenticated USING (
    employee_id = public.get_employee_id()
    OR EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = public.get_employee_id()
        AND (e.is_hr OR e.is_super_admin)
    )
  );

-- INSERT: Employee can apply for overtime for themselves.
DROP POLICY IF EXISTS overtime_requests_insert ON public.overtime_requests;
CREATE POLICY overtime_requests_insert ON public.overtime_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = public.get_employee_id()
  );

-- UPDATE: HR & Super Admins can update status and HR notes.
DROP POLICY IF EXISTS overtime_requests_update ON public.overtime_requests;
CREATE POLICY overtime_requests_update ON public.overtime_requests
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = public.get_employee_id()
        AND (e.is_hr OR e.is_super_admin)
    )
  );

-- ----------------------------------------------------------------------------
-- Offset Leaves Policies
-- ----------------------------------------------------------------------------

-- SELECT: Employee can view their own offset leaves, HR & Super Admins can view all.
DROP POLICY IF EXISTS offset_leaves_select ON public.offset_leaves;
CREATE POLICY offset_leaves_select ON public.offset_leaves
  FOR SELECT TO authenticated USING (
    employee_id = public.get_employee_id()
    OR EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = public.get_employee_id()
        AND (e.is_hr OR e.is_super_admin)
    )
  );

-- INSERT: Employee can apply for offset leave for themselves.
DROP POLICY IF EXISTS offset_leaves_insert ON public.offset_leaves;
CREATE POLICY offset_leaves_insert ON public.offset_leaves
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = public.get_employee_id()
  );

-- UPDATE: HR & Super Admins can update status and HR notes.
DROP POLICY IF EXISTS offset_leaves_update ON public.offset_leaves;
CREATE POLICY offset_leaves_update ON public.offset_leaves
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = public.get_employee_id()
        AND (e.is_hr OR e.is_super_admin)
    )
  );
