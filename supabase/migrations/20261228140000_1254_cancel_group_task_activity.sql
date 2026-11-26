-- #1254 (spec #1246): cancelling a Group Task can cancel its Calendar entry (Activity) too.
-- cancel_group_task_activity(p_group_task_id): for anyone who may cancel that Group Task, even when someone
-- else filed the Activity (department heads, HR and Super Admins, as the Group Task window offers). Refused unless the Group Task is already Cancelled. Cancels the way
-- cancel_meeting_request does (#1194 body), with the reason "Group Task cancelled". The caller sends the
-- notices from the returned jsonb, exactly as it does after cancel_meeting_request.
create or replace function public.cancel_group_task_activity(p_group_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := public.get_employee_id();
  v_task public.committee_tasks%rowtype;
  v_req public.meeting_requests%rowtype;
  v_reason constant text := 'Group Task cancelled';
  v_left_end timestamptz;
  v_over boolean;
begin
  if v_actor is null then
    raise exception 'Sign in to cancel an Activity.' using errcode = '42501';
  end if;

  select * into v_task from public.committee_tasks where id = p_group_task_id;
  if not found then
    raise exception 'Group Task not found.' using errcode = 'P0002';
  end if;

  -- Who can cancel a Group Task from the app: department heads, HR and Super Admins (the Cancel button is
  -- shown to them only). A Stage Action Group Task is no exception here: the app offers it no cancel either.
  if not public.can_manage_group_tasks() then
    raise exception 'Only department heads, HR and Super Admins can cancel a Group Task''s Calendar entry.' using errcode = '42501';
  end if;

  if v_task.status is distinct from 'CANCELLED' then
    raise exception 'Cancel the Group Task first.' using errcode = '22023';
  end if;

  select * into v_req from public.meeting_requests
   where group_task_id = p_group_task_id and status not in ('DECLINED', 'CANCELLED')
   for update;
  if not found then
    raise exception 'This Group Task has no live Activity on the Calendar.' using errcode = 'P0002';
  end if;

  v_over := not exists (select 1 from public.meeting_request_days where request_id = v_req.id and starts_at > now());

  if exists (select 1 from public.meeting_request_days where request_id = v_req.id and starts_at <= now()) then
    delete from public.meeting_request_days where request_id = v_req.id and starts_at > now();
    select max(ends_at) into v_left_end from public.meeting_request_days where request_id = v_req.id;
  end if;

  update public.meeting_requests set
    status = 'CANCELLED',
    cancel_reason = v_reason,
    cancelled_by = v_actor,
    cancelled_at = case when v_req.status = 'APPROVED' and not v_over then now() else null end,
    ends_at = coalesce(v_left_end, ends_at)
  where id = v_req.id;

  perform public.log_meeting_request_event(v_req.id, v_actor, 'GROUP_TASK_CANCELLED', v_req.status, 'CANCELLED', null, v_reason);

  return jsonb_build_object(
    'id', v_req.id,
    'action', 'GROUP_TASK_CANCELLED',
    'from_status', v_req.status,
    'to_status', 'CANCELLED',
    'after_day', v_over,
    'head_id', v_req.head_id,
    'applicant_id', v_req.applicant_id,
    'facilitator_id', v_req.facilitator_id,
    'participant_ids', coalesce((
      select jsonb_agg(mp.employee_id) from public.meeting_request_participants mp where mp.request_id = v_req.id
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.cancel_group_task_activity(uuid) from public, anon;
grant execute on function public.cancel_group_task_activity(uuid) to authenticated;
