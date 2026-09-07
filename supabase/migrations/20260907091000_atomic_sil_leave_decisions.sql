-- Issue #110: the SIL half of the same defect #108 fixed for overtime and
-- #109 for Offset. Approving, undoing or cancelling a SIL leave read the
-- group, read the balance, computed a new figure in JavaScript, then wrote the
-- day-rows and the balance separately — so a failure between the two writes
-- left an approved leave with no deduction behind it, and two officers acting
-- on one employee at once could lose a balance movement.
--
-- Same shape as decide_offset_leave_decision: the group's day-rows are locked
-- in id order before anything is read off them, and the employee row is locked
-- before its balance is, so the whole group and the balance commit together or
-- not at all. The approval hash and HR signature are computed here in SQL for
-- the reason ADR 0013 gives.
--
-- SIL adds one thing Offset does not have. Its refund is not a plain addition:
-- an employee whose employment status is no longer SIL-eligible does not get
-- the hours back, and HR is told, because silently re-granting SIL hours to
-- someone HR has since made ineligible is worse than a balance HR must correct
-- by hand. That gate lives here now, inside the same lock as the write it
-- guards — but the anomaly record it produces is still written by the service
-- layer, which is where every other SIL audit line is written. The functions
-- therefore report `refund_withheld` and the employment status that caused it
-- back to the caller, rather than swallowing the decision silently.
--
-- cancel_sil_leave also carries issue #111's date guard, for the reason the
-- offset migration gives. ADR 0015 records the policy.

CREATE OR REPLACE FUNCTION public.decide_sil_leave_decision(
  p_group_id uuid,
  p_status text,
  p_hr_notes text,
  p_hr_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_employee_id uuid;
  v_application_hash text;
  v_employment_status text;
  v_row_count integer;
  v_pending_count integer;
  v_total_hours numeric;
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
    RAISE EXCEPTION 'Unsupported SIL leave decision: %.', p_status;
  END IF;

  PERFORM 1 FROM sil_leaves WHERE leave_group_id = p_group_id ORDER BY id FOR UPDATE;

  SELECT count(*), count(*) FILTER (WHERE status = 'PENDING'), COALESCE(sum(hours), 0), array_agg(date ORDER BY date)
    INTO v_row_count, v_pending_count, v_total_hours, v_dates
    FROM sil_leaves WHERE leave_group_id = p_group_id;

  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'Leave application not found.';
  END IF;

  IF v_pending_count <> v_row_count THEN
    RAISE EXCEPTION 'This leave application has already been decided.';
  END IF;

  SELECT employee_id, application_hash
    INTO v_employee_id, v_application_hash
    FROM sil_leaves WHERE leave_group_id = p_group_id ORDER BY id LIMIT 1;

  IF p_status = 'APPROVED' THEN
    SELECT sil_hours_balance, employment_status
      INTO v_balance, v_employment_status
      FROM employees WHERE id = v_employee_id FOR UPDATE;

    -- No caller may read the SIL balance without also checking eligibility —
    -- the rule fetchEligibleSilEmployee enforced on the JavaScript side.
    IF v_employment_status IS DISTINCT FROM 'Regular' THEN
      RAISE EXCEPTION 'Only Regular employees are eligible for SIL leave.';
    END IF;

    v_balance := COALESCE(v_balance, 0);
    IF v_balance < v_total_hours THEN
      RAISE EXCEPTION 'Cannot approve leave. Employee currently only has % hrs balance.', trim_scale(round(v_balance, 2));
    END IF;

    v_new_balance := v_balance - v_total_hours;
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

  UPDATE sil_leaves SET
    status = p_status,
    hr_notes = p_hr_notes,
    hr_processed_by = p_hr_id,
    hr_processed_at = v_now,
    approval_hash = v_approval_hash,
    hr_signature_version = v_hr_signature_version,
    hr_signature_timestamp = v_hr_signature_timestamp,
    approval_credits_snapshot = v_credits_snapshot
  WHERE leave_group_id = p_group_id;

  IF v_new_balance IS NOT NULL THEN
    UPDATE employees SET sil_hours_balance = v_new_balance, updated_at = v_now WHERE id = v_employee_id;
  END IF;

  RETURN jsonb_build_object(
    'rows', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.date) FROM sil_leaves l WHERE l.leave_group_id = p_group_id),
    'employee_id', v_employee_id,
    'total_hours', v_total_hours,
    'dates', to_jsonb(v_dates)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_sil_leave_decision(
  p_group_id uuid,
  p_hr_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_employee_id uuid;
  v_employee_name text;
  v_employment_status text;
  v_previous_status text;
  v_row_count integer;
  v_total_hours numeric;
  v_dates date[];
  v_balance numeric;
  v_refund_withheld boolean := false;
  v_now timestamptz := now();
BEGIN
  PERFORM 1 FROM sil_leaves WHERE leave_group_id = p_group_id ORDER BY id FOR UPDATE;

  SELECT count(*), COALESCE(sum(hours), 0), array_agg(date ORDER BY date)
    INTO v_row_count, v_total_hours, v_dates
    FROM sil_leaves WHERE leave_group_id = p_group_id;

  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'Leave application not found.';
  END IF;

  SELECT employee_id, status
    INTO v_employee_id, v_previous_status
    FROM sil_leaves WHERE leave_group_id = p_group_id ORDER BY id LIMIT 1;

  IF v_previous_status = 'PENDING' THEN
    RAISE EXCEPTION 'Leave is already pending.';
  END IF;

  IF v_previous_status = 'APPROVED' THEN
    SELECT sil_hours_balance, employment_status, name
      INTO v_balance, v_employment_status, v_employee_name
      FROM employees WHERE id = v_employee_id FOR UPDATE;

    -- A gate, not a cap: a still-eligible employee gets the whole amount back,
    -- anyone else gets none of it and the caller is told so it can record the
    -- anomaly HR reviews.
    IF v_employment_status IS NOT DISTINCT FROM 'Regular' THEN
      UPDATE employees
         SET sil_hours_balance = COALESCE(v_balance, 0) + v_total_hours, updated_at = v_now
       WHERE id = v_employee_id;
    ELSE
      v_refund_withheld := true;
    END IF;
  END IF;

  UPDATE sil_leaves SET
    status = 'PENDING',
    hr_notes = NULL,
    hr_processed_by = NULL,
    hr_processed_at = NULL,
    approval_hash = NULL,
    hr_signature_version = NULL,
    hr_signature_timestamp = NULL,
    approval_credits_snapshot = NULL
  WHERE leave_group_id = p_group_id;

  RETURN jsonb_build_object(
    'rows', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.date) FROM sil_leaves l WHERE l.leave_group_id = p_group_id),
    'employee_id', v_employee_id,
    'employee_name', v_employee_name,
    'employment_status', v_employment_status,
    'refund_withheld', v_refund_withheld,
    'total_hours', v_total_hours,
    'dates', to_jsonb(v_dates),
    'previous_status', v_previous_status
  );
