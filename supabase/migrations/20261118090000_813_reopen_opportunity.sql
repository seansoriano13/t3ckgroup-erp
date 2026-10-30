-- #813 (parent #799, ADR 0049) — Reopen a Lost deal.
--
-- reopen_opportunity is the only way out of a Lost Stage or status. It puts the
-- deal back where mark_opportunity_lost recorded it (lost_from_flow_stage_id for
-- a Flow Canvas deal, lost_from_status for an old-pipeline deal) and skips Stage
-- Fields and Stage Conditions, which are client-side gates a plain update never
-- meets. "A terminal stage cannot be left" is also client-side only
-- (moveAlongFlow); this function is not a normal move, so it is not subject to
-- it, and a Won terminal Stage is refused here because only a Lost deal reopens.
--
-- Permission is the one mark_opportunity_lost uses: a Stage move.
-- History is kept: the MARKED_LOST log stays. Only the deal's current loss
-- (reason code, note, lost_from_*) is cleared, so a second loss records afresh.

create or replace function public.reopen_opportunity(p_opportunity_id uuid)
returns public.sales_opportunities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_opp public.sales_opportunities;
  v_data jsonb;
  v_cur jsonb;
  v_status public.crm_pipeline_stages;
  v_from_text text;
  v_to_text text;
  v_prev_code text;
  v_content text := 'Deal reopened';
  v_meta jsonb;
  v_request uuid;
begin
  select * into v_opp from public.sales_opportunities
    where id = p_opportunity_id and coalesce(is_deleted, false) = false
    for update;
  if v_opp.id is null then
    raise exception 'Reopen: that SOR could not be found.' using errcode = 'P0002';
  end if;

  -- Same check as moving the Stage (sor_guard_stage_move).
  if v_actor is null or public.sor_access_level(v_opp.id) <> 'full' then
    raise exception 'You do not have access to move this stage.' using errcode = '42501';
  end if;

  v_prev_code := v_opp.lost_reason_code;

  if v_opp.flow_stage_id is not null then
    if v_opp.flow_snapshot_id is null then
      raise exception 'This deal has no Flow Snapshot on record, so it cannot be moved. A Super Admin needs to assign one first.'
        using errcode = 'P0001';
    end if;
    select snapshot_data into v_data from public.flow_snapshots where id = v_opp.flow_snapshot_id;
    select st into v_cur
      from jsonb_array_elements(coalesce(v_data->'stages', '[]'::jsonb)) st
      where (st->>'id')::uuid = v_opp.flow_stage_id;
    if v_cur is null
       or not coalesce((v_cur->>'is_terminal')::boolean, false)
       or v_cur->>'terminal_outcome' is distinct from 'lost' then
      raise exception 'Reopen: this deal is not Lost.' using errcode = 'P0001';
    end if;
    if v_opp.lost_from_flow_stage_id is null then
      raise exception 'Reopen: there is no record of the Stage this deal was lost from.' using errcode = 'P0001';
    end if;
    if public.sor_is_stage_shut_out(v_opp, v_actor, v_opp.lost_from_flow_stage_id) then
      raise exception 'This stage is restricted — you cannot move this SOR.' using errcode = '42501';
    end if;

    v_from_text := v_opp.flow_stage_id::text;
    v_to_text := v_opp.lost_from_flow_stage_id::text;

    update public.sales_opportunities
      set flow_stage_id = lost_from_flow_stage_id,
          lost_reason_code = null,
          lost_reason = null,
          lost_from_flow_stage_id = null,
          lost_from_status = null
      where id = v_opp.id
      returning * into v_opp;
  else
    select * into v_status from public.crm_pipeline_stages where code = v_opp.status;
    if v_status.code is null or not v_status.is_lost then
      raise exception 'Reopen: this deal is not Lost.' using errcode = 'P0001';
    end if;
    if v_opp.lost_from_status is null then
      raise exception 'Reopen: there is no record of the status this deal was lost from.' using errcode = 'P0001';
    end if;

    v_from_text := v_opp.status;
    v_to_text := v_opp.lost_from_status;

    update public.sales_opportunities
      set status = lost_from_status,
          lost_reason_code = null,
          lost_reason = null,
          lost_from_status = null,
          lost_from_flow_stage_id = null
      where id = v_opp.id
      returning * into v_opp;
  end if;

  v_meta := jsonb_build_object(
    'event', 'REOPENED',
    'from', v_from_text,
    'to', v_to_text,
    'previousReasonCode', v_prev_code,
    'employeeId', v_actor
  );

  insert into public.sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
  values (v_opp.id, v_actor, 'SYSTEM', v_content, v_meta);

  insert into public.system_audit_logs (author_id, entity_type, entity_id, content, type, metadata)
  values (v_actor, 'OPPORTUNITY', v_opp.id::text, v_content, 'SYSTEM', v_meta);

  select id into v_request from public.purchase_requests where opportunity_id = v_opp.id;
  if v_request is not null then
    insert into public.purchase_request_messages (request_id, author_id, content, metadata)
    values (v_request, v_actor, v_content, jsonb_build_object('event', 'deal_reopened'));
  end if;

  return v_opp;
end;
$$;

comment on function public.reopen_opportunity(uuid) is
  'The only way out of a Lost Stage or status (#813). Only on a Lost deal. Same permission as a Stage move; skips Stage Fields and Conditions; returns the deal to lost_from_flow_stage_id / lost_from_status; keeps the Lost history; clears the current loss reason; logs REOPENED; posts "Deal reopened" in the Purchase Request chat.';

revoke all on function public.reopen_opportunity(uuid) from public, anon;
grant execute on function public.reopen_opportunity(uuid) to authenticated;
