-- ==============================================================================
-- #1115 (spec #1114): self-update on `employees` becomes an allowlist
--
-- Until now prevent_role_escalation() blocked a list of columns for a person
-- editing their own row, so department, role, name, is_deleted, has_sales_flow,
-- has_task_flow, is_role_simulator, has_retail_access, has_bug_report_access and
-- is_issued_password could all be rewritten through the API. Now a person who is
-- not HR or a Super Admin, editing their own row, may change only avatar_path,
-- dashboard_banner_path, dashboard_quote, signature_path, updated_at and
-- last_seen_changelog_version (the changelog modal writes it from the browser).
-- Anything else raises 42501. HR and Super Admin rules are unchanged.
-- dashboard_quote is also limited to 100 characters, for every caller.
-- (#1116) dashboard_banner_path must be empty, an https:// address or a storage
-- path (no scheme before the first slash); javascript:, http:, data: are refused
-- for every caller. Only checked when the banner changes.
--
-- Prior shape: 20261013100700_ipas_signoffs.sql. Every earlier rule is kept.
-- SAFE TO RUN AT ANY TIME: one `create or replace`, no data change. Idempotent.
-- ==============================================================================

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_caller_id                UUID;
  v_caller_is_super_admin    BOOLEAN;
  v_caller_is_hr             BOOLEAN;
  v_caller_can_manage_leaves BOOLEAN;
  v_caller_is_role_simulator BOOLEAN;
  v_is_privileged            BOOLEAN;
BEGIN
  v_caller_id := public.get_employee_id();

  SELECT is_super_admin, is_hr, can_manage_leaves, is_role_simulator
  INTO   v_caller_is_super_admin, v_caller_is_hr, v_caller_can_manage_leaves, v_caller_is_role_simulator
  FROM   public.employees
  WHERE  id = v_caller_id;

  v_is_privileged := (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE);

  -- Quote length (#1115). Only checked when the quote changes, so an older,
  -- longer quote does not block an unrelated edit of that person.
  IF NEW.dashboard_quote IS DISTINCT FROM OLD.dashboard_quote
     AND char_length(NEW.dashboard_quote) > 100
  THEN
    RAISE EXCEPTION 'The quote can be at most 100 characters.'
      USING ERRCODE = '23514';
  END IF;

  -- Banner address (#1116). Allowed: empty, an https:// address, or a storage
  -- path (no scheme before the first slash).
  IF NEW.dashboard_banner_path IS DISTINCT FROM OLD.dashboard_banner_path
     AND NEW.dashboard_banner_path IS NOT NULL
     AND NEW.dashboard_banner_path <> ''
     AND NEW.dashboard_banner_path !~* '^https://'
     AND NEW.dashboard_banner_path !~ '^[^:/]*/'
  THEN
    RAISE EXCEPTION 'The banner must be a web address that starts with https://.'
      USING ERRCODE = '23514';
  END IF;

  IF v_caller_is_role_simulator IS TRUE THEN
    RETURN NEW;
  END IF;

  -- The self-update allowlist lives in employees_self_update_allowlist() below.

  IF NOT v_is_privileged THEN
    IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
      NEW.is_super_admin := OLD.is_super_admin;
    END IF;
    IF NEW.is_hr IS DISTINCT FROM OLD.is_hr THEN
      NEW.is_hr := OLD.is_hr;
    END IF;
    IF NEW.is_head IS DISTINCT FROM OLD.is_head THEN
      NEW.is_head := OLD.is_head;
    END IF;
  END IF;

  IF NEW.is_super_admin = TRUE
     AND OLD.is_super_admin = FALSE
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can grant super-admin status.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_manage_leaves IS DISTINCT FROM OLD.can_manage_leaves
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can change leave-management access.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_edit_sales_flows IS DISTINCT FROM OLD.can_edit_sales_flows
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can change Flow editor access.'
      USING ERRCODE = '42501';
  END IF;

  -- Purchasing and Finance access (#242). Only a Super Admin or HR grants
  -- them, and HR cannot grant themselves (a Super Admin may). A caller with no
  -- employee row is the service role or a migration, and is trusted.
  IF v_caller_id IS NOT NULL
     AND (
       NOT v_is_privileged
       OR (OLD.id = v_caller_id AND NOT (v_caller_is_super_admin IS TRUE))
     )
  THEN
    IF NEW.has_purchasing_flow IS DISTINCT FROM OLD.has_purchasing_flow THEN
      NEW.has_purchasing_flow := OLD.has_purchasing_flow;
    END IF;
    IF NEW.has_finance_flow IS DISTINCT FROM OLD.has_finance_flow THEN
      NEW.has_finance_flow := OLD.has_finance_flow;
    END IF;
  END IF;

  -- Call sign (#247). Only HR and Super Admins set one, their own included.
  IF v_caller_id IS NOT NULL
     AND NOT v_is_privileged
     AND NEW.call_sign IS DISTINCT FROM OLD.call_sign
  THEN
    NEW.call_sign := OLD.call_sign;
  END IF;

  -- Nobody edits their own hidden-navigation override — server-side, not by
  -- hiding the control — and only HR/Super Admin may edit anyone else's.
  IF NEW.hidden_nav_keys IS DISTINCT FROM OLD.hidden_nav_keys THEN
    IF OLD.id = v_caller_id OR NOT v_is_privileged THEN
      NEW.hidden_nav_keys := OLD.hidden_nav_keys;
    END IF;
  END IF;

  IF v_caller_can_manage_leaves IS TRUE
     AND NOT v_is_privileged
     AND OLD.id IS DISTINCT FROM v_caller_id
  THEN
    NEW := jsonb_populate_record(OLD, jsonb_build_object(
      'offset_hours_balance', NEW.offset_hours_balance,
      'sil_hours_balance', NEW.sil_hours_balance,
      'updated_at', NEW.updated_at
    ));
  END IF;

  RETURN NEW;
END;
$function$;

-- Self-update allowlist (#1115, spec #1114 D1/D2). SECURITY INVOKER on purpose:
-- current_user is 'authenticated' only for a write sent straight from the app.
-- A trusted SECURITY DEFINER function (a leave withdraw moving the balance, for
-- example) runs as its owner and is not checked here. Refused with an error,
-- not reverted. Compared as whole rows, so a column added later is refused by
-- default. HR and Super Admin are not limited.
create or replace function public.employees_self_update_allowlist()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $function$
DECLARE
  v_caller_id    UUID;
  v_privileged   BOOLEAN;
  v_simulator    BOOLEAN;
  v_self_allowed text[] := ARRAY[
    'avatar_path', 'dashboard_banner_path', 'dashboard_quote', 'signature_path',
    'updated_at', 'last_seen_changelog_version'
  ];
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  v_caller_id := public.get_employee_id();
  IF v_caller_id IS NULL OR OLD.id <> v_caller_id THEN
    RETURN NEW;
  END IF;

  -- OLD is the caller's own row, so its flags are the caller's.
  v_privileged := (OLD.is_super_admin IS TRUE OR OLD.is_hr IS TRUE);
  v_simulator  := (OLD.is_role_simulator IS TRUE);

  -- A leave function moving this person's balance (see below).
  IF current_setting('app.leave_balance_write', true) = 'on' THEN
    v_self_allowed := v_self_allowed || ARRAY['offset_hours_balance', 'sil_hours_balance'];
  END IF;

  IF NOT v_privileged
     AND NOT v_simulator
     AND (to_jsonb(NEW) - v_self_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_self_allowed)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: you can change only your avatar, banner, quote and signature.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

drop trigger if exists trg_employees_self_update_allowlist on public.employees;
create trigger trg_employees_self_update_allowlist
  before update on public.employees
  for each row execute function public.employees_self_update_allowlist();

-- Leave balance writes (#1115). These SECURITY INVOKER functions move the
-- caller's own offset/SIL balance; they raise a transaction-local flag that
-- employees_self_update_allowlist() honours for those two columns only.
CREATE OR REPLACE FUNCTION public.withdraw_offset_leave(p_leave_id uuid, p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
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
  PERFORM set_config('app.leave_balance_write', 'on', true);
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
$function$;
CREATE OR REPLACE FUNCTION public.cancel_sil_leave(p_leave_id uuid, p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
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
  PERFORM set_config('app.leave_balance_write', 'on', true);
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
$function$;
CREATE OR REPLACE FUNCTION public.undo_offset_leave_decision(p_group_id uuid, p_hr_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_employee_id uuid;
  v_previous_status text;
  v_row_count integer;
  v_total_hours numeric;
  v_dates date[];
  v_balance numeric;
  v_now timestamptz := now();
BEGIN
  PERFORM set_config('app.leave_balance_write', 'on', true);
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
$function$;
CREATE OR REPLACE FUNCTION public.undo_sil_leave_decision(p_group_id uuid, p_hr_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
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
  PERFORM set_config('app.leave_balance_write', 'on', true);
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
$function$;
CREATE OR REPLACE FUNCTION public.undo_overtime_decision(p_request_id uuid, p_hr_id uuid)
 RETURNS overtime_requests
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_request overtime_requests;
  v_credited numeric;
  v_balance numeric;
  v_new_balance numeric;
  v_now timestamptz := now();
BEGIN
  PERFORM set_config('app.leave_balance_write', 'on', true);
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
$function$;
CREATE OR REPLACE FUNCTION public.decide_offset_leave_decision(p_group_id uuid, p_status text, p_hr_notes text, p_hr_id uuid, p_approved_hours numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
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
  PERFORM set_config('app.leave_balance_write', 'on', true);
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
$function$;
CREATE OR REPLACE FUNCTION public.decide_sil_leave_decision(p_group_id uuid, p_status text, p_hr_notes text, p_hr_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
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
  PERFORM set_config('app.leave_balance_write', 'on', true);
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
$function$;
CREATE OR REPLACE FUNCTION public.decide_overtime_request(p_request_id uuid, p_status text, p_approved_hours numeric, p_hr_notes text, p_hr_id uuid)
 RETURNS overtime_requests
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
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
  PERFORM set_config('app.leave_balance_write', 'on', true);
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
$function$;
