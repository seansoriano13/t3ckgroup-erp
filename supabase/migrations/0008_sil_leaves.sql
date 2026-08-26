-- ============================================================================
-- Migration 0008: SIL Leaves & Employment Status Tag
-- ============================================================================

-- 1. Alter employees table to add new columns
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employment_status TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS sil_hours_balance NUMERIC DEFAULT 0;

-- 2. Create sil_leaves table
CREATE TABLE IF NOT EXISTS public.sil_leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  hours NUMERIC NOT NULL CHECK (hours > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  hr_notes TEXT,
  hr_processed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  hr_processed_at TIMESTAMPTZ
);

-- 3. Enable RLS on sil_leaves
ALTER TABLE public.sil_leaves ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for sil_leaves

-- SELECT: Employee can view their own SIL leaves, HR & Super Admins can view all. APPROVED leaves visible to all for calendar.
DROP POLICY IF EXISTS sil_leaves_select ON public.sil_leaves;
CREATE POLICY sil_leaves_select ON public.sil_leaves
  FOR SELECT TO authenticated USING (
    employee_id = public.get_employee_id()
    OR status = 'APPROVED'
    OR EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = public.get_employee_id()
        AND (e.is_hr OR e.is_super_admin)
    )
  );

-- INSERT: Employee can apply for SIL leave for themselves.
DROP POLICY IF EXISTS sil_leaves_insert ON public.sil_leaves;
CREATE POLICY sil_leaves_insert ON public.sil_leaves
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = public.get_employee_id()
  );

-- UPDATE: Employees can cancel their own, HR & Super Admins can update status and HR notes.
DROP POLICY IF EXISTS sil_leaves_update ON public.sil_leaves;
CREATE POLICY sil_leaves_update ON public.sil_leaves
  FOR UPDATE TO authenticated USING (
    employee_id = public.get_employee_id()
    OR EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = public.get_employee_id()
        AND (e.is_hr OR e.is_super_admin)
    )
  );
