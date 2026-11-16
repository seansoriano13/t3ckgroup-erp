-- #1055 (spec #1054): Activities replace Meeting Requests.
-- An Activity has a type: MEETING, ADMIN_TASK, OPERATIONS_TASK or EVENT. Only a Meeting may have a Venue,
-- a meeting type (Onsite, Online, Hybrid) or a meeting link. facilitator_id now stores the Lead, any employee.
-- Only a department head can file an Event. One function, activity_needs_hr(), decides who approves: an Event,
-- or a Meeting with a Venue, goes to HR (PENDING_HR); everything else is APPROVED at once. An edit runs the
-- same rule again. Old rows become MEETING; rows already pending HR are not touched. The head columns stay.
-- Written as a file only. Apply it through the normal staging/prod path.

alter table public.meeting_requests
  add column if not exists activity_type text not null default 'MEETING';

alter table public.meeting_requests alter column meeting_type drop not null;

alter table public.meeting_requests drop constraint if exists meeting_requests_type_check;
alter table public.meeting_requests drop constraint if exists meeting_requests_type_rules;

alter table public.meeting_requests
  add constraint meeting_requests_activity_type_check
    check (activity_type in ('MEETING', 'ADMIN_TASK', 'OPERATIONS_TASK', 'EVENT')),
  add constraint meeting_requests_type_check
    check (meeting_type is null or meeting_type in ('ONSITE', 'ONLINE', 'HYBRID')),
  add constraint meeting_requests_type_rules check (
    case
      when activity_type = 'MEETING' then
        case meeting_type
          when 'ONSITE' then venue_id is not null and meeting_link is null
          when 'ONLINE' then venue_id is null and meeting_link is not null
          when 'HYBRID' then venue_id is not null and meeting_link is not null
          else false
        end
      else venue_id is null and meeting_type is null and meeting_link is null
    end
  );

-- The one place that decides whether HR must approve.
create or replace function public.activity_needs_hr(p_activity_type text, p_venue_id uuid)
returns boolean
language sql
immutable
as $function$
  select p_activity_type = 'EVENT' or (p_activity_type = 'MEETING' and p_venue_id is not null);
$function$;

-- Plain messages for the form; the constraints above are the real guard.
create or replace function public.activity_fields_check(p_activity_type text, p_type text, p_venue_id uuid, p_link text)
returns void
language plpgsql
immutable
as $function$
begin
  if p_activity_type not in ('MEETING', 'ADMIN_TASK', 'OPERATIONS_TASK', 'EVENT') then
    raise exception 'Choose an Activity type.' using errcode = '22023';
  end if;
  if p_activity_type = 'MEETING' then
    perform public.meeting_type_check(p_type, p_venue_id, p_link);
  elsif p_type is not null or p_venue_id is not null or p_link is not null then
    raise exception 'Only a Meeting has a Venue, a meeting type or a meeting link.' using errcode = '22023';
  end if;
end;
$function$;

drop function if exists public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[]);
drop function if exists public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[]);

