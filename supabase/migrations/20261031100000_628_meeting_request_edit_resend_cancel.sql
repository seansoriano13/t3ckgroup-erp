-- #628 (spec #609): Edit, send again and cancel a Meeting Request (ADR 0013, ADR 0038).
--
-- One plpgsql function per action, each writing its event row (with the changed
-- fields) in the same transaction through log_meeting_request_event (#619):
--
--   edit_meeting_request(...)    applicant only, before the meeting starts.
--                                PENDING_HEAD stays; PENDING_HR and APPROVED go back
--                                to PENDING_HEAD (PENDING_HR for a head applicant);
--                                RETURNED stays RETURNED. A new time clears reminder_sent_at.
--   resend_meeting_request(id)   applicant sends a RETURNED request again:
--                                PENDING_HEAD, or PENDING_HR for a head applicant.
--   cancel_meeting_request(id, reason)
--                                the applicant, any non-final request before it starts;
--                                HR / Super Admin, any upcoming one, reason required.
--
-- Declined and cancelled are final; the double-booking constraint already ignores
-- them, so their slot is free at once. A request at or past its start is read-only.
-- The time rules (same Manila day, quarter hours, end after start) are table
-- constraints; the double-booking exclusion fires on update too.
--
-- Written as a file only. Apply it through the normal staging/prod path.

create or replace function public.edit_meeting_request(
  p_request_id uuid,
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_facilitator_id uuid,
  p_purpose text,
  p_guests text[] default '{}',
  p_participant_ids uuid[] default '{}',
  p_head_id uuid default null
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
  v_to text;
  v_head uuid;
  v_guests text[];
  v_old_people uuid[];
  v_new_people uuid[];
  v_changed jsonb := '{}'::jsonb;
  v_time_changed boolean;
  v_restart boolean;
  v_purpose text := btrim(coalesce(p_purpose, ''));
begin
  if v_actor is null then
    raise exception 'Sign in to edit a Meeting Request.' using errcode = '42501';
  end if;

  select * into v_req from public.meeting_requests where id = p_request_id for update;
  if not found then
    raise exception 'Meeting Request not found.' using errcode = 'P0002';
  end if;

  if v_req.applicant_id <> v_actor then
    raise exception 'Only the person who filed this Meeting Request can edit it.' using errcode = '42501';
  end if;

  if v_req.status not in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED') then
    raise exception 'A % Meeting Request cannot be edited.', lower(v_req.status) using errcode = '22023';
  end if;

  if v_req.starts_at <= now() then
    raise exception 'This meeting has already started, so it can no longer be edited.' using errcode = '22023';
  end if;

  if p_starts_at < now() then
    raise exception 'A meeting cannot start in the past.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.calendar_venues
    where id = p_venue_id and (active or id = v_req.venue_id)
  ) then
    raise exception 'Choose a Venue that is open for booking.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.employees
    where id = p_facilitator_id and coalesce(is_head, false) and coalesce(is_deleted, false) = false
  ) then
    raise exception 'The Facilitator must be a department head.' using errcode = '22023';
  end if;

  if v_purpose = '' then
    raise exception 'Write the purpose of the meeting.' using errcode = '22023';
  end if;

  select coalesce(is_head, false) into v_applicant_is_head from public.employees where id = v_actor;

  v_head := coalesce(p_head_id, v_req.head_id);
  if v_applicant_is_head then
    v_head := null;
  elsif v_head is null or not exists (
    select 1 from public.employees
    where id = v_head and coalesce(is_head, false) and coalesce(is_deleted, false) = false
  ) then
    raise exception 'Choose the department head who approves this request.' using errcode = '22023';
  end if;

  v_to := case
    when v_req.status = 'PENDING_HEAD' then 'PENDING_HEAD'
    when v_req.status = 'RETURNED' then 'RETURNED'
    when v_applicant_is_head then 'PENDING_HR'
    else 'PENDING_HEAD'
  end;
  -- Approval starts over when the request moves back to a pending stage from a later one.
  v_restart := v_to <> v_req.status and v_to in ('PENDING_HEAD', 'PENDING_HR');

  select coalesce(array_agg(btrim(g)) filter (where btrim(g) <> ''), '{}')
    into v_guests from unnest(coalesce(p_guests, '{}')) as g;

  select coalesce(array_agg(employee_id order by employee_id), '{}') into v_old_people
    from public.meeting_request_participants where request_id = p_request_id;
  select coalesce(array_agg(e.id order by e.id), '{}') into v_new_people
    from public.employees e where e.id = any(coalesce(p_participant_ids, '{}'));

  v_time_changed := v_req.starts_at <> p_starts_at or v_req.ends_at <> p_ends_at;

  if v_req.venue_id <> p_venue_id then
    v_changed := v_changed || jsonb_build_object('venue_id', jsonb_build_object('from', v_req.venue_id, 'to', p_venue_id));
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
  if v_req.guests is distinct from v_guests then
    v_changed := v_changed || jsonb_build_object('guests', jsonb_build_object('from', to_jsonb(v_req.guests), 'to', to_jsonb(v_guests)));
  end if;
  if v_old_people is distinct from v_new_people then
    v_changed := v_changed || jsonb_build_object('participant_ids', jsonb_build_object('from', to_jsonb(v_old_people), 'to', to_jsonb(v_new_people)));
  end if;
  if v_req.head_id is distinct from v_head then
    v_changed := v_changed || jsonb_build_object('head_id', jsonb_build_object('from', v_req.head_id, 'to', v_head));
  end if;

  update public.meeting_requests set
    venue_id = p_venue_id,
    starts_at = p_starts_at,
    ends_at = p_ends_at,
    facilitator_id = p_facilitator_id,
    purpose = v_purpose,
    guests = v_guests,
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

