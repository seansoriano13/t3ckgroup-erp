-- #613 (spec #609, ADR 0039): the withdraw cutoff follows the Manila date.
-- Adds manila_today() and re-creates withdraw_offset_leave / cancel_sil_leave
-- comparing the group's first date to it instead of CURRENT_DATE (UTC).
-- The rule itself is unchanged (ADR 0015): a leave starting today is still
-- withdrawable, and HR's undo stays unguarded.

CREATE OR REPLACE FUNCTION public.manila_today()
RETURNS date
LANGUAGE sql
STABLE
AS $$ SELECT (now() AT TIME ZONE 'Asia/Manila')::date $$;

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
  IF v_previous_status = 'APPROVED' AND v_first_date < public.manila_today() THEN
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
  IF v_previous_status = 'APPROVED' AND v_first_date < public.manila_today() THEN
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
