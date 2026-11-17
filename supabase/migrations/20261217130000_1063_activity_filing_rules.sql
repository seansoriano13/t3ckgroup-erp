-- #1063 (spec #1062): heads file the task types, approvers do not wait.
-- The rules are fixed here; #1064 moves them into Activity settings.
--
-- * Who files: anyone may file a Meeting; only a department head may file an Admin Task, an Operations
--   Task or an Event (activity_can_file). An edit may keep an Activity's own type (an Admin Task a
--   non-head filed earlier stays editable and cancellable) but may not switch to a type the filer cannot file.
-- * Who approves: activity_needs_hr() is still the one place that decides, on filing and on every edit.
--   Only a Meeting with a Venue waits for HR, and never when the filer is HR or a Super Admin. Admin Tasks,
--   Operations Tasks and Events are approved on filing (the head filing them is the approval). The edit
--   runs the same rule, so an approver's own approved Activity stays approved.
-- * One time: PENDING_HR requests that HR or a Super Admin filed, and PENDING_HR Events that a head filed, are
--   approved now (hr_decided_at = now(), hr_decided_by left empty: the rule decided), each with an
--   APPROVED_BY_RULE history row, and the Lead and Participants are told
--   "You're on an Activity".
-- Written as a file only. Apply it through the normal staging/prod path.

