-- Shared leave calendar: every employee sees everyone's APPROVED offset/SIL
-- days (plus their own in any status), WITHOUT reason/balances/signature.
-- 0080 scoped the table SELECT policies to own-row/HR, which emptied the
-- calendar for colleagues. The tables stay locked; these SECURITY DEFINER
-- functions return only the calendar projection (ADR 0012).

create or replace function public.get_calendar_offset_leaves(p_start date default null, p_end date default null)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb)
  from (
    select l.created_at,
      jsonb_build_object(
        'id', l.id, 'employee_id', l.employee_id, 'date', l.date,
        'start_time', l.start_time, 'end_time', l.end_time, 'hours', l.hours,
        'status', l.status, 'leave_group_id', l.leave_group_id,
        'employee', jsonb_build_object('id', e.id, 'name', e.name, 'department', e.department, 'avatar_path', e.avatar_path),
        'category', case when c.id is null then null else jsonb_build_object('label', c.label) end
      ) as row
    from public.offset_leaves l
    left join public.employees e on e.id = l.employee_id
    left join public.hr_leave_categories c on c.id = l.category_id
    where (l.status = 'APPROVED' or l.employee_id = public.get_employee_id())
      and (p_start is null or l.date >= p_start)
      and (p_end is null or l.date < p_end)
  ) s;
$$;

create or replace function public.get_calendar_sil_leaves(p_start date default null, p_end date default null)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb)
  from (
    select l.created_at,
      jsonb_build_object(
        'id', l.id, 'employee_id', l.employee_id, 'date', l.date,
        'start_time', l.start_time, 'end_time', l.end_time, 'hours', l.hours,
        'status', l.status, 'leave_group_id', l.leave_group_id,
        'employee', jsonb_build_object('id', e.id, 'name', e.name, 'department', e.department, 'avatar_path', e.avatar_path),
        'category', case when c.id is null then null else jsonb_build_object('label', c.label) end
      ) as row
    from public.sil_leaves l
    left join public.employees e on e.id = l.employee_id
    left join public.hr_leave_categories c on c.id = l.category_id
    where (l.status = 'APPROVED' or l.employee_id = public.get_employee_id())
      and (p_start is null or l.date >= p_start)
      and (p_end is null or l.date < p_end)
  ) s;
$$;

revoke all on function public.get_calendar_offset_leaves(date, date) from public, anon;
revoke all on function public.get_calendar_sil_leaves(date, date) from public, anon;
grant execute on function public.get_calendar_offset_leaves(date, date) to authenticated;
grant execute on function public.get_calendar_sil_leaves(date, date) to authenticated;
