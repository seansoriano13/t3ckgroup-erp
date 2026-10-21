-- #622 (spec #609, ADR 0037): LWOP on the Calendar.
-- One more UNION ALL branch in calendar_entries(), same privacy rules as SIL: approved rows go to
-- everyone, pending only to HR-page viewers who ask, reason only to them and the employee. Only date,
-- time, hours, status and reason are read from lwop_leaves (no signatures, hashes, attachments or HR
-- officer). Written complete (CREATE OR REPLACE) against the #615 function.
-- Written as a file only. Apply it through the normal staging/prod path.

create or replace function public.calendar_entries(
  p_from date,
  p_to date,
  p_include_pending boolean default false
)
returns table (
  kind text,
  id uuid,
  group_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  manila_date date,
  employee jsonb,
  status text,
  hours numeric,
  venue text,
  title text,
  details jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_viewer uuid := public.get_employee_id();
  v_hr boolean := false;
  v_pending boolean;
begin
  if v_viewer is null then
    return;
  end if;

  select coalesce(e.is_hr, false) or coalesce(e.is_super_admin, false) or coalesce(e.can_manage_leaves, false)
    into v_hr
    from public.employees e
    where e.id = v_viewer;
  v_hr := coalesce(v_hr, false);
  v_pending := v_hr and coalesce(p_include_pending, false);

  return query
  with src as (
    -- ---- SIL ------------------------------------------------------------
    select 'SIL'::text as kind, s.id, s.leave_group_id as group_id, s.employee_id,
           s.date, s.start_time, s.end_time,
           s.status as raw_status, s.hours, 'SIL'::text as title, s.reason
      from public.sil_leaves s
      where s.date between p_from and p_to
    union all
    -- ---- LWOP -----------------------------------------------------------
    select 'LWOP', l.id, l.leave_group_id, l.employee_id,
           l.date, l.start_time, l.end_time,
           l.status, l.hours, 'LWOP', l.reason
      from public.lwop_leaves l
      where l.date between p_from and p_to
    union all
    -- ---- OFFSET ---------------------------------------------------------
    select 'OFFSET', o.id, o.leave_group_id, o.employee_id,
           o.date, o.start_time, o.end_time,
           o.status, o.hours, 'Offset', o.reason
      from public.offset_leaves o
      where o.date between p_from and p_to
    union all
    -- ---- OVERTIME -------------------------------------------------------
    select 'OVERTIME', ot.id, ot.id, ot.employee_id,
           ot.date, ot.start_time, ot.end_time,
           ot.status, coalesce(ot.approved_hours, ot.hours), 'Overtime', ot.reason
      from public.overtime_requests ot
      where ot.date between p_from and p_to
    union all
    -- ---- UNDERTIME ------------------------------------------------------
    select 'UNDERTIME', u.id, u.id, u.employee_id,
           u.date,
           coalesce(u.actual_start_time, u.original_start_time),
           coalesce(u.actual_end_time, u.original_end_time),
           u.status, coalesce(u.approved_hours, u.hours), 'Undertime', u.reason
      from public.undertime_requests u
      where u.date between p_from and p_to
  )
  select
    s.kind,
    s.id,
    s.group_id,
    ((s.date + coalesce(s.start_time, time '00:00')) at time zone 'Asia/Manila'),
    ((s.date + coalesce(s.end_time, time '23:59:59')) at time zone 'Asia/Manila'),
    (s.start_time is null),
    s.date,
    jsonb_build_object('id', e.id, 'name', e.name, 'department', e.department, 'avatar', e.avatar_path),
    case when s.raw_status = 'PENDING' then 'PENDING' else 'APPROVED' end,
    s.hours,
    null::text,
    s.title,
    case when v_hr or s.employee_id = v_viewer
         then jsonb_build_object('reason', s.reason)
         else '{}'::jsonb end
  from src s
  join public.employees e on e.id = s.employee_id
  where (s.raw_status in ('APPROVED', 'APPROVED_PAID', 'APPROVED_OFFSET')
         or (s.raw_status = 'PENDING' and v_pending))
  order by s.date, s.start_time nulls first, s.id;
end;
$function$;

revoke all on function public.calendar_entries(date, date, boolean) from public, anon;
grant execute on function public.calendar_entries(date, date, boolean) to authenticated;
