-- #614 (spec #609): OT and Offset record when HR validated them.
-- They used to borrow updated_at, which moves whenever the row changes
-- (printing stamps it). SIL and undertime already carry hr_processed_at.

alter table public.overtime_requests add column if not exists hr_processed_at timestamptz;
alter table public.offset_leaves add column if not exists hr_processed_at timestamptz;

-- Backfill decided rows from the HR signature timestamp where it exists.
update public.overtime_requests
   set hr_processed_at = hr_signature_timestamp
 where hr_processed_at is null and hr_signature_timestamp is not null and status <> 'PENDING';
update public.offset_leaves
   set hr_processed_at = hr_signature_timestamp
 where hr_processed_at is null and hr_signature_timestamp is not null and status <> 'PENDING';

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
    hr_processed_at = CASE WHEN p_status = 'REJECTED' OR p_status LIKE 'APPROVED%' THEN v_now ELSE NULL END,
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
    hr_processed_at = NULL,
    approval_credits_snapshot = NULL,
    hr_processed_by = NULL
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_offset_leave_decision(
  p_group_id uuid,
  p_status text,
  p_hr_notes text,
  p_hr_id uuid,
  p_approved_hours numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_employee_id uuid;
  v_application_hash text;
  v_row_count integer;
  v_pending_count integer;
  v_total_hours numeric;
  v_approved_hours numeric := NULL;
  v_head_status text;
  v_hr_override boolean;
  v_dates date[];
  v_balance numeric;
  v_new_balance numeric := NULL;
  v_credits_snapshot numeric := NULL;
  v_canon_credits text;
  v_approval_hash text;
  v_hr_signature_version text;
  v_hr_signature_timestamp timestamptz;
  v_now timestamptz := now();
BEGIN
  IF p_status NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Unsupported offset leave decision: %.', p_status;
  END IF;

  -- Lock the whole group first, in a stable order, so everything read below
  -- describes a group no concurrent decision can be halfway through changing.
  PERFORM 1 FROM offset_leaves WHERE leave_group_id = p_group_id ORDER BY id FOR UPDATE;

  SELECT count(*), count(*) FILTER (WHERE status = 'PENDING'), COALESCE(sum(hours), 0), array_agg(date ORDER BY date)
    INTO v_row_count, v_pending_count, v_total_hours, v_dates
    FROM offset_leaves WHERE leave_group_id = p_group_id;

  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'Leave application not found.';
  END IF;

  -- Every row in the group must still be pending. A decided group is not
  -- re-decidable: without this, two officers approving the same leave at once
  -- would each deduct its hours.
  IF v_pending_count <> v_row_count THEN
    RAISE EXCEPTION 'This leave application has already been decided.';
  END IF;

  SELECT employee_id, application_hash, head_status, hr_override
    INTO v_employee_id, v_application_hash, v_head_status, v_hr_override
    FROM offset_leaves WHERE leave_group_id = p_group_id ORDER BY id LIMIT 1;

  -- #328: the head-status gate, under the group lock (overtime's shape,
  -- 20260908130000). Head decisions stamp every day-row alike, so the first
  -- row speaks for the group.
  IF p_status = 'APPROVED' AND v_head_status <> 'APPROVED' AND NOT v_hr_override THEN
    RAISE EXCEPTION 'Cannot approve this offset leave: the department head has not approved this request yet (head_status=%). Use the HR override if this needs to proceed anyway.', v_head_status;
  END IF;

  IF p_status = 'APPROVED' THEN
    v_approved_hours := COALESCE(p_approved_hours, v_total_hours);
    IF NOT (v_approved_hours > 0) THEN
      RAISE EXCEPTION 'Approved hours must be greater than zero.';
    END IF;
    IF v_approved_hours > v_total_hours THEN
      RAISE EXCEPTION 'Approved hours cannot exceed the requested hours.';
    END IF;
  END IF;

  IF p_status = 'APPROVED' THEN
    SELECT offset_hours_balance INTO v_balance FROM employees WHERE id = v_employee_id FOR UPDATE;
    v_balance := COALESCE(v_balance, 0);

    IF v_balance < v_approved_hours THEN
      RAISE EXCEPTION 'Cannot approve leave. Employee currently only has % hrs balance.', trim_scale(round(v_balance, 2));
    END IF;

    -- The snapshot is the balance the employee will have AFTER this
    -- deduction, not the balance at the moment of approval.
    v_new_balance := v_balance - v_approved_hours;
    v_credits_snapshot := v_new_balance;
  END IF;

  SELECT signature_path INTO v_hr_signature_version FROM employees WHERE id = p_hr_id;
  IF v_hr_signature_version IS NOT NULL THEN
    v_hr_signature_timestamp := v_now;
  END IF;

  v_canon_credits := CASE WHEN v_credits_snapshot IS NULL THEN '' ELSE trim_scale(round(v_credits_snapshot, 2))::text END;
  v_approval_hash := encode(digest(
    format('%s|%s|%s|%s', v_application_hash, p_status, COALESCE(p_hr_id::text, ''), v_canon_credits),
    'sha256'), 'hex');

  UPDATE offset_leaves SET
    status = p_status,
    hr_notes = p_hr_notes,
    updated_at = v_now,
    approval_hash = v_approval_hash,
    hr_signature_version = v_hr_signature_version,
    hr_signature_timestamp = v_hr_signature_timestamp,
    hr_processed_at = CASE WHEN p_status = 'REJECTED' OR p_status LIKE 'APPROVED%' THEN v_now ELSE NULL END,
    approval_credits_snapshot = v_credits_snapshot,
    hr_processed_by = p_hr_id,
    -- The group total is split across its day-rows in proportion to each
    -- day's requested hours; approved = requested leaves every row as asked.
    approved_hours = CASE
      WHEN v_approved_hours IS NULL THEN NULL
      WHEN v_total_hours = 0 THEN 0
      ELSE round(hours * v_approved_hours / v_total_hours, 2)
    END
  WHERE leave_group_id = p_group_id;

  -- Rounding each day can leave the rows a cent off the total that was
  -- debited; the last day absorbs it, so undo/withdraw refund exactly that.
  IF v_approved_hours IS NOT NULL THEN
    UPDATE offset_leaves SET approved_hours = approved_hours + (
      v_approved_hours - (SELECT sum(approved_hours) FROM offset_leaves WHERE leave_group_id = p_group_id)
    )
    WHERE id = (SELECT id FROM offset_leaves WHERE leave_group_id = p_group_id ORDER BY date DESC, id DESC LIMIT 1);
  END IF;

  IF v_new_balance IS NOT NULL THEN
    UPDATE employees SET offset_hours_balance = v_new_balance, updated_at = v_now WHERE id = v_employee_id;
  END IF;

  RETURN jsonb_build_object(
    'rows', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.date) FROM offset_leaves l WHERE l.leave_group_id = p_group_id),
    'employee_id', v_employee_id,
    'total_hours', v_total_hours,
    'approved_hours', v_approved_hours,
    'dates', to_jsonb(v_dates)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_offset_leave_decision(
  p_group_id uuid,
  p_hr_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_employee_id uuid;
  v_previous_status text;
  v_row_count integer;
  v_total_hours numeric;
  v_dates date[];
  v_balance numeric;
  v_now timestamptz := now();
BEGIN
  PERFORM 1 FROM offset_leaves WHERE leave_group_id = p_group_id ORDER BY id FOR UPDATE;

  SELECT count(*), COALESCE(sum(COALESCE(approved_hours, hours)), 0), array_agg(date ORDER BY date)
    INTO v_row_count, v_total_hours, v_dates
    FROM offset_leaves WHERE leave_group_id = p_group_id;

  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'Leave application not found.';
  END IF;

  SELECT employee_id, status
    INTO v_employee_id, v_previous_status
    FROM offset_leaves WHERE leave_group_id = p_group_id ORDER BY id LIMIT 1;

  IF v_previous_status = 'PENDING' THEN
    RAISE EXCEPTION 'Leave is already pending.';
  END IF;

  -- The refund is an addition, so it can never take the balance negative the
  -- way undoing an overtime credit can (#108) — there is nothing to refuse.
  IF v_previous_status = 'APPROVED' THEN
    SELECT offset_hours_balance INTO v_balance FROM employees WHERE id = v_employee_id FOR UPDATE;
    UPDATE employees
       SET offset_hours_balance = COALESCE(v_balance, 0) + v_total_hours, updated_at = v_now
     WHERE id = v_employee_id;
  END IF;

  UPDATE offset_leaves SET
    status = 'PENDING',
    hr_notes = NULL,
    updated_at = v_now,
    approval_hash = NULL,
    hr_signature_version = NULL,
    hr_signature_timestamp = NULL,
    hr_processed_at = NULL,
    approval_credits_snapshot = NULL,
    hr_processed_by = NULL,
    approved_hours = NULL
  WHERE leave_group_id = p_group_id;

  RETURN jsonb_build_object(
    'rows', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.date) FROM offset_leaves l WHERE l.leave_group_id = p_group_id),
    'employee_id', v_employee_id,
    'total_hours', v_total_hours,
    'dates', to_jsonb(v_dates),
    'previous_status', v_previous_status
  );
END;
$$;