-- ---- The rules -----------------------------------------------------------------------
create or replace function public.activity_is_approver(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((select coalesce(e.is_hr, false) or coalesce(e.is_super_admin, false)
                   from public.employees e where e.id = p_employee_id), false);
$function$;

create or replace function public.activity_can_file(p_employee_id uuid, p_activity_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_activity_type = 'MEETING' then p_employee_id is not null
    when p_activity_type in ('ADMIN_TASK', 'OPERATIONS_TASK', 'EVENT') then
      coalesce((select coalesce(e.is_head, false) from public.employees e where e.id = p_employee_id), false)
    else false
  end;
$function$;

create or replace function public.activity_type_phrase(p_activity_type text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case p_activity_type
    when 'ADMIN_TASK' then 'an Admin Task'
    when 'OPERATIONS_TASK' then 'an Operations Task'
    when 'EVENT' then 'an Event'
    else 'a Meeting'
  end;
$function$;

drop function if exists public.activity_needs_hr(text, uuid);
create or replace function public.activity_needs_hr(p_activity_type text, p_venue_id uuid, p_filer_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_activity_type = 'MEETING'
     and p_venue_id is not null
     and not public.activity_is_approver(p_filer_id);
$function$;

revoke all on function public.activity_is_approver(uuid) from public, anon, authenticated;
revoke all on function public.activity_can_file(uuid, text) from public, anon, authenticated;
revoke all on function public.activity_needs_hr(text, uuid, uuid) from public, anon, authenticated;

-- ---- File and edit -----------------------------------------------------------------------
drop function if exists public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb);
drop function if exists public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb);

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
  p_activity_type text default 'MEETING',
  p_days jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_applicant uuid := public.get_employee_id();
  v_atype text := upper(coalesce(p_activity_type, 'MEETING'));
  v_status text;
  v_head uuid;
  v_id uuid;
  v_guests text[];
  v_emails text[];
  v_link text := nullif(btrim(coalesce(p_meeting_link, '')), '');
  v_type text := nullif(upper(btrim(coalesce(p_meeting_type, ''))), '');
  v_days jsonb;
  v_first_start timestamptz;
  v_first_end timestamptz;
  v_last_end timestamptz;
begin
  if v_applicant is null then
    raise exception 'Sign in to file an Activity.' using errcode = '42501';
  end if;

  if v_atype = 'MEETING' and v_type is null then
    v_type := 'ONSITE';
  end if;
  perform public.activity_fields_check(v_atype, v_type, p_venue_id, v_link);
  v_days := public.activity_days_normalize(p_days, v_atype, p_starts_at, p_ends_at);

  if not public.activity_can_file(v_applicant, v_atype) then
    raise exception 'Only a department head can file %.', public.activity_type_phrase(v_atype) using errcode = '42501';
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

  v_status := case when public.activity_needs_hr(v_atype, p_venue_id, v_applicant) then 'PENDING_HR' else 'APPROVED' end;
  v_head := null;

  select coalesce(array_agg(btrim(g.name) order by g.i), '{}'),
         coalesce(array_agg(coalesce(btrim(p_guest_emails[g.i]), '') order by g.i), '{}')
    into v_guests, v_emails
    from unnest(coalesce(p_guests, '{}')) with ordinality as g(name, i)
    where btrim(g.name) <> '';
  perform public.guest_emails_check(v_emails);

  select (v_days->0->>'starts_at')::timestamptz, (v_days->0->>'ends_at')::timestamptz into v_first_start, v_first_end;
  select max(x.ends_at) into v_last_end from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz);

  -- The parent is inserted with the first day (its default-day trigger writes that day row);
  -- the other days follow, then the parent's end moves to the last day's end.
  insert into public.meeting_requests (
    applicant_id, venue_id, starts_at, ends_at, facilitator_id, purpose, guests, guest_emails, status, head_id,
    meeting_type, meeting_link, activity_type
  ) values (
    v_applicant, p_venue_id, v_first_start, v_first_end, p_facilitator_id, btrim(p_purpose), v_guests, v_emails, v_status, v_head,
    v_type, v_link, v_atype
  ) returning id into v_id;

  insert into public.meeting_request_days (request_id, starts_at, ends_at)
  select v_id, x.starts_at, x.ends_at
  from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz)
  where x.starts_at <> v_first_start;

  if v_last_end <> v_first_end then
    update public.meeting_requests set ends_at = v_last_end where id = v_id;
  end if;

  insert into public.meeting_request_participants (request_id, employee_id)
  select v_id, e.id from public.employees e
  where e.id = any(coalesce(p_participant_ids, '{}'))
  on conflict do nothing;

  perform public.log_meeting_request_event(
    v_id, v_applicant, 'FILED', null, v_status,
    jsonb_build_object('activity_type', v_atype, 'meeting_type', v_type, 'venue_id', p_venue_id, 'starts_at', v_first_start, 'ends_at', v_last_end,
                       'days', v_days, 'facilitator_id', p_facilitator_id, 'head_id', v_head),
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
  p_activity_type text default null,
  p_days jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := public.get_employee_id();
  v_req public.meeting_requests%rowtype;
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
  v_restart boolean;
  v_purpose text := btrim(coalesce(p_purpose, ''));
  v_days jsonb;
  v_old_days jsonb;
  v_new_start timestamptz;
  v_new_end timestamptz;
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

  -- Editable while at least one day has not started.
  if not exists (select 1 from public.meeting_request_days where request_id = p_request_id and starts_at > now()) then
    raise exception 'This Activity has already started, so it can no longer be edited.' using errcode = '22023';
  end if;

  v_atype := upper(coalesce(p_activity_type, v_req.activity_type));
  if v_atype = 'MEETING' and v_type is null then
    v_type := 'ONSITE';
  end if;
  perform public.activity_fields_check(v_atype, v_type, p_venue_id, v_link);
  v_days := public.activity_days_normalize(p_days, v_atype, p_starts_at, p_ends_at);

  -- Days that have started stay exactly as they are.
  if exists (
    select 1 from public.meeting_request_days d
    where d.request_id = p_request_id and d.starts_at <= now()
      and not exists (
        select 1 from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz)
        where x.starts_at = d.starts_at and x.ends_at = d.ends_at
      )
  ) then
    raise exception 'A day that has already started cannot be changed or removed.' using errcode = '22023';
  end if;
  -- Any day that is not already saved must be in the future.
  if exists (
    select 1 from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz)
    where x.starts_at < now()
      and not exists (
        select 1 from public.meeting_request_days d
        where d.request_id = p_request_id and d.starts_at = x.starts_at and d.ends_at = x.ends_at
      )
  ) then
    raise exception 'An Activity cannot start in the past.' using errcode = '22023';
  end if;

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

  -- An edit may keep the Activity's own type, even one its filer could not file today (an Admin Task a
  -- non-head filed before #1063). It may not switch to a type the filer cannot file.
  if v_atype <> v_req.activity_type and not public.activity_can_file(v_actor, v_atype) then
    raise exception 'Only a department head can file %.', public.activity_type_phrase(v_atype) using errcode = '42501';
  end if;

  v_head := null;

  -- The same rule as filing, run again on every edit: an approver's own Activity stays approved.
  v_to := case
    when not public.activity_needs_hr(v_atype, p_venue_id, v_req.applicant_id) then 'APPROVED'
    when v_req.status = 'RETURNED' then 'RETURNED'
    else 'PENDING_HR'
  end;
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

  select coalesce(jsonb_agg(jsonb_build_object('starts_at', d.starts_at, 'ends_at', d.ends_at) order by d.starts_at), '[]'::jsonb)
    into v_old_days from public.meeting_request_days d where d.request_id = p_request_id;
  select min(x.starts_at), max(x.ends_at) into v_new_start, v_new_end
    from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz);

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
  if v_req.starts_at <> v_new_start then
    v_changed := v_changed || jsonb_build_object('starts_at', jsonb_build_object('from', v_req.starts_at, 'to', v_new_start));
  end if;
  if v_req.ends_at <> v_new_end then
    v_changed := v_changed || jsonb_build_object('ends_at', jsonb_build_object('from', v_req.ends_at, 'to', v_new_end));
  end if;
  if jsonb_array_length(v_old_days) <> jsonb_array_length(v_days) or exists (
    select 1 from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz)
    where not exists (
      select 1 from public.meeting_request_days d
      where d.request_id = p_request_id and d.starts_at = x.starts_at and d.ends_at = x.ends_at
    )
  ) then
    v_changed := v_changed || jsonb_build_object('days', jsonb_build_object('from', v_old_days, 'to', v_days));
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

  -- Days: drop the ones not started that are no longer listed, add the ones not saved yet.
  delete from public.meeting_request_days d
  where d.request_id = p_request_id and d.starts_at > now()
    and not exists (
      select 1 from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz)
      where x.starts_at = d.starts_at and x.ends_at = d.ends_at
    );
  insert into public.meeting_request_days (request_id, starts_at, ends_at)
  select p_request_id, x.starts_at, x.ends_at
  from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz)
  where not exists (
    select 1 from public.meeting_request_days d
    where d.request_id = p_request_id and d.starts_at = x.starts_at and d.ends_at = x.ends_at
  );

  update public.meeting_requests set
    activity_type = v_atype,
    meeting_type = v_type,
    venue_id = p_venue_id,
    meeting_link = v_link,
    starts_at = v_new_start,
    ends_at = v_new_end,
    facilitator_id = p_facilitator_id,
    purpose = v_purpose,
    guests = v_guests,
    guest_emails = v_emails,
    head_id = v_head,
    status = v_to,
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