create or replace function public.file_meeting_request(
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_facilitator_id uuid,
  p_purpose text,
  p_guests text[] default '{}',
  p_participant_ids uuid[] default '{}',
  p_head_id uuid default null,
  p_meeting_type text default null,
  p_meeting_link text default null,
  p_guest_emails text[] default '{}',
  p_activity_type text default 'MEETING'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_applicant uuid := public.get_employee_id();
  v_applicant_is_head boolean;
  v_atype text := upper(coalesce(p_activity_type, 'MEETING'));
  v_status text;
  v_head uuid;
  v_id uuid;
  v_guests text[];
  v_emails text[];
  v_link text := nullif(btrim(coalesce(p_meeting_link, '')), '');
  v_type text := nullif(upper(btrim(coalesce(p_meeting_type, ''))), '');
begin
  if v_applicant is null then
    raise exception 'Sign in to file an Activity.' using errcode = '42501';
  end if;

  if v_atype = 'MEETING' and v_type is null then
    v_type := 'ONSITE';
  end if;
  perform public.activity_fields_check(v_atype, v_type, p_venue_id, v_link);

  if v_atype = 'EVENT' then
    select coalesce(is_head, false) into v_applicant_is_head from public.employees where id = v_applicant;
    if not coalesce(v_applicant_is_head, false) then
      raise exception 'Only a department head can file an Event.' using errcode = '42501';
    end if;
  end if;

  if p_venue_id is not null and not exists (select 1 from public.calendar_venues where id = p_venue_id and active) then
    raise exception 'Choose a Venue that is open for booking.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.employees
    where id = p_facilitator_id and coalesce(is_deleted, false) = false
  ) then
    raise exception 'Choose a Lead.' using errcode = '22023';
  end if;

  if coalesce(btrim(p_purpose), '') = '' then
    raise exception 'Write the purpose of the Activity.' using errcode = '22023';
  end if;

  v_status := case when public.activity_needs_hr(v_atype, p_venue_id) then 'PENDING_HR' else 'APPROVED' end;
  v_head := null;

  select coalesce(array_agg(btrim(g.name) order by g.i), '{}'),
         coalesce(array_agg(coalesce(btrim(p_guest_emails[g.i]), '') order by g.i), '{}')
    into v_guests, v_emails
    from unnest(coalesce(p_guests, '{}')) with ordinality as g(name, i)
    where btrim(g.name) <> '';
  perform public.guest_emails_check(v_emails);

  insert into public.meeting_requests (
    applicant_id, venue_id, starts_at, ends_at, facilitator_id, purpose, guests, guest_emails, status, head_id,
    meeting_type, meeting_link, activity_type
  ) values (
    v_applicant, p_venue_id, p_starts_at, p_ends_at, p_facilitator_id, btrim(p_purpose), v_guests, v_emails, v_status, v_head,
    v_type, v_link, v_atype
  ) returning id into v_id;

  insert into public.meeting_request_participants (request_id, employee_id)
  select v_id, e.id from public.employees e
  where e.id = any(coalesce(p_participant_ids, '{}'))
  on conflict do nothing;

  perform public.log_meeting_request_event(
    v_id, v_applicant, 'FILED', null, v_status,
    jsonb_build_object('activity_type', v_atype, 'meeting_type', v_type, 'venue_id', p_venue_id, 'starts_at', p_starts_at, 'ends_at', p_ends_at,
                       'facilitator_id', p_facilitator_id, 'head_id', v_head),
    null
  );

  return v_id;
end;
$function$;