END;
$$;

-- The employee's own cancellation. Same two things move as a decision moves —
-- the group's day-rows and, when the leave had been approved, the balance
-- those rows had spent — and the eligibility gate on the refund applies here
-- exactly as it does on an HR undo.
CREATE OR REPLACE FUNCTION public.cancel_sil_leave(
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
  v_employee_name text;
  v_employment_status text;
  v_previous_status text;
  v_total_hours numeric;
  v_dates date[];
  v_first_date date;
  v_balance numeric;
  v_refund_withheld boolean := false;
  v_now timestamptz := now();
BEGIN
  SELECT leave_group_id INTO v_group_id FROM sil_leaves WHERE id = p_leave_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'Leave application not found.';
  END IF;

  PERFORM 1 FROM sil_leaves WHERE leave_group_id = v_group_id ORDER BY id FOR UPDATE;

  SELECT employee_id, status INTO v_employee_id, v_previous_status
    FROM sil_leaves WHERE id = p_leave_id;

  IF v_employee_id <> p_employee_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_previous_status IN ('REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot withdraw this request.';
  END IF;

  SELECT COALESCE(sum(hours), 0), array_agg(date ORDER BY date), min(date)
    INTO v_total_hours, v_dates, v_first_date
    FROM sil_leaves WHERE leave_group_id = v_group_id;

  -- Issue #111 (HR-06): the identical cutoff withdraw_offset_leave applies,
  -- worded identically — an employee has no reason to learn two rules for the
  -- same act. See ADR 0015.
  IF v_previous_status = 'APPROVED' AND v_first_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'This leave started on % and has already been taken, so its hours cannot be withdrawn. Ask HR to undo the approval if the leave was not actually taken.', v_first_date;
  END IF;

  UPDATE sil_leaves SET status = 'CANCELLED' WHERE leave_group_id = v_group_id;

  IF v_previous_status = 'APPROVED' THEN
    SELECT sil_hours_balance, employment_status, name
      INTO v_balance, v_employment_status, v_employee_name
      FROM employees WHERE id = v_employee_id FOR UPDATE;

    IF v_employment_status IS NOT DISTINCT FROM 'Regular' THEN
      UPDATE employees
         SET sil_hours_balance = COALESCE(v_balance, 0) + v_total_hours, updated_at = v_now
       WHERE id = v_employee_id;
    ELSE
      v_refund_withheld := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'rows', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.date) FROM sil_leaves l WHERE l.leave_group_id = v_group_id),
    'employee_id', v_employee_id,
    'employee_name', v_employee_name,
    'employment_status', v_employment_status,
    'refund_withheld', v_refund_withheld,
    'group_id', v_group_id,
    'total_hours', v_total_hours,
    'dates', to_jsonb(v_dates),
    'previous_status', v_previous_status
  );
END;
$$;
