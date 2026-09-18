-- Issue #109: approving, undoing or withdrawing an Offset leave was a
-- client-orchestrated sequence of separate writes — read the group, read the
-- balance, compute a new figure in JavaScript, update the day-rows, update the
-- balance to that absolute value. The service comments claimed the group could
-- never end up half-decided, but nothing enforced it: the atomicity was only
-- the order the two writes happened to be issued in. A failure between them
-- left an approved leave with no deduction behind it, and two officers acting
-- on one employee at the same time could lose a balance movement entirely.
--
-- These three functions fold each decision into one Postgres function, so the
-- day-rows and the balance commit together or not at all. Two locks matter:
--
--   * every day-row sharing the leave_group_id is locked (ordered by id, so
--     two decisions can never take the same rows in opposite orders and
--     deadlock) before anything is read off the group. That is what makes the
--     group move as one unit — the whole point of the Offset shape, which
--     overtime, being one row per request, never had to solve.
--   * the employee row is locked before the balance is read, so a second
--     decision for the same employee blocks until the first commits and then
--     computes its own change against the balance the first actually left.
--
-- The approval hash and HR signature are computed here in SQL rather than in
-- JavaScript beforehand, for the reason ADR 0013 gives: the hash commits to
-- the credits snapshot — the balance this decision produces — and that value
-- is only known for certain once the function holds the employee-row lock.
-- The formula matches verify_form_token's byte-for-byte, so a printed offset
-- leave form verifies exactly as it did before.
--
-- Follows the pattern #108 established for overtime.
--
-- withdraw_offset_leave also carries issue #111's date guard, rather than a
-- separate migration replacing this function's body a minute after creating
-- it: the two tickets land together and neither function has reached any
-- ledger, so one definition is the honest one. ADR 0015 records the policy.

CREATE OR REPLACE FUNCTION public.decide_offset_leave_decision(
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

  SELECT employee_id, application_hash
    INTO v_employee_id, v_application_hash
    FROM offset_leaves WHERE leave_group_id = p_group_id ORDER BY id LIMIT 1;

  IF p_status = 'APPROVED' THEN
    SELECT offset_hours_balance INTO v_balance FROM employees WHERE id = v_employee_id FOR UPDATE;
    v_balance := COALESCE(v_balance, 0);

    IF v_balance < v_total_hours THEN
      RAISE EXCEPTION 'Cannot approve leave. Employee currently only has % hrs balance.', trim_scale(round(v_balance, 2));
    END IF;

    -- The snapshot is the balance the employee will have AFTER this
    -- deduction, not the balance at the moment of approval.
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

  UPDATE offset_leaves SET
    status = p_status,
    hr_notes = p_hr_notes,
    updated_at = v_now,
    approval_hash = v_approval_hash,
    hr_signature_version = v_hr_signature_version,
    hr_signature_timestamp = v_hr_signature_timestamp,
    approval_credits_snapshot = v_credits_snapshot,
    hr_processed_by = p_hr_id
  WHERE leave_group_id = p_group_id;

  IF v_new_balance IS NOT NULL THEN
    UPDATE employees SET offset_hours_balance = v_new_balance, updated_at = v_now WHERE id = v_employee_id;
  END IF;

  RETURN jsonb_build_object(
    'rows', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.date) FROM offset_leaves l WHERE l.leave_group_id = p_group_id),
    'employee_id', v_employee_id,
    'total_hours', v_total_hours,
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

  SELECT count(*), COALESCE(sum(hours), 0), array_agg(date ORDER BY date)
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
    hr_processed_by = NULL
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

-- Withdrawal is the employee's own path, and it moves the same two things a
-- decision does: the group's day-rows and, when the leave had been approved,
-- the balance those rows had spent. Reading the status under the group lock is
-- what closes the race #108 fixed on the overtime side by re-checking PENDING
-- on the write — an HR approval landing mid-withdraw is either fully visible
-- here (so its deduction is refunded) or not yet committed (so there is
-- nothing to refund), never half of each.
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

  SELECT COALESCE(sum(hours), 0), array_agg(date ORDER BY date), min(date)
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
