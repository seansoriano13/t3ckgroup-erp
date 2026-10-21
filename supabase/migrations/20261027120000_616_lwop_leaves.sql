-- #616 (spec #609): LWOP (Leave Without Pay).
-- Time an employee was away with no pay and no balance spent. Kept for records only:
-- nothing here reads or writes a balance column. Filed like SIL (employee -> department head ->
-- HR); #620 adds HR recording one after the fact (recorded_by_hr).
--
--   lwop_leaves                   one row per day under a shared leave_group_id, shaped like sil_leaves
--                                 minus approval_credits_snapshot (there is no balance to snapshot)
--   decide_lwop_leave_decision    approve / reject a whole group (ADR 0013), head stage must be cleared
--   undo_lwop_leave_decision      group back to PENDING, HR stamps cleared
--   cancel_lwop_leave             the employee's own withdraw; approved groups until their first date
--                                 passes manila_today() (#613, ADR 0015 / 0039)

create table if not exists public.lwop_leaves (
  id                           uuid primary key default gen_random_uuid(),
  created_at                   timestamptz not null default now(),
  employee_id                  uuid not null references public.employees (id) on delete cascade,
  date                         date not null,
  hours                        numeric not null,
  reason                       text not null,
  status                       text not null default 'PENDING',
  hr_notes                     text,
  hr_processed_by              uuid references public.employees (id) on delete set null,
  hr_processed_at              timestamptz,
  attachments                  jsonb,
  start_time                   time,
  end_time                     time,
  leave_group_id               uuid not null default gen_random_uuid(),
  category_id                  uuid references public.hr_leave_categories (id) on delete set null,
  verification_token           text unique default encode(gen_random_bytes(16), 'hex'),
  application_hash             text,
  approval_hash                text,
  employee_signature_version   text,
  employee_signature_timestamp timestamptz,
  hr_signature_version         text,
  hr_signature_timestamp       timestamptz,
  printed_at                   timestamptz,
  printed_by                   uuid references public.employees (id),
  head_id                      uuid references public.employees (id) on delete set null,
  head_status                  text not null default 'APPROVED',
  head_note                    text,
  head_decided_at              timestamptz,
  head_signature_version       text,
  hr_override                  boolean not null default false,
  company_id                   uuid references public.companies (id) on delete set null,
  recorded_by_hr               boolean not null default false,

  constraint lwop_leaves_hours_check check (hours > 0),
  constraint lwop_leaves_status_check check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  constraint lwop_leaves_head_status_check check (head_status in ('PENDING', 'APPROVED', 'REJECTED'))
);

comment on table public.lwop_leaves is
  '#616: Leave Without Pay, one row per day under a leave_group_id. Records only: no balance column, no balance movement.';

create index if not exists lwop_leaves_company_id_idx on public.lwop_leaves using btree (company_id);
create index if not exists lwop_leaves_head_id_idx on public.lwop_leaves using btree (head_id);
create index if not exists lwop_leaves_leave_group_id_idx on public.lwop_leaves using btree (leave_group_id);
create index if not exists lwop_leaves_employee_id_date_idx on public.lwop_leaves using btree (employee_id, date);

-- The same head-status guard sil_leaves carries: only the routed head, HR or a Super Admin
-- may record a head decision.
drop trigger if exists lwop_leaves_guard_head_status on public.lwop_leaves;
create trigger lwop_leaves_guard_head_status
  before update on public.lwop_leaves
  for each row execute function public.guard_head_status_change();

-- Row-level security matches sil_leaves.
alter table public.lwop_leaves enable row level security;

create policy "lwop_leaves_head_select" on public.lwop_leaves
  as permissive for select to authenticated
  using (head_id = public.get_employee_id());

create policy "lwop_leaves_head_update" on public.lwop_leaves
  as permissive for update to authenticated
  using (head_id = public.get_employee_id());

create policy "lwop_leaves_insert" on public.lwop_leaves
  as permissive for insert to authenticated
  with check (
    employee_id = public.get_employee_id()
    or exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.is_hr or e.is_super_admin or e.can_manage_leaves)
    )
  );

create policy "lwop_leaves_select" on public.lwop_leaves
  as permissive for select to public
  using (
    employee_id = public.get_employee_id()
    or exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.is_hr or e.is_super_admin or e.can_manage_leaves)
    )
  );

create policy "lwop_leaves_update" on public.lwop_leaves
  as permissive for update to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.is_hr or e.is_super_admin or e.can_manage_leaves)
    )
  );

create policy "lwop_leaves_withdraw" on public.lwop_leaves
  as permissive for update to authenticated
  using (employee_id = public.get_employee_id() and status in ('PENDING', 'APPROVED'))
  with check (employee_id = public.get_employee_id() and status = 'CANCELLED');

