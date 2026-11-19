-- #1089 (spec #1083, tracker D3): server messages say Activity, not "Meeting Request" or "meeting".
-- Display text only. Table, function and type names stay (CONTEXT.md). Bodies, grants and behaviour are the
-- latest definitions, word for word, except the messages:
--   decide_meeting_request, resend_meeting_request  (latest body: 20261116004000_748)
--   meeting_requests_guard_insert                   (latest body: 20261028300000_619)
-- file_meeting_request, edit_meeting_request and cancel_meeting_request already say Activity in their
-- latest bodies, so they are not redefined here. "A Meeting is one day." and the meeting type messages are
-- about the Meeting type, not about any Activity, so they stay.

create or replace function public.decide_meeting_request(
  p_request_id uuid,
  p_decision text,
  p_note text default null
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
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_to text;
  v_action text;
begin
  if v_actor is null then
    raise exception 'Sign in to decide an Activity.' using errcode = '42501';
  end if;

  if p_decision not in ('APPROVE', 'DECLINE', 'RETURN') then
    raise exception 'Unsupported decision: %.', p_decision using errcode = '22023';
  end if;

  select coalesce(e.is_hr, false) or coalesce(e.is_super_admin, false)
    into v_is_hr from public.employees e where e.id = v_actor;
  v_is_hr := coalesce(v_is_hr, false);

  select * into v_req from public.meeting_requests where id = p_request_id for update;
  if not found then
    raise exception 'Activity not found.' using errcode = 'P0002';
  end if;

  if v_req.status <> 'PENDING_HR' then
    raise exception 'This Activity is not waiting for a decision.' using errcode = '22023';
  end if;

  if v_req.applicant_id = v_actor then
    raise exception 'You cannot decide your own Activity.' using errcode = '42501';
  end if;

  if not v_is_hr then
    raise exception 'Only HR can decide an Activity.' using errcode = '42501';
  end if;

  if p_decision in ('DECLINE', 'RETURN') and v_note is null then
    raise exception 'Write a note to % an Activity.', lower(p_decision) using errcode = '22023';
  end if;

  v_to := case p_decision when 'APPROVE' then 'APPROVED' when 'DECLINE' then 'DECLINED' else 'RETURNED' end;
  v_action := case p_decision when 'APPROVE' then 'HR_APPROVED' when 'DECLINE' then 'HR_DECLINED' else 'HR_RETURNED' end;

  update public.meeting_requests set
    status = v_to,
    hr_decided_by = v_actor,
    hr_decided_at = now(),
    hr_note = v_note,
    return_note = case when p_decision = 'RETURN' then v_note else return_note end,
    returned_by = case when p_decision = 'RETURN' then v_actor else returned_by end
  where id = p_request_id;

  perform public.log_meeting_request_event(p_request_id, v_actor, v_action, v_req.status, v_to, null, v_note);

  return jsonb_build_object(
    'id', p_request_id,
    'action', v_action,
    'from_status', v_req.status,
    'to_status', v_to,
    'applicant_id', v_req.applicant_id,
    'facilitator_id', v_req.facilitator_id,
    'participant_ids', coalesce((
      select jsonb_agg(mp.employee_id) from public.meeting_request_participants mp where mp.request_id = p_request_id
    ), '[]'::jsonb)
  );
end;
$function$;

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
    raise exception 'Sign in to send an Activity again.' using errcode = '42501';
  end if;

  select * into v_req from public.meeting_requests where id = p_request_id for update;
  if not found then
    raise exception 'Activity not found.' using errcode = 'P0002';
  end if;

  if v_req.applicant_id <> v_actor then
    raise exception 'Only the person who filed this Activity can send it again.' using errcode = '42501';
  end if;

  if v_req.status <> 'RETURNED' then
    raise exception 'Only a returned Activity can be sent again.' using errcode = '22023';
  end if;

  if v_req.starts_at <= now() then
    raise exception 'This Activity has already started, so it can no longer be sent again.' using errcode = '22023';
  end if;

  v_to := 'PENDING_HR';

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

create or replace function public.meeting_requests_guard_insert()
returns trigger
language plpgsql
as $function$
begin
  if new.starts_at < now() then
    raise exception 'An Activity cannot start in the past.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

-- Grants are unchanged (create or replace keeps them); restated so this file stands alone.
revoke all on function public.decide_meeting_request(uuid, text, text) from public, anon;
grant execute on function public.decide_meeting_request(uuid, text, text) to authenticated;
revoke all on function public.resend_meeting_request(uuid) from public, anon;
grant execute on function public.resend_meeting_request(uuid) to authenticated;
