-- #1197 (spec #1187): a date Stage Field a Sales Flow marks "Show on Calendar" puts an all-day entry on the Calendar.
--
-- WHY: nothing put the Retention release date (when the warranty ends and Retention Money can be collected) on the
-- Calendar. The Calendar never finds the field by its name, since a rename would break that silently; the flow
-- marks the field instead. Sean turns it on for "Retention release date" on the Project flow's Retention stage.
--
-- WHAT THIS ADDS
--   * flow_stage_fields.show_on_calendar: false by default; only a custom date field may be true.
--   * calendar_entries() (ADR 0037): one new kind, SOR_DATE. The body is copied from
--     20261217120000_1056_activity_days.sql (the newest definition) with the SOR_DATE branch added.
--     Who sees it is checked inside the function with _sor_visible_visit_ids_as (ADR 0021).
--
-- Idempotent: the column and constraint are added only if missing, and the function is replaced.

alter table public.flow_stage_fields add column if not exists show_on_calendar boolean not null default false;

alter table public.flow_stage_fields drop constraint if exists flow_stage_fields_show_on_calendar_chk;
alter table public.flow_stage_fields add constraint flow_stage_fields_show_on_calendar_chk
  check (not show_on_calendar or (source = 'custom' and field_type = 'date'));

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
  v_super boolean := false;
  v_pending boolean;
begin
  if v_viewer is null then
    return;
  end if;

  select coalesce(e.is_hr, false) or coalesce(e.is_super_admin, false) or coalesce(e.can_manage_leaves, false),
         coalesce(e.is_super_admin, false)
    into v_hr, v_super
    from public.employees e
    where e.id = v_viewer;
  v_hr := coalesce(v_hr, false);
  v_super := coalesce(v_super, false);
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


    -- ---- MEETING (one entry per Activity day) -----------------------------
    select
      'MEETING'::text,
      d.id,
      m.id,
      d.starts_at,
      d.ends_at,
      false,
      (d.starts_at at time zone 'Asia/Manila')::date,
      jsonb_build_object('id', a.id, 'name', a.name, 'department', a.department, 'avatar', a.avatar_path),
      case when m.status in ('APPROVED', 'CANCELLED') then 'APPROVED' else 'PENDING' end,
      round((extract(epoch from (d.ends_at - d.starts_at)) / 3600.0)::numeric, 2),
      v.name,
      m.purpose,
      jsonb_build_object(
        'stage', m.status,
        'request_id', m.id,
        'day_index', d.day_index,
        'days_total', d.days_total,
        'range_start', (d.range_start at time zone 'Asia/Manila')::date,
        'range_end', (d.range_end at time zone 'Asia/Manila')::date,
        'last_day_starts_at', d.range_end,
        'purpose', m.purpose,
        'venue', v.name,
        'activity_type', m.activity_type,
        'meeting_type', m.meeting_type,
        'meeting_link', m.meeting_link,
        'facilitator', jsonb_build_object('id', f.id, 'name', f.name),
        'participants', coalesce((
          select jsonb_agg(jsonb_build_object('id', pe.id, 'name', pe.name) order by pe.name)
          from public.meeting_request_participants mp
          join public.employees pe on pe.id = mp.employee_id
          where mp.request_id = m.id
        ), '[]'::jsonb),
        'guests', to_jsonb(m.guests),
        'guest_emails', to_jsonb(m.guest_emails)
      )
    from public.meeting_requests m
    join (
      select dd.id, dd.request_id, dd.starts_at, dd.ends_at,
             row_number() over (partition by dd.request_id order by dd.starts_at) as day_index,
             count(*) over (partition by dd.request_id) as days_total,
             min(dd.starts_at) over (partition by dd.request_id) as range_start,
             max(dd.starts_at) over (partition by dd.request_id) as range_end
        from public.meeting_request_days dd
    ) d on d.request_id = m.id
    left join public.calendar_venues v on v.id = m.venue_id
    join public.employees a on a.id = m.applicant_id
    join public.employees f on f.id = m.facilitator_id
    where (
        m.status in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED')
        or (m.status = 'CANCELLED' and m.cancelled_at is not null and m.cancelled_at > m.starts_at)
      )
      and (d.starts_at at time zone 'Asia/Manila')::date between p_from and p_to

    union all

    -- ---- SOR_DATE: a date Stage Field marked "Show on Calendar" (#1197) -------
    -- The SOR's latest value for the field, all day on that date. Only a caller who can see the Stage Visit
    -- the value sits on (ADR 0021) gets a row; everyone else gets nothing, not a blank slot. Deleted,
    -- scratch and Lost SORs, archived fields, and a cleared or non-date value give none.
    select
      'SOR_DATE'::text,
      sv.id,
      sv.opportunity_id,
      (sv.d::timestamp at time zone 'Asia/Manila'),
      ((sv.d + 1)::timestamp at time zone 'Asia/Manila') - interval '1 second',
      true,
      sv.d,
      null::jsonb,
      'APPROVED'::text,
      null::numeric,
      null::text,
      coalesce(nullif(btrim(o.project_title), ''), o.client_name) || ' · ' || sv.label,
      jsonb_build_object(
        'opportunity_id', o.id,
        'field_id', sv.field_id,
        'field_label', sv.label,
        'sales_reference', o.sales_reference,
        'client_name', o.client_name
      )
    from (
      select distinct on (val.opportunity_id, val.field_id)
             val.id, val.opportunity_id, val.field_id, val.stage_visit_id, f.label,
             case when (val.value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$' then (val.value #>> '{}')::date end as d
        from public.sor_stage_field_values val
        join public.flow_stage_fields f on f.id = val.field_id and f.show_on_calendar and f.archived_at is null
        join public.sor_stage_visits vis on vis.id = val.stage_visit_id and vis.undone_at is null
       order by val.opportunity_id, val.field_id, val.updated_at desc, val.id
    ) sv
    join public.sales_opportunities o on o.id = sv.opportunity_id
    where sv.d between p_from and p_to
      and not coalesce(o.is_deleted, false)
      and not coalesce(o.is_scratch, false)
      and not exists (select 1 from public.crm_pipeline_stages ps where ps.code = o.status and ps.is_lost)
      and exists (
        select 1 from public._sor_visible_visit_ids_as(o.id, v_viewer, v_super) as vv(id)
        where vv.id = sv.stage_visit_id
      )
  ) q
  order by q.manila_date, q.starts_at, q.id;
end;
$function$;

revoke all on function public.calendar_entries(date, date, boolean) from public, anon;
grant execute on function public.calendar_entries(date, date, boolean) to authenticated;
