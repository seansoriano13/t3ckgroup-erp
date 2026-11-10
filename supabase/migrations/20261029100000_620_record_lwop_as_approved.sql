-- #620 (spec #609): HR records an absence as LWOP, already approved.
--
--   record_lwop_leave_as_approved   HR / Super Admin only. A pending group is written as APPROVED
--                                   with the head stage APPROVED, recorded_by_hr = true, and
--                                   hr_processed_by / hr_processed_at stamped. No balance moves
--                                   (there is no LWOP balance). Undo is undo_lwop_leave_decision,
--                                   which already returns any group to PENDING (#616).

create or replace function public.record_lwop_leave_as_approved(
  p_group_id uuid,
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
  v_approval_hash text;
  v_hr_signature_version text;
  v_hr_signature_timestamp timestamptz;
  v_now timestamptz := now();
begin
  if not (coalesce(public.is_hr(), false) or coalesce(public.is_super_admin(), false)) then
    raise exception 'Only HR or a Super Admin can record an LWOP.';
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

  select employee_id, application_hash
    into v_employee_id, v_application_hash
    from lwop_leaves where leave_group_id = p_group_id order by id limit 1;

  select signature_path into v_hr_signature_version from employees where id = p_hr_id;
  if v_hr_signature_version is not null then
    v_hr_signature_timestamp := v_now;
  end if;

  v_approval_hash := encode(digest(
    format('%s|%s|%s|%s', v_application_hash, 'APPROVED', coalesce(p_hr_id::text, ''), ''),
    'sha256'), 'hex');

  update lwop_leaves set
    status = 'APPROVED',
    head_status = 'APPROVED',
    recorded_by_hr = true,
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
