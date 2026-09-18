-- Issue #108: approving, undoing, or withdrawing an overtime request was a
-- client-orchestrated sequence of separate writes (read the balance, compute
-- a new figure in JavaScript, update the row, update the balance to that
-- absolute value). Three bugs shared that one cause:
--
--   1. Two officers deciding two different overtime requests for the same
--      employee each computed their new balance from a stale JS-side read,
--      so one movement could be silently lost.
--   2. Undoing an APPROVED_OFFSET decision clamped the deduction at zero
--      instead of refusing when the credited hours were already spent
--      elsewhere, which invented hours the employee never gave back.
--   3. The undo path cleared the approval hash, HR signature and credits
--      snapshot but forgot `hr_processed_by`, leaving a PENDING record that
--      still named the officer who decided (and un-decided) it.
--
-- decide_overtime_request and undo_overtime_decision fold each decision into
-- one Postgres function so the row update and the balance update commit
-- together or not at all. Locking the employee row with `SELECT ... FOR
-- UPDATE` before the balance is read is what fixes (1): a second decision
-- for the same employee blocks until the first one commits, instead of
-- reading a balance the first is about to change.
--
-- The approval hash and HR signature are computed here, in SQL, rather than
-- in JavaScript beforehand (see ADR 0013). The value they must commit to —
-- the balance *after* this decision lands — is only known once this
-- function holds the employee-row lock, so computing it any earlier would
-- risk hashing a number a concurrent decision could still change. This is
-- the pattern issues #109 (Offset) and #110 (SIL) are expected to follow.
--
-- (2) is fixed by undo_overtime_decision raising instead of clamping when
-- the deduction would take the balance negative. (3) is fixed by the undo's
-- UPDATE clearing hr_processed_by alongside the hash/signature/snapshot,
-- matching how undoOffsetLeaveDecision and undoSilLeaveDecision already do it.

CREATE OR REPLACE FUNCTION public.decide_overtime_request(
  p_request_id uuid,
  p_status text,
  p_approved_hours numeric,
  p_hr_notes text,
  p_hr_id uuid
)
RETURNS overtime_requests
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_request overtime_requests;
  v_is_decision boolean;
  v_approved_hours numeric;
  v_balance numeric;
  v_new_balance numeric;
  v_credits_snapshot numeric;
  v_canon_credits text;
  v_approval_hash text;
  v_hr_signature_version text;
  v_hr_signature_timestamp timestamptz;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_request FROM overtime_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Overtime request not found.';
  END IF;

  v_is_decision := p_status LIKE 'APPROVED%' OR p_status = 'REJECTED';

  IF p_status LIKE 'APPROVED%' THEN
    v_approved_hours := COALESCE(p_approved_hours, v_request.hours);
    IF NOT (v_approved_hours > 0) THEN
      RAISE EXCEPTION 'Approved hours must be greater than zero.';
    END IF;
  END IF;

  -- Lock the employee row before reading the balance: this is what
  -- serializes two officers deciding two different requests for the same
  -- employee instead of letting them race.
  IF p_status = 'APPROVED_OFFSET' THEN
    SELECT offset_hours_balance INTO v_balance FROM employees WHERE id = v_request.employee_id FOR UPDATE;
    v_new_balance := COALESCE(v_balance, 0) + v_approved_hours;
    v_credits_snapshot := v_new_balance;
  END IF;

  SELECT signature_path INTO v_hr_signature_version FROM employees WHERE id = p_hr_id;
  IF v_hr_signature_version IS NOT NULL THEN
    v_hr_signature_timestamp := v_now;
  END IF;

  -- Mirrors verify_form_token's approval-hash formula byte-for-byte (see
  -- src/utils/formHashes.js's canonicalNumber, which trim_scale(round(_,2))
  -- is designed to match) so a printed form generated from this decision
  -- verifies the same way every other record type's does.
  IF v_is_decision THEN
    v_canon_credits := CASE WHEN v_credits_snapshot IS NULL THEN '' ELSE trim_scale(round(v_credits_snapshot, 2))::text END;
    v_approval_hash := encode(digest(
      format('%s|%s|%s|%s', v_request.application_hash, p_status, COALESCE(p_hr_id::text, ''), v_canon_credits),
      'sha256'), 'hex');
  END IF;

  UPDATE overtime_requests SET
    status = p_status,
    approved_hours = v_approved_hours,
    hr_notes = p_hr_notes,
    updated_at = v_now,
    approval_hash = v_approval_hash,
    hr_signature_version = v_hr_signature_version,
    hr_signature_timestamp = v_hr_signature_timestamp,
    approval_credits_snapshot = v_credits_snapshot,
    hr_processed_by = p_hr_id
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  IF p_status = 'APPROVED_OFFSET' THEN
    UPDATE employees SET offset_hours_balance = v_new_balance, updated_at = v_now WHERE id = v_request.employee_id;
  END IF;

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_overtime_decision(
  p_request_id uuid,
  p_hr_id uuid
)
RETURNS overtime_requests
LANGUAGE plpgsql
AS $$
DECLARE
  v_request overtime_requests;
  v_credited numeric;
  v_balance numeric;
  v_new_balance numeric;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_request FROM overtime_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Overtime request not found.';
  END IF;
  IF v_request.status = 'PENDING' THEN
    RAISE EXCEPTION 'Request is already pending.';
  END IF;

  IF v_request.status = 'APPROVED_OFFSET' THEN
    v_credited := COALESCE(v_request.approved_hours, v_request.hours, 0);

    -- Same lock-before-read as decide_overtime_request, so this can't
    -- compute its deduction from a balance a concurrent decision on another
    -- request for this employee is about to change.
    SELECT offset_hours_balance INTO v_balance FROM employees WHERE id = v_request.employee_id FOR UPDATE;
    v_new_balance := COALESCE(v_balance, 0) - v_credited;

    -- Refuse rather than clamp at zero: clamping would silently invent hours
    -- the employee never gave back once the credit had already been spent.
    IF v_new_balance < 0 THEN
      RAISE EXCEPTION 'Cannot undo: this would deduct % hrs, but only % hrs remain on the balance.',
        trim_scale(round(v_credited, 2)), trim_scale(round(COALESCE(v_balance, 0), 2));
    END IF;

    UPDATE employees SET offset_hours_balance = v_new_balance, updated_at = v_now WHERE id = v_request.employee_id;
  END IF;

  UPDATE overtime_requests SET
    status = 'PENDING',
    approved_hours = NULL,
    hr_notes = NULL,
    updated_at = v_now,
    approval_hash = NULL,
    hr_signature_version = NULL,
    hr_signature_timestamp = NULL,
    approval_credits_snapshot = NULL,
    hr_processed_by = NULL
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;
