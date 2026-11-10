-- #624 (spec #609): Head and HR decide Meeting Requests (ADR 0013, ADR 0038).
--
-- One plpgsql function per action, each writing its event row in the same
-- transaction (log_meeting_request_event, #619):
--
--   decide_meeting_request(request, decision, note)
--     decision APPROVE | DECLINE | RETURN. Which step it is follows the status:
--       PENDING_HEAD  routed head, HR or a Super Admin  (APPROVE -> PENDING_HR)
--       PENDING_HR    HR or a Super Admin               (APPROVE -> APPROVED)
--     DECLINE -> DECLINED and RETURN -> RETURNED, each with a required note.
--     Nobody decides their own request.
--   override_meeting_request_head(request, reason)
--     HR or a Super Admin skips a pending head step with a reason: PENDING_HR,
--     hr_override = true, who and why on the event row.
--
-- A Super Admin acts as HR here, the same as in the Time Off queue. Written as
-- a file only. Apply it through the normal staging/prod path.

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
    raise exception 'Sign in to decide a Meeting Request.' using errcode = '42501';
  end if;

  if p_decision not in ('APPROVE', 'DECLINE', 'RETURN') then
    raise exception 'Unsupported decision: %.', p_decision using errcode = '22023';
  end if;

  select coalesce(e.is_hr, false) or coalesce(e.is_super_admin, false)
    into v_is_hr from public.employees e where e.id = v_actor;
  v_is_hr := coalesce(v_is_hr, false);

  select * into v_req from public.meeting_requests where id = p_request_id for update;
  if not found then
    raise exception 'Meeting Request not found.' using errcode = 'P0002';
  end if;

  if v_req.status not in ('PENDING_HEAD', 'PENDING_HR') then
    raise exception 'This Meeting Request is not waiting for a decision.' using errcode = '22023';
  end if;

  if v_req.applicant_id = v_actor then
    raise exception 'You cannot decide your own Meeting Request.' using errcode = '42501';
  end if;

  if v_req.status = 'PENDING_HEAD' then
    if not (v_is_hr or v_req.head_id = v_actor) then
      raise exception 'Only the department head this request was routed to, or HR, can decide it.' using errcode = '42501';
    end if;
  elsif not v_is_hr then
    raise exception 'Only HR can give the final decision on a Meeting Request.' using errcode = '42501';
  end if;

  if p_decision in ('DECLINE', 'RETURN') and v_note is null then
    raise exception 'Write a note to % a Meeting Request.', lower(p_decision) using errcode = '22023';
  end if;

  if p_decision = 'APPROVE' then
    v_to := case when v_req.status = 'PENDING_HEAD' then 'PENDING_HR' else 'APPROVED' end;
    v_action := case when v_req.status = 'PENDING_HEAD' then 'HEAD_APPROVED' else 'HR_APPROVED' end;
  elsif p_decision = 'DECLINE' then
    v_to := 'DECLINED';
    v_action := case when v_req.status = 'PENDING_HEAD' then 'HEAD_DECLINED' else 'HR_DECLINED' end;
  else
    v_to := 'RETURNED';
    v_action := case when v_req.status = 'PENDING_HEAD' then 'HEAD_RETURNED' else 'HR_RETURNED' end;
  end if;

  if v_req.status = 'PENDING_HEAD' then
    update public.meeting_requests set
      status = v_to,
      head_decided_at = now(),
      head_note = v_note,
      return_note = case when p_decision = 'RETURN' then v_note else return_note end,
      returned_by = case when p_decision = 'RETURN' then v_actor else returned_by end
    where id = p_request_id;
  else
    update public.meeting_requests set
      status = v_to,
      hr_decided_by = v_actor,
      hr_decided_at = now(),
      hr_note = v_note,
      return_note = case when p_decision = 'RETURN' then v_note else return_note end,
      returned_by = case when p_decision = 'RETURN' then v_actor else returned_by end
    where id = p_request_id;
  end if;

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

revoke all on function public.decide_meeting_request(uuid, text, text) from public, anon;
grant execute on function public.decide_meeting_request(uuid, text, text) to authenticated;

create or replace function public.override_meeting_request_head(
  p_request_id uuid,
  p_reason text
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
begin
  if v_actor is null then
    raise exception 'Sign in to override the head step.' using errcode = '42501';
  end if;

  select coalesce(e.is_hr, false) or coalesce(e.is_super_admin, false)
    into v_is_hr from public.employees e where e.id = v_actor;
  if not coalesce(v_is_hr, false) then
    raise exception 'Only HR can skip the department head step.' using errcode = '42501';
  end if;

  select * into v_req from public.meeting_requests where id = p_request_id for update;
  if not found then
    raise exception 'Meeting Request not found.' using errcode = 'P0002';
  end if;

  if v_req.status <> 'PENDING_HEAD' then
    raise exception 'Only a request waiting for its head can have the head step skipped.' using errcode = '22023';
  end if;

  if v_req.applicant_id = v_actor then
    raise exception 'You cannot override the head step on your own Meeting Request.' using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'Write the reason for skipping the head step.' using errcode = '22023';
  end if;

  update public.meeting_requests set
    status = 'PENDING_HR',
    hr_override = true,
    hr_decided_by = v_actor,
    hr_note = v_reason
  where id = p_request_id;

  perform public.log_meeting_request_event(
    p_request_id, v_actor, 'HR_OVERRIDE', v_req.status, 'PENDING_HR',
    jsonb_build_object('hr_override', true, 'routed_head_id', v_req.head_id), v_reason
  );

  return jsonb_build_object(
    'id', p_request_id,
    'action', 'HR_OVERRIDE',
    'from_status', v_req.status,
    'to_status', 'PENDING_HR',
    'applicant_id', v_req.applicant_id,
    'facilitator_id', v_req.facilitator_id,
    'participant_ids', '[]'::jsonb
  );
end;
$function$;

revoke all on function public.override_meeting_request_head(uuid, text) from public, anon;
grant execute on function public.override_meeting_request_head(uuid, text) to authenticated;