-- ---------------------------------------------------------------------
-- Decide: approve or reject a whole group. Atomic and group-wide (ADR 0013): every day-row is
-- locked in id order before anything is read. No balance lock, there is no balance.
-- ---------------------------------------------------------------------
create or replace function public.decide_lwop_leave_decision(
  p_group_id uuid,
  p_status text,
  p_hr_notes text,
  p_hr_id uuid
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_employee_id uuid;
  v_application_hash text;
  v_row_count integer;
  v_pending_count integer;
  v_total_hours numeric;
  v_dates date[];
  v_head_status text;
  v_hr_override boolean;
  v_approval_hash text;
  v_hr_signature_version text;
  v_hr_signature_timestamp timestamptz;
  v_now timestamptz := now();
begin
  if p_status not in ('APPROVED', 'REJECTED') then
    raise exception 'Unsupported LWOP decision: %.', p_status;
  end if;

  perform 1 from lwop_leaves where leave_group_id = p_group_id order by id for update;

  select count(*), count(*) filter (where status = 'PENDING'), coalesce(sum(hours), 0), array_agg(date order by date)
    into v_row_count, v_pending_count, v_total_hours, v_dates
    from lwop_leaves where leave_group_id = p_group_id;

  if v_row_count = 0 then
    raise exception 'Leave application not found.';
  end if;

  if v_pending_count <> v_row_count then
    raise exception 'This leave application has already been decided.';
  end if;

  select employee_id, application_hash, head_status, hr_override
    into v_employee_id, v_application_hash, v_head_status, v_hr_override
    from lwop_leaves where leave_group_id = p_group_id order by id limit 1;

  -- The head stage must be cleared (approved) or overridden by HR before HR decides.
  if v_head_status is distinct from 'APPROVED' and not coalesce(v_hr_override, false) then
    raise exception 'Cannot decide this LWOP: the department head has not approved this request yet (head_status=%). Use the HR override if this needs to proceed anyway.', v_head_status;
  end if;

  select signature_path into v_hr_signature_version from employees where id = p_hr_id;
  if v_hr_signature_version is not null then
    v_hr_signature_timestamp := v_now;
  end if;

  v_approval_hash := encode(digest(
    format('%s|%s|%s|%s', v_application_hash, p_status, coalesce(p_hr_id::text, ''), ''),
    'sha256'), 'hex');

  update lwop_leaves set
    status = p_status,
    hr_notes = p_hr_notes,
    hr_processed_by = p_hr_id,
    hr_processed_at = v_now,
    approval_hash = v_approval_hash,
    hr_signature_version = v_hr_signature_version,
    hr_signature_timestamp = v_hr_signature_timestamp
  where leave_group_id = p_group_id;

  return jsonb_build_object(
    'rows', (select jsonb_agg(to_jsonb(l) order by l.date) from lwop_leaves l where l.leave_group_id = p_group_id),
    'employee_id', v_employee_id,
    'total_hours', v_total_hours,
    'dates', to_jsonb(v_dates)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Undo: the group goes back to PENDING and the HR stamps are cleared. Works on an HR-recorded
-- LWOP too (#620), so HR can then reject it.
-- ---------------------------------------------------------------------
create or replace function public.undo_lwop_leave_decision(
  p_group_id uuid,
  p_hr_id uuid
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_employee_id uuid;
  v_previous_status text;
  v_row_count integer;
  v_total_hours numeric;
  v_dates date[];
begin
  perform 1 from lwop_leaves where leave_group_id = p_group_id order by id for update;

  select count(*), coalesce(sum(hours), 0), array_agg(date order by date)
    into v_row_count, v_total_hours, v_dates
    from lwop_leaves where leave_group_id = p_group_id;

  if v_row_count = 0 then
    raise exception 'Leave application not found.';
  end if;

  select employee_id, status
    into v_employee_id, v_previous_status
    from lwop_leaves where leave_group_id = p_group_id order by id limit 1;

  if v_previous_status = 'PENDING' then
    raise exception 'Leave is already pending.';
  end if;

  update lwop_leaves set
    status = 'PENDING',
    hr_notes = null,
    hr_processed_by = null,
    hr_processed_at = null,
    approval_hash = null,
    hr_signature_version = null,
    hr_signature_timestamp = null
  where leave_group_id = p_group_id;

  return jsonb_build_object(
    'rows', (select jsonb_agg(to_jsonb(l) order by l.date) from lwop_leaves l where l.leave_group_id = p_group_id),
    'employee_id', v_employee_id,
    'total_hours', v_total_hours,
    'dates', to_jsonb(v_dates),
    'previous_status', v_previous_status
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Withdraw (the employee's own): a pending group any time; an approved group until its first
-- date has passed in Manila time (manila_today(), #613). Same wording as the SIL / Offset rule.
-- ---------------------------------------------------------------------
create or replace function public.cancel_lwop_leave(
  p_leave_id uuid,
  p_employee_id uuid
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_group_id uuid;
  v_employee_id uuid;
  v_previous_status text;
  v_total_hours numeric;
  v_dates date[];
  v_first_date date;
begin
  select leave_group_id into v_group_id from lwop_leaves where id = p_leave_id;
  if v_group_id is null then
    raise exception 'Leave application not found.';
  end if;

  perform 1 from lwop_leaves where leave_group_id = v_group_id order by id for update;

  select employee_id, status into v_employee_id, v_previous_status
    from lwop_leaves where id = p_leave_id;

  if v_employee_id <> p_employee_id then
    raise exception 'Unauthorized';
  end if;

  if v_previous_status in ('REJECTED', 'CANCELLED') then
    raise exception 'Cannot withdraw this request.';
  end if;

  select coalesce(sum(hours), 0), array_agg(date order by date), min(date)
    into v_total_hours, v_dates, v_first_date
    from lwop_leaves where leave_group_id = v_group_id;

  if v_previous_status = 'APPROVED' and v_first_date < public.manila_today() then
    raise exception 'This leave started on % and has already been taken, so it cannot be withdrawn. Ask HR to undo the approval if the leave was not actually taken.', v_first_date;
  end if;

  update lwop_leaves set status = 'CANCELLED' where leave_group_id = v_group_id;

  return jsonb_build_object(
    'rows', (select jsonb_agg(to_jsonb(l) order by l.date) from lwop_leaves l where l.leave_group_id = v_group_id),
    'employee_id', v_employee_id,
    'group_id', v_group_id,
    'total_hours', v_total_hours,
    'dates', to_jsonb(v_dates),
    'previous_status', v_previous_status
  );
end;
$$;
