-- Issues #147-149 (children of epic #146, "Undertime, on TG-13"): adds a new
-- Undertime request type, modeled directly on overtime_requests plus the
-- department-head approval stage (20260908110000) and company scoping
-- (20260908150000) those tables already carry.
--
-- Undertime never touches a balance column (offset_hours_balance,
-- sil_hours_balance) — there is no APPROVED_PAID/APPROVED_OFFSET split, so
-- the status vocabulary matches leave tables exactly: PENDING | APPROVED |
-- REJECTED | CANCELLED, not overtime's PENDING | APPROVED_PAID |
-- APPROVED_OFFSET | REJECTED | CANCELLED.
--
-- hr_processed_at is a new column overtime/offset notably lack (they infer
-- "when HR decided" from updated_at, which drifts on unrelated edits) —
-- undertime gets the real timestamp from day one, stamped only on
-- APPROVED/REJECTED decisions by decide_undertime_request below.

create table if not exists public."undertime_requests" (
  "id" uuid not null default gen_random_uuid(),
  "employee_id" uuid not null,
  "date" date not null,
  "hours" numeric not null,
  "status" text not null default 'PENDING'::text,
  "hr_notes" text,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "reason" text,
  "attachments" jsonb,
  "original_start_time" time without time zone,
  "original_end_time" time without time zone,
  "actual_start_time" time without time zone,
  "actual_end_time" time without time zone,
  "approved_hours" numeric,
  "category_id" uuid,
  "verification_token" text default encode(gen_random_bytes(16), 'hex'::text),
  "application_hash" text,
  "approval_hash" text,
  "employee_signature_version" text,
  "employee_signature_timestamp" timestamp with time zone,
  "hr_signature_version" text,
  "hr_signature_timestamp" timestamp with time zone,
  "hr_processed_by" uuid,
  "hr_processed_at" timestamp with time zone,
  "printed_at" timestamp with time zone,
  "printed_by" uuid,
  "company_id" uuid,
  "head_id" uuid references public.employees(id) on delete set null,
  "head_status" text not null default 'APPROVED',
  "head_note" text,
  "head_decided_at" timestamp with time zone,
  "head_signature_version" text,
  "hr_override" boolean not null default false
);

alter table public.undertime_requests add constraint "undertime_requests_pkey" primary key (id);
alter table public.undertime_requests add constraint "undertime_requests_verification_token_key" unique (verification_token);
alter table public.undertime_requests add constraint "undertime_requests_status_check"
  check ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])));
alter table public.undertime_requests add constraint "undertime_requests_head_status_check"
  check ((head_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])));
alter table public.undertime_requests add constraint "undertime_requests_category_id_fkey" foreign key (category_id) references public.hr_leave_categories(id) on delete set null;
alter table public.undertime_requests add constraint "undertime_requests_employee_id_fkey" foreign key (employee_id) references public.employees(id);
alter table public.undertime_requests add constraint "undertime_requests_hr_processed_by_fkey" foreign key (hr_processed_by) references public.employees(id) on delete set null;
alter table public.undertime_requests add constraint "undertime_requests_printed_by_fkey" foreign key (printed_by) references public.employees(id);
alter table public.undertime_requests add constraint "undertime_requests_company_id_fkey" foreign key (company_id) references public.companies(id);

create index if not exists undertime_requests_head_id_idx on public.undertime_requests using btree (head_id);
create index if not exists undertime_requests_employee_id_idx on public.undertime_requests using btree (employee_id);

drop trigger if exists undertime_requests_guard_head_status on public.undertime_requests;
create trigger undertime_requests_guard_head_status
  before update on public.undertime_requests
  for each row execute function public.guard_head_status_change();

alter table public."undertime_requests" enable row level security;

-- RLS mirrors overtime_requests' own scoping (employee-owns-row OR HR/super
-- admin/can_manage_leaves), plus the routed-head select/update grant every
-- other head-staged table gets. Deliberately not gated on the broader
-- is_hr bundle alone for write — same three-way OR overtime already uses.
create policy "undertime_requests_insert" on public."undertime_requests"
  as permissive
  for insert
  to authenticated
  with check ((employee_id = get_employee_id()));

create policy "undertime_requests_select" on public."undertime_requests"
  as permissive
  for select
  to authenticated
  using (((employee_id = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves))))));