revoke all on function public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) from public, anon;
grant execute on function public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) to authenticated;
revoke all on function public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) from public, anon;
grant execute on function public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) to authenticated;

-- ---- One time: approve what the old rule left waiting --------------------------------------------
-- Each one gets an APPROVED_BY_RULE history row, and its Lead and Participants (not the filer) get
-- "You're on an Activity", the same note the app sends when an Activity goes straight onto the Calendar.
with moved as (
  update public.meeting_requests m
     set status = 'APPROVED',
         hr_decided_by = null,   -- decided by the rule, not a person
         hr_decided_at = now()
   where m.status = 'PENDING_HR'
     and (
       public.activity_is_approver(m.applicant_id)
       or (m.activity_type = 'EVENT'
           and coalesce((select e.is_head from public.employees e where e.id = m.applicant_id), false))
     )
  returning m.id, m.applicant_id, m.activity_type, m.facilitator_id, m.purpose, m.starts_at, m.ends_at
),
history as (
  insert into public.meeting_request_events (request_id, actor_id, action, from_status, to_status, changed_fields, note)
  select id, applicant_id, 'APPROVED_BY_RULE', 'PENDING_HR', 'APPROVED', null,
         'Approved by the filing rules (#1063): this Activity no longer waits for HR.'
    from moved
  returning 1
),
people as (
  select mv.id as request_id, mv.facilitator_id as person_id from moved mv
  union
  select mv.id, p.employee_id from moved mv join public.meeting_request_participants p on p.request_id = mv.id
)
insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
select pe.person_id,
       null,
       'MEETING_APPROVED',
       'You''re on an Activity',
       case mv.activity_type
         when 'ADMIN_TASK' then 'Admin Task'
         when 'OPERATIONS_TASK' then 'Operations Task'
         when 'EVENT' then 'Event'
         else 'Meeting'
       end
       || ': '
       || to_char(mv.starts_at at time zone 'Asia/Manila', 'Mon FMDD, YYYY')
       || case
            when (mv.starts_at at time zone 'Asia/Manila')::date <> (mv.ends_at at time zone 'Asia/Manila')::date
              then ' to ' || to_char(mv.ends_at at time zone 'Asia/Manila', 'Mon FMDD, YYYY')
            else ''
          end
       || ', ' || to_char(mv.starts_at at time zone 'Asia/Manila', 'FMHH12:MI AM')
       || ' to ' || to_char(mv.ends_at at time zone 'Asia/Manila', 'FMHH12:MI AM')
       || ': ' || mv.purpose
       || '. Scheduled by ' || coalesce(a.name, 'someone') || '.',
       mv.id
  from people pe
  join moved mv on mv.id = pe.request_id
  left join public.employees a on a.id = mv.applicant_id
 where pe.person_id is not null
   and pe.person_id <> mv.applicant_id;
