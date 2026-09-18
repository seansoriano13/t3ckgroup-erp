-- #328 (release/2026-09, #325): forward-port offset_leaves.approved_hours.
--
-- Production has the column (main's 0071, #198): HR approves offset leave
-- with editable hours, and 7 historical rows hold an approved value that
-- differs from what was requested. Staging never received it, and its atomic
-- decision RPC (#109) has no way to set it. Nothing is dropped � on
-- production the column already exists and this is a no-op add.
--
-- decide_offset_leave_decision gains p_approved_hours (the group total,
-- defaulting to the requested total, capped at it) and now also enforces the
-- head-status gate under its own lock, as decide_overtime_request does.
-- undo_offset_leave_decision and withdraw_offset_leave refund what was
-- actually spent: approved_hours where set, requested hours otherwise.

alter table public.offset_leaves add column if not exists approved_hours numeric;

-- The four-argument signature is replaced, not overloaded: two candidates
-- would make every named-argument call from the service ambiguous.
drop function if exists public.decide_offset_leave_decision(uuid, text, text, uuid);

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

CREATE OR REPLACE FUNCTION public.withdraw_offset_leave(
  p_leave_id uuid,
  p_employee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_group_id uuid;
  v_employee_id uuid;
  v_previous_status text;
  v_total_hours numeric;
  v_dates date[];
  v_first_date date;
  v_balance numeric;
  v_now timestamptz := now();
BEGIN
  SELECT leave_group_id INTO v_group_id FROM offset_leaves WHERE id = p_leave_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'Leave application not found.';
  END IF;

  PERFORM 1 FROM offset_leaves WHERE leave_group_id = v_group_id ORDER BY id FOR UPDATE;

  SELECT employee_id, status INTO v_employee_id, v_previous_status
    FROM offset_leaves WHERE id = p_leave_id;

  IF v_employee_id <> p_employee_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_previous_status IN ('REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot withdraw this request.';
  END IF;

  SELECT COALESCE(sum(COALESCE(approved_hours, hours)), 0), array_agg(date ORDER BY date), min(date)
    INTO v_total_hours, v_dates, v_first_date
    FROM offset_leaves WHERE leave_group_id = v_group_id;

  -- Issue #111 (HR-06): hours already taken are not refundable on the
  -- employee's own say-so. The cutoff is the leave's first date — see ADR 0015
  -- for why that anchor and not the printed form's filing deadline, and for
  -- why HR's undo is deliberately left unguarded as the correction route. Only
  -- an approved leave has hours to give back, so only an approved leave is
  -- guarded: a pending one has spent nothing, and guarding it would strand a
  -- past-dated application with no way for the employee to take it back.
  IF v_previous_status = 'APPROVED' AND v_first_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'This leave started on % and has already been taken, so its hours cannot be withdrawn. Ask HR to undo the approval if the leave was not actually taken.', v_first_date;
  END IF;

  UPDATE offset_leaves SET
    status = 'CANCELLED',
    updated_at = v_now
  WHERE leave_group_id = v_group_id;

  IF v_previous_status = 'APPROVED' THEN
    SELECT offset_hours_balance INTO v_balance FROM employees WHERE id = v_employee_id FOR UPDATE;
    UPDATE employees
       SET offset_hours_balance = COALESCE(v_balance, 0) + v_total_hours, updated_at = v_now
     WHERE id = v_employee_id;
  END IF;

  RETURN jsonb_build_object(
    'rows', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.date) FROM offset_leaves l WHERE l.leave_group_id = v_group_id),
    'employee_id', v_employee_id,
    'group_id', v_group_id,
    'total_hours', v_total_hours,
    'dates', to_jsonb(v_dates),
    'previous_status', v_previous_status
  );
END;
$$;