create policy "undertime_requests_update" on public."undertime_requests"
  as permissive
  for update
  to authenticated
  using (((employee_id = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves))))));

create policy "undertime_requests_head_select" on public."undertime_requests"
  as permissive for select to authenticated
  using (head_id = public.get_employee_id());
create policy "undertime_requests_head_update" on public."undertime_requests"
  as permissive for update to authenticated
  using (head_id = public.get_employee_id());

-- ---------------------------------------------------------------------
-- decide_undertime_request: mirrors decide_overtime_request's gate/hash/
-- signature-stamp pattern (see 20260908130000_gate_overtime_decision_on_
-- head_status.sql) but drops the APPROVED_OFFSET balance-crediting branch
-- entirely — undertime never touches offset_hours_balance or
-- sil_hours_balance — and stamps the new hr_processed_at column on any
-- decision (APPROVED/REJECTED).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_undertime_request(
  p_request_id uuid,
  p_status text,
  p_approved_hours numeric,
  p_hr_notes text,
  p_hr_id uuid
)
RETURNS undertime_requests
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_request undertime_requests;
  v_is_decision boolean;
  v_approved_hours numeric;
  v_approval_hash text;
  v_hr_signature_version text;
  v_hr_signature_timestamp timestamptz;
  v_hr_processed_at timestamptz;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_request FROM undertime_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Undertime request not found.';
  END IF;

  IF p_status = 'APPROVED' AND v_request.head_status <> 'APPROVED' AND NOT v_request.hr_override THEN
    RAISE EXCEPTION 'Cannot approve this undertime request: the department head has not approved this request yet (head_status=%). Use the HR override if this needs to proceed anyway.', v_request.head_status;
  END IF;

  v_is_decision := p_status = 'APPROVED' OR p_status = 'REJECTED';

  IF p_status = 'APPROVED' THEN
    v_approved_hours := COALESCE(p_approved_hours, v_request.hours);
    IF NOT (v_approved_hours > 0) THEN
      RAISE EXCEPTION 'Approved hours must be greater than zero.';
    END IF;
  END IF;

  SELECT signature_path INTO v_hr_signature_version FROM employees WHERE id = p_hr_id;
  IF v_hr_signature_version IS NOT NULL THEN
    v_hr_signature_timestamp := v_now;
  END IF;

  IF v_is_decision THEN
    v_hr_processed_at := v_now;
    -- Undertime moves no balance, so canon_credits is always '' — the hash
    -- formula still matches every other record type's shape byte-for-byte.
    v_approval_hash := encode(digest(
      format('%s|%s|%s|%s', v_request.application_hash, p_status, COALESCE(p_hr_id::text, ''), ''),
      'sha256'), 'hex');
  END IF;

  UPDATE undertime_requests SET
    status = p_status,
    approved_hours = COALESCE(v_approved_hours, v_request.approved_hours),
    hr_notes = p_hr_notes,
    updated_at = v_now,
    approval_hash = COALESCE(v_approval_hash, v_request.approval_hash),
    hr_signature_version = COALESCE(v_hr_signature_version, v_request.hr_signature_version),
    hr_signature_timestamp = COALESCE(v_hr_signature_timestamp, v_request.hr_signature_timestamp),
    hr_processed_by = p_hr_id,
    hr_processed_at = COALESCE(v_hr_processed_at, v_request.hr_processed_at)
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;

-- ---------------------------------------------------------------------
-- undo_undertime_decision: mirrors undo_overtime_decision's revert shape
-- (clear the decision fields, put the row back to PENDING) but with no
-- balance to refund/refuse — undertime never credited one in the first
-- place — and it clears hr_processed_at alongside the other decision
-- fields, same as it clears hr_processed_by.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_undertime_decision(
  p_request_id uuid,
  p_hr_id uuid
)
RETURNS undertime_requests
LANGUAGE plpgsql
AS $$
DECLARE
  v_request undertime_requests;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_request FROM undertime_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Undertime request not found.';
  END IF;
  IF v_request.status = 'PENDING' THEN
    RAISE EXCEPTION 'Request is already pending.';
  END IF;

  UPDATE undertime_requests SET
    status = 'PENDING',
    approved_hours = NULL,
    hr_notes = NULL,
    updated_at = v_now,
    approval_hash = NULL,
    hr_signature_version = NULL,
    hr_signature_timestamp = NULL,
    hr_processed_by = NULL,
    hr_processed_at = NULL
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;
