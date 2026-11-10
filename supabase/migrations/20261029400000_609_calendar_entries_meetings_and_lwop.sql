-- #609 reconcile (ADR 0037): calendar_entries() with every branch.
-- #619 (20261028300000) added MEETING as a wrapped union; #622 (20261029300000) rewrote the same function
-- from the #615 version with LWOP and no MEETING. This replaces both: SIL, LWOP, Offset, OT, UT (same
-- privacy rules as SIL; LWOP reads only date, time, hours, status and reason) plus MEETING.
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
  select q.* from (
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
      ((s.date + coalesce(s.start_time, time '00:00')) at time zone 'Asia/Manila') as starts_at,
      ((s.date + coalesce(s.end_time, time '23:59:59')) at time zone 'Asia/Manila') as ends_at,
      (s.start_time is null) as all_day,
      s.date as manila_date,
      jsonb_build_object('id', e.id, 'name', e.name, 'department', e.department, 'avatar', e.avatar_path) as employee,
      case when s.raw_status = 'PENDING' then 'PENDING' else 'APPROVED' end as status,
      s.hours,
      null::text as venue,
      s.title,
      case when v_hr or s.employee_id = v_viewer
           then jsonb_build_object('reason', s.reason)
           else '{}'::jsonb end as details
    from src s
    join public.employees e on e.id = s.employee_id
    where (s.raw_status in ('APPROVED', 'APPROVED_PAID', 'APPROVED_OFFSET')
           or (s.raw_status = 'PENDING' and v_pending))

    union all

    -- ---- MEETING --------------------------------------------------------
    select
      'MEETING'::text,
      m.id,
      m.id,
      m.starts_at,
      m.ends_at,
      false,
      (m.starts_at at time zone 'Asia/Manila')::date,
      jsonb_build_object('id', a.id, 'name', a.name, 'department', a.department, 'avatar', a.avatar_path),
      case when m.status = 'APPROVED' then 'APPROVED' else 'PENDING' end,
      round((extract(epoch from (m.ends_at - m.starts_at)) / 3600.0)::numeric, 2),
      v.name,
      m.purpose,
      jsonb_build_object(
        'stage', m.status,
        'purpose', m.purpose,
        'venue', v.name,
        'facilitator', jsonb_build_object('id', f.id, 'name', f.name),
        'participants', coalesce((
          select jsonb_agg(jsonb_build_object('id', pe.id, 'name', pe.name) order by pe.name)
          from public.meeting_request_participants mp
          join public.employees pe on pe.id = mp.employee_id
          where mp.request_id = m.id
        ), '[]'::jsonb),
        'guests', to_jsonb(m.guests)
      )
    from public.meeting_requests m
    join public.calendar_venues v on v.id = m.venue_id
    join public.employees a on a.id = m.applicant_id
    join public.employees f on f.id = m.facilitator_id
    where m.status in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED')
      and (m.starts_at at time zone 'Asia/Manila')::date between p_from and p_to
  ) q
  order by q.manila_date, q.starts_at, q.id;
end;
$function$;

revoke all on function public.calendar_entries(date, date, boolean) from public, anon;
grant execute on function public.calendar_entries(date, date, boolean) to authenticated;