create or replace function public.edit_meeting_request(
  p_request_id uuid,
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_facilitator_id uuid,
  p_purpose text,
  p_guests text[] default '{}',
  p_participant_ids uuid[] default '{}',
  p_head_id uuid default null,
  p_meeting_type text default null,
  p_meeting_link text default null,
  p_guest_emails text[] default '{}',
  p_activity_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := public.get_employee_id();
  v_req public.meeting_requests%rowtype;
  v_applicant_is_head boolean;
  v_atype text;
  v_to text;
  v_head uuid;
  v_guests text[];
  v_emails text[];
  v_link text := nullif(btrim(coalesce(p_meeting_link, '')), '');
  v_type text := nullif(upper(btrim(coalesce(p_meeting_type, ''))), '');
  v_old_people uuid[];
  v_new_people uuid[];
  v_changed jsonb := '{}'::jsonb;
  v_time_changed boolean;
  v_restart boolean;
  v_purpose text := btrim(coalesce(p_purpose, ''));
begin
  if v_actor is null then
    raise exception 'Sign in to edit an Activity.' using errcode = '42501';
  end if;

  select * into v_req from public.meeting_requests where id = p_request_id for update;
  if not found then
    raise exception 'Activity not found.' using errcode = 'P0002';
  end if;

  if v_req.applicant_id <> v_actor then
    raise exception 'Only the person who filed this Activity can edit it.' using errcode = '42501';
  end if;

  if v_req.status not in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED') then
    raise exception 'A % Activity cannot be edited.', lower(v_req.status) using errcode = '22023';
  end if;

  if v_req.starts_at <= now() then
    raise exception 'This meeting has already started, so it can no longer be edited.' using errcode = '22023';
  end if;

  if p_starts_at < now() then
    raise exception 'A meeting cannot start in the past.' using errcode = '22023';
  end if;

  v_atype := upper(coalesce(p_activity_type, v_req.activity_type));
  if v_atype = 'MEETING' and v_type is null then
    v_type := 'ONSITE';
  end if;
  perform public.activity_fields_check(v_atype, v_type, p_venue_id, v_link);

  if p_venue_id is not null and not exists (
    select 1 from public.calendar_venues
    where id = p_venue_id and (active or id = v_req.venue_id)
  ) then
    raise exception 'Choose a Venue that is open for booking.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.employees
    where id = p_facilitator_id and coalesce(is_deleted, false) = false
  ) then
    raise exception 'Choose a Lead.' using errcode = '22023';
  end if;

  if v_purpose = '' then
    raise exception 'Write the purpose of the Activity.' using errcode = '22023';
  end if;

  select coalesce(is_head, false) into v_applicant_is_head from public.employees where id = v_actor;
  if v_atype = 'EVENT' and v_req.activity_type <> 'EVENT' and not coalesce(v_applicant_is_head, false) then
    raise exception 'Only a department head can file an Event.' using errcode = '42501';
  end if;

  v_head := null;

  -- The same rule as filing, run again on every edit.
  v_to := case
    when not public.activity_needs_hr(v_atype, p_venue_id) then 'APPROVED'
    when v_req.status = 'RETURNED' then 'RETURNED'
    else 'PENDING_HR'
  end;
  -- Approval starts over when the request moves back to a pending stage from a later one.
  v_restart := v_to <> v_req.status and v_to in ('PENDING_HEAD', 'PENDING_HR');

  select coalesce(array_agg(btrim(g.name) order by g.i), '{}'),
         coalesce(array_agg(coalesce(btrim(p_guest_emails[g.i]), '') order by g.i), '{}')
    into v_guests, v_emails
    from unnest(coalesce(p_guests, '{}')) with ordinality as g(name, i)
    where btrim(g.name) <> '';
  perform public.guest_emails_check(v_emails);

  select coalesce(array_agg(employee_id order by employee_id), '{}') into v_old_people
    from public.meeting_request_participants where request_id = p_request_id;
  select coalesce(array_agg(e.id order by e.id), '{}') into v_new_people
    from public.employees e where e.id = any(coalesce(p_participant_ids, '{}'));

  v_time_changed := v_req.starts_at <> p_starts_at or v_req.ends_at <> p_ends_at;

  if v_req.activity_type <> v_atype then
    v_changed := v_changed || jsonb_build_object('activity_type', jsonb_build_object('from', v_req.activity_type, 'to', v_atype));
  end if;
  if v_req.meeting_type is distinct from v_type then
    v_changed := v_changed || jsonb_build_object('meeting_type', jsonb_build_object('from', v_req.meeting_type, 'to', v_type));
  end if;
  if v_req.venue_id is distinct from p_venue_id then
    v_changed := v_changed || jsonb_build_object('venue_id', jsonb_build_object('from', v_req.venue_id, 'to', p_venue_id));
  end if;
  if v_req.meeting_link is distinct from v_link then
    v_changed := v_changed || jsonb_build_object('meeting_link', jsonb_build_object('from', v_req.meeting_link, 'to', v_link));
  end if;
  if v_req.starts_at <> p_starts_at then
    v_changed := v_changed || jsonb_build_object('starts_at', jsonb_build_object('from', v_req.starts_at, 'to', p_starts_at));
  end if;
  if v_req.ends_at <> p_ends_at then
    v_changed := v_changed || jsonb_build_object('ends_at', jsonb_build_object('from', v_req.ends_at, 'to', p_ends_at));
  end if;
  if v_req.facilitator_id <> p_facilitator_id then
    v_changed := v_changed || jsonb_build_object('facilitator_id', jsonb_build_object('from', v_req.facilitator_id, 'to', p_facilitator_id));
  end if;
  if v_req.purpose <> v_purpose then
    v_changed := v_changed || jsonb_build_object('purpose', jsonb_build_object('from', v_req.purpose, 'to', v_purpose));
  end if;
  if v_req.guests is distinct from v_guests or v_req.guest_emails is distinct from v_emails then
    v_changed := v_changed || jsonb_build_object('guests', jsonb_build_object('from', to_jsonb(v_req.guests), 'to', to_jsonb(v_guests)));
  end if;
  if v_old_people is distinct from v_new_people then
    v_changed := v_changed || jsonb_build_object('participant_ids', jsonb_build_object('from', to_jsonb(v_old_people), 'to', to_jsonb(v_new_people)));
  end if;
  if v_req.head_id is distinct from v_head then
    v_changed := v_changed || jsonb_build_object('head_id', jsonb_build_object('from', v_req.head_id, 'to', v_head));
  end if;

  update public.meeting_requests set
    activity_type = v_atype,
    meeting_type = v_type,
    venue_id = p_venue_id,
    meeting_link = v_link,
    starts_at = p_starts_at,
    ends_at = p_ends_at,
    facilitator_id = p_facilitator_id,
    purpose = v_purpose,
    guests = v_guests,
    guest_emails = v_emails,
    head_id = v_head,
    status = v_to,
    reminder_sent_at = case when v_time_changed then null else reminder_sent_at end,
    head_decided_at = case when v_restart then null else head_decided_at end,
    head_note = case when v_restart then null else head_note end,
    hr_override = case when v_restart then false else hr_override end,
    hr_decided_by = case when v_restart then null else hr_decided_by end,
    hr_decided_at = case when v_restart then null else hr_decided_at end,
    hr_note = case when v_restart then null else hr_note end
  where id = p_request_id;

  delete from public.meeting_request_participants where request_id = p_request_id;
  insert into public.meeting_request_participants (request_id, employee_id)
  select p_request_id, unnest(v_new_people);

  perform public.log_meeting_request_event(p_request_id, v_actor, 'EDITED', v_req.status, v_to, v_changed, null);

  return jsonb_build_object(
    'id', p_request_id,
    'action', 'EDITED',
    'from_status', v_req.status,
    'to_status', v_to,
    'changed_fields', v_changed,
    'head_id', v_head,
    'applicant_id', v_req.applicant_id,
    'facilitator_id', p_facilitator_id,
    'old_facilitator_id', v_req.facilitator_id,
    'participant_ids', to_jsonb(v_new_people),
    'old_participant_ids', to_jsonb(v_old_people)
  );
