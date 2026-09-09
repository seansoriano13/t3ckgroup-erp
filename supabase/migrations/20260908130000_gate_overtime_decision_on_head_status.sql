-- Code review fix for issue #137: handleOvertimeDecision (offsetService.js)
-- was doing a client-side `SELECT head_status, hr_override` followed by
-- assertHeadCleared(...) BEFORE calling decide_overtime_request. That
-- reintroduced exactly the check-then-act race ADR 0013 removed — a second
-- decision could land between the client's read and the RPC's row lock.
--
-- The fix folds the gate into decide_overtime_request itself, after the
-- function has already taken `FOR UPDATE` on the request row, so the check
-- and the decision now share one lock instead of racing across two
-- round-trips. A request routed to no head at all reads head_status as
-- 'APPROVED' (the column's own DEFAULT — see migration
-- 20260908110000_department_head_approval_stage.sql's backfill note), so
-- `head_status != 'APPROVED'` alone correctly lets those through without a
-- separate "no head" branch.
--
-- REJECTED is left ungated, matching assertHeadCleared's own scope: it only
-- guards APPROVED-family decisions (see handleOvertimeDecision's callers),
-- so a request can still be rejected outright without waiting on the head.

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

  -- Same lock this function already holds on the row — the gate and the
  -- decision it guards can no longer be split across two round-trips.
  IF p_status LIKE 'APPROVED%' AND v_request.head_status <> 'APPROVED' AND NOT v_request.hr_override THEN
    RAISE EXCEPTION 'Cannot approve this overtime request: the department head has not approved this request yet (head_status=%). Use the HR override if this needs to proceed anyway.', v_request.head_status;
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