revoke all on function public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid) from public, anon;
grant execute on function public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid) to authenticated;

create or replace function public.resend_meeting_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := public.get_employee_id();
  v_req public.meeting_requests%rowtype;
  v_is_head boolean;
  v_to text;
begin
  if v_actor is null then
    raise exception 'Sign in to send a Meeting Request again.' using errcode = '42501';
  end if;

  select * into v_req from public.meeting_requests where id = p_request_id for update;
  if not found then
    raise exception 'Meeting Request not found.' using errcode = 'P0002';
  end if;

  if v_req.applicant_id <> v_actor then
    raise exception 'Only the person who filed this Meeting Request can send it again.' using errcode = '42501';
  end if;

  if v_req.status <> 'RETURNED' then
    raise exception 'Only a returned Meeting Request can be sent again.' using errcode = '22023';
  end if;

  if v_req.starts_at <= now() then
    raise exception 'This meeting has already started, so it can no longer be sent again.' using errcode = '22023';
  end if;

  select coalesce(is_head, false) into v_is_head from public.employees where id = v_actor;
  v_to := case when v_is_head then 'PENDING_HR' else 'PENDING_HEAD' end;

  if v_to = 'PENDING_HEAD' and v_req.head_id is null then
    raise exception 'Choose the department head who approves this request.' using errcode = '22023';
  end if;

  update public.meeting_requests set
    status = v_to,
    head_decided_at = null, head_note = null,
    hr_override = false, hr_decided_by = null, hr_decided_at = null, hr_note = null
  where id = p_request_id;

  perform public.log_meeting_request_event(p_request_id, v_actor, 'RESENT', v_req.status, v_to, null, null);

  return jsonb_build_object(
    'id', p_request_id,
    'action', 'RESENT',
    'from_status', v_req.status,
    'to_status', v_to,
    'head_id', v_req.head_id,
    'applicant_id', v_req.applicant_id,
    'facilitator_id', v_req.facilitator_id,
    'participant_ids', coalesce((
      select jsonb_agg(mp.employee_id) from public.meeting_request_participants mp where mp.request_id = p_request_id
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.resend_meeting_request(uuid) from public, anon;
grant execute on function public.resend_meeting_request(uuid) to authenticated;

create or replace function public.cancel_meeting_request(
  p_request_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := public.get_employee_id();
  v_is_hr boolean := false;
  v_req public.meeting_requests%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_by_applicant boolean;
  v_action text;
begin
  if v_actor is null then
    raise exception 'Sign in to cancel a Meeting Request.' using errcode = '42501';
  end if;

  select coalesce(e.is_hr, false) or coalesce(e.is_super_admin, false)
    into v_is_hr from public.employees e where e.id = v_actor;
  v_is_hr := coalesce(v_is_hr, false);

  select * into v_req from public.meeting_requests where id = p_request_id for update;
  if not found then
    raise exception 'Meeting Request not found.' using errcode = 'P0002';
  end if;

  v_by_applicant := v_req.applicant_id = v_actor;
  if not (v_by_applicant or v_is_hr) then
    raise exception 'Only the applicant, HR or a Super Admin can cancel this Meeting Request.' using errcode = '42501';
  end if;

  if v_req.status not in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED') then
    raise exception 'A % Meeting Request is final and cannot be cancelled.', lower(v_req.status) using errcode = '22023';
  end if;

  if v_req.starts_at <= now() then
    raise exception 'This meeting has already started, so it can no longer be cancelled.' using errcode = '22023';
  end if;

  if not v_by_applicant and v_reason is null then
    raise exception 'Write the reason for cancelling this Meeting Request.' using errcode = '22023';
  end if;

  v_action := case when v_by_applicant then 'CANCELLED' else 'HR_CANCELLED' end;

  update public.meeting_requests set
    status = 'CANCELLED',
    cancel_reason = v_reason,
    cancelled_by = v_actor
  where id = p_request_id;

  perform public.log_meeting_request_event(p_request_id, v_actor, v_action, v_req.status, 'CANCELLED', null, v_reason);

  return jsonb_build_object(
    'id', p_request_id,
    'action', v_action,
    'from_status', v_req.status,
    'to_status', 'CANCELLED',
    'head_id', v_req.head_id,
    'applicant_id', v_req.applicant_id,
    'facilitator_id', v_req.facilitator_id,
    'participant_ids', coalesce((
      select jsonb_agg(mp.employee_id) from public.meeting_request_participants mp where mp.request_id = p_request_id
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.cancel_meeting_request(uuid, text) from public, anon;
grant execute on function public.cancel_meeting_request(uuid, text) to authenticated;