end;
$function$;

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
    left join public.calendar_venues v on v.id = m.venue_id
    join public.employees a on a.id = m.applicant_id
    join public.employees f on f.id = m.facilitator_id
    where m.status in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED')
      and (m.starts_at at time zone 'Asia/Manila')::date between p_from and p_to
  ) q
  order by q.manila_date, q.starts_at, q.id;
end;
$function$;

-- 15-minute reminder: covers every approved Activity; no "Venue" word when there is none.
create or replace function public.send_meeting_reminders()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count integer;
begin
  with due as (
    update public.meeting_requests r
       set reminder_sent_at = now()
     where r.status = 'APPROVED'
       and r.reminder_sent_at is null
       and r.starts_at > now()
       and r.starts_at <= now() + interval '15 minutes'
    returning r.id, r.applicant_id, r.facilitator_id, r.venue_id, r.meeting_type, r.starts_at, r.purpose
  ),
  people as (
    select d.id as request_id, d.applicant_id as person_id from due d
    union
    select d.id, d.facilitator_id from due d
    union
    select d.id, p.employee_id
      from due d
      join public.meeting_request_participants p on p.request_id = d.id
  ),
  ins as (
    insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
    select pe.person_id,
           null,
           'MEETING_REMINDER',
           'Activity starts soon',
           concat_ws(', ',
                     case
                       when v.name is not null then v.name
                       when d.meeting_type = 'ONLINE' then 'Online'
                     end,
                     to_char(d.starts_at at time zone 'Asia/Manila', 'Mon FMDD, FMHH12:MI AM')
           ) || ': ' || d.purpose,
           d.id
      from people pe
      join due d on d.id = pe.request_id
      left join public.calendar_venues v on v.id = d.venue_id
    returning 1
  )
  select count(*) into v_count from ins;

  return coalesce(v_count, 0);
end;
$function$;

revoke all on function public.send_meeting_reminders() from public, anon, authenticated;

revoke all on function public.calendar_entries(date, date, boolean) from public, anon;
grant execute on function public.calendar_entries(date, date, boolean) to authenticated;
revoke all on function public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text) from public, anon;
grant execute on function public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text) to authenticated;
revoke all on function public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text) from public, anon;
grant execute on function public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text) to authenticated;
revoke all on function public.activity_fields_check(text, text, uuid, text) from public, anon;
revoke all on function public.activity_needs_hr(text, uuid) from public, anon;
