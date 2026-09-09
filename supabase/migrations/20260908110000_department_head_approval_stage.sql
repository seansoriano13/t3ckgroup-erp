-- Issue #137 (with #138-141): adds a department-head approval stage ahead of
-- HR's decision on sil_leaves, offset_leaves and overtime_requests.
--
-- Each table gets:
--   head_id                 the head routed to decide this request
--   head_status             PENDING | APPROVED | REJECTED (default APPROVED,
--                            see backfill note below)
--   head_note               the head's own note, distinct from hr_notes
--   head_decided_at         when the head recorded their decision
--   head_signature_version  mirrors hr_signature_version/employee_signature_
--                            version's pattern: the signature_path snapshot
--                            used on the printed form
--   hr_override             HR can bypass a missing/rejected head decision;
--                            this records that they knowingly did so
--
-- Backfill: every row that exists before this migration predates the head
-- stage entirely, so it is treated as already cleared rather than stuck
-- PENDING forever — hence DEFAULT 'APPROVED'. Postgres populates existing
-- rows with a column's DEFAULT when it is added NOT NULL, so no separate
-- UPDATE is needed; the explicit UPDATE below is kept anyway as a defensive
-- backfill in case any row was inserted mid-migration outside the DDL's
-- transaction (e.g. logical replication) and to make the intent explicit.
--
-- RLS: is_head() may SELECT and UPDATE rows whose head_id names them,
-- alongside the existing employee/HR access. A row's own employee (an
-- "ordinary employee" deciding their own request) can still update other
-- columns on their own row per the existing policies, but a BEFORE UPDATE
-- trigger (guard_head_status_change) refuses any UPDATE that moves
-- head_status to APPROVED unless the actor is the routed head, HR, or a
-- super admin — closing the gap where an employee could otherwise
-- self-approve their own head stage by writing the column directly.

-- ---------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------

ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS head_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS head_status text NOT NULL DEFAULT 'APPROVED';
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS head_note text;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS head_decided_at timestamptz;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS head_signature_version text;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS hr_override boolean NOT NULL DEFAULT false;

ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS head_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS head_status text NOT NULL DEFAULT 'APPROVED';
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS head_note text;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS head_decided_at timestamptz;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS head_signature_version text;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS hr_override boolean NOT NULL DEFAULT false;

ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS head_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS head_status text NOT NULL DEFAULT 'APPROVED';
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS head_note text;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS head_decided_at timestamptz;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS head_signature_version text;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS hr_override boolean NOT NULL DEFAULT false;

ALTER TABLE public.sil_leaves
  ADD CONSTRAINT sil_leaves_head_status_check
    CHECK (head_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text]));
ALTER TABLE public.offset_leaves
  ADD CONSTRAINT offset_leaves_head_status_check
    CHECK (head_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text]));
ALTER TABLE public.overtime_requests
  ADD CONSTRAINT overtime_requests_head_status_check
    CHECK (head_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text]));

-- Defensive backfill (see note above) — a no-op under normal DDL semantics.
UPDATE public.sil_leaves SET head_status = 'APPROVED' WHERE head_status IS NULL;
UPDATE public.offset_leaves SET head_status = 'APPROVED' WHERE head_status IS NULL;
UPDATE public.overtime_requests SET head_status = 'APPROVED' WHERE head_status IS NULL;

CREATE INDEX IF NOT EXISTS sil_leaves_head_id_idx ON public.sil_leaves USING btree (head_id);
CREATE INDEX IF NOT EXISTS offset_leaves_head_id_idx ON public.offset_leaves USING btree (head_id);
CREATE INDEX IF NOT EXISTS overtime_requests_head_id_idx ON public.overtime_requests USING btree (head_id);

-- ---------------------------------------------------------------------
-- Guard trigger: only the routed head, HR, or a super admin may move
-- head_status to APPROVED. Everything else about a row (hr fields, the
-- employee's own edits while PENDING, etc) is left to the existing
-- policies/application logic — this only closes the self-approval gap.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_head_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.head_status IS DISTINCT FROM OLD.head_status
     AND NEW.head_status = 'APPROVED'
     AND NOT (
       public.is_hr() OR public.is_super_admin()
       OR (public.is_head() AND OLD.head_id = public.get_employee_id())
     )
  THEN
    RAISE EXCEPTION 'Only the routed department head, HR, or a super admin may approve the head stage.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sil_leaves_guard_head_status ON public.sil_leaves;
CREATE TRIGGER sil_leaves_guard_head_status
  BEFORE UPDATE ON public.sil_leaves
  FOR EACH ROW EXECUTE FUNCTION public.guard_head_status_change();

DROP TRIGGER IF EXISTS offset_leaves_guard_head_status ON public.offset_leaves;
CREATE TRIGGER offset_leaves_guard_head_status
  BEFORE UPDATE ON public.offset_leaves
  FOR EACH ROW EXECUTE FUNCTION public.guard_head_status_change();

DROP TRIGGER IF EXISTS overtime_requests_guard_head_status ON public.overtime_requests;
CREATE TRIGGER overtime_requests_guard_head_status
  BEFORE UPDATE ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_head_status_change();

-- ---------------------------------------------------------------------
-- RLS: let a head SELECT/UPDATE rows routed to them, in addition to the
-- existing employee/HR access those tables already grant.
-- ---------------------------------------------------------------------

CREATE POLICY "sil_leaves_head_select" ON public."sil_leaves"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (head_id = public.get_employee_id());
CREATE POLICY "sil_leaves_head_update" ON public."sil_leaves"
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (head_id = public.get_employee_id());

CREATE POLICY "offset_leaves_head_select" ON public."offset_leaves"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (head_id = public.get_employee_id());
CREATE POLICY "offset_leaves_head_update" ON public."offset_leaves"
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (head_id = public.get_employee_id());

CREATE POLICY "overtime_requests_head_select" ON public."overtime_requests"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (head_id = public.get_employee_id());
CREATE POLICY "overtime_requests_head_update" ON public."overtime_requests"
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (head_id = public.get_employee_id());
