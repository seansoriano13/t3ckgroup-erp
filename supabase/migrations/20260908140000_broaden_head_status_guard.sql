-- Code review fix for issue #139: guard_head_status_change (migration
-- 20260908090000_department_head_approval_stage.sql) only fired when
-- head_status was becoming APPROVED. The existing owner-update RLS policy
-- already lets an employee UPDATE their own leave/offset/overtime row, so an
-- employee could self-write head_status = 'REJECTED', or forge head_note /
-- head_decided_at / head_signature_version, on their OWN application without
-- being the actual routed head — the trigger simply never looked at those
-- writes. That's the core abuse case #139 asks to close: "an ordinary
-- employee cannot record a head decision on their own application", not
-- merely "cannot self-approve".
--
-- Fix: the guard now fires whenever ANY of the four decision columns change
-- (head_status, head_note, head_decided_at, head_signature_version), and
-- blocks unless the actor is the row's routed head, HR, or a super admin —
-- same actor check as before, just no longer scoped to the APPROVED
-- direction only.
--
-- head_id is deliberately left out of the guarded set: the applicant
-- choosing/overriding their own head when creating or editing their OWN
-- (still-PENDING) application is a legitimate write to head_id (issue #138)
-- and must keep working unguarded here. HR's own decision columns
-- (hr_processed_by, hr_notes, etc.) are untouched by this trigger, same as
-- before.
--
-- This is an RLS-adjacent permission trigger: it branches on who the caller
-- is (is_hr()/is_super_admin()/is_head()/get_employee_id()), which the fake
-- database used by the unit suite has no notion of (see
-- src/test/db/triggers.js and docs/testing.md's "Known limitations of the
-- fake" — permission triggers are deliberately unmirrored there). Its
-- effect is provable only against a real database, not by `npm run
-- test:unit` / `test:integration`.

CREATE OR REPLACE FUNCTION public.guard_head_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
BEGIN
  IF (
       NEW.head_status IS DISTINCT FROM OLD.head_status
       OR NEW.head_note IS DISTINCT FROM OLD.head_note
       OR NEW.head_decided_at IS DISTINCT FROM OLD.head_decided_at
       OR NEW.head_signature_version IS DISTINCT FROM OLD.head_signature_version
     )
     AND NOT (
       public.is_hr() OR public.is_super_admin()
       OR (public.is_head() AND OLD.head_id = public.get_employee_id())
     )
  THEN
    RAISE EXCEPTION 'Only the routed department head, HR, or a super admin may record a head decision on this request.';
  END IF;
  RETURN NEW;
END;
$$;
