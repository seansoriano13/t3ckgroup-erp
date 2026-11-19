-- #1084 (spec #1083, tracker A1): saving an edit with nothing changed no longer sends an approved Activity back to HR.
--
-- edit_meeting_request is re-created from its latest body (20261217140000_1064_activity_settings.sql) with one addition:
-- when no field differs from the saved Activity, it returns { action: 'NO_CHANGE', no_change: true } with the status as it
-- is, changes no row and writes no meeting_request_events row. A real change behaves exactly as before (it runs the
-- approval rule again and may go back to HR). The signature is unchanged, so no drop is needed.

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
    raise exception 'Only a department head can file the % type.', public.activity_type_phrase(v_atype) using errcode = '42501';
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
  perform public.activity_settings_check(v_atype, v_type, v_guests, v_req.activity_type, v_req.meeting_type, v_req.guests);

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

  -- #1084: an edit that changes no field is not an edit. The status stays (an approved Activity stays approved),
  -- no event row is written, and the caller is told so (the service then sends no notice and no audit line).
  -- Everything above ran first, so a bad value is still refused.
  if v_changed = '{}'::jsonb then
    return jsonb_build_object(
      'id', p_request_id,
      'action', 'NO_CHANGE',
      'no_change', true,
      'from_status', v_req.status,
      'to_status', v_req.status,
      'changed_fields', '{}'::jsonb,
      'head_id', v_req.head_id,
      'applicant_id', v_req.applicant_id,
      'facilitator_id', v_req.facilitator_id,
      'old_facilitator_id', v_req.facilitator_id,
      'participant_ids', to_jsonb(v_old_people),
      'old_participant_ids', to_jsonb(v_old_people)
    );
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

revoke all on function public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) from public, anon;
grant execute on function public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) to authenticated;
