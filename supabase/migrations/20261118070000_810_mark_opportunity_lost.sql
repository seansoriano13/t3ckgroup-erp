-- #810 (parent #799, ADR 0049) — Mark as Lost on a Flow Canvas deal.
--
-- mark_opportunity_lost is the only way to lose a deal. This ticket handles a
-- deal on a Flow Canvas flow (flow_stage_id set). #812 adds the old-pipeline
-- branch to the SAME function (the `flow_stage_id is null` branch below is the
-- hook); #813 adds Reopen, which reads lost_from_flow_stage_id.
--
-- Permission is the one a normal Stage move uses (sor_guard_stage_move):
-- sor_access_level = 'full' and not shut out of the Stage. Stage Fields and
-- Stage Conditions are client-side gates, so a plain stage update skips them,
-- the way a Return does. The visit trigger closes the Stage Visit and opens
-- one on the Lost Stage. Nothing is cancelled.

alter table public.sales_opportunities
  add column if not exists lost_reason_code text,
  add column if not exists lost_from_flow_stage_id uuid references public.flow_stages (id) on delete set null;

alter table public.sales_opportunities
  drop constraint if exists sales_opportunities_lost_reason_code_check;
alter table public.sales_opportunities
  add constraint sales_opportunities_lost_reason_code_check
  check (lost_reason_code is null or lost_reason_code in (
    'NO_RESPONSE', 'PRICE_TOO_HIGH', 'LOST_TO_COMPETITOR', 'CLIENT_CANCELLED',
    'NO_BUDGET', 'REQUIREMENTS_NOT_MET', 'OTHER'
  ));

comment on column public.sales_opportunities.lost_reason_code is
  'Why the deal was lost: a code from the fixed Lost reason list (src/constants/sor.js LOST_REASONS). lost_reason holds the free-text note. A deal with text but no code reads as "Other: <text>". Cleared by Reopen.';
comment on column public.sales_opportunities.lost_from_flow_stage_id is
  'The Flow Canvas Stage the deal was lost from, so Reopen can put it back. Set by mark_opportunity_lost.';

create or replace function public.mark_opportunity_lost(
  p_opportunity_id uuid,
  p_reason_code text,
  p_note text default null,
  p_lost_stage_id uuid default null
)
returns public.sales_opportunities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_opp public.sales_opportunities;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_code text := nullif(btrim(coalesce(p_reason_code, '')), '');
  v_label text;
  v_data jsonb;
  v_won uuid;
  v_from jsonb;
  v_lost_ids uuid[];
  v_to_id uuid;
  v_content text;
  v_meta jsonb;
  v_request uuid;
begin
  if v_code is null then
    raise exception 'Mark as Lost: pick a reason.' using errcode = 'P0001';
  end if;
  v_label := case v_code
    when 'NO_RESPONSE' then 'No response from client'
    when 'PRICE_TOO_HIGH' then 'Price too high'
    when 'LOST_TO_COMPETITOR' then 'Lost to competitor'
    when 'CLIENT_CANCELLED' then 'Client cancelled the project'
    when 'NO_BUDGET' then 'No budget / not approved'
    when 'REQUIREMENTS_NOT_MET' then 'Did not meet the requirements'
    when 'OTHER' then 'Other'
    else null
  end;
  if v_label is null then
    raise exception 'Mark as Lost: that is not a reason on the list.' using errcode = 'P0001';
  end if;
  if v_code = 'OTHER' and v_note is null then
    raise exception 'Mark as Lost: say what happened when the reason is Other.' using errcode = 'P0001';
  end if;

  select * into v_opp from public.sales_opportunities
    where id = p_opportunity_id and coalesce(is_deleted, false) = false
    for update;
  if v_opp.id is null then
    raise exception 'Mark as Lost: that SOR could not be found.' using errcode = 'P0002';
  end if;

  -- Same check as moving the Stage (sor_guard_stage_move).
  if v_actor is null or public.sor_access_level(v_opp.id) <> 'full' then
    raise exception 'You do not have access to move this stage.' using errcode = '42501';
  end if;
  if v_opp.flow_stage_id is not null
     and public.sor_is_stage_shut_out(v_opp, v_actor, v_opp.flow_stage_id) then
    raise exception 'This stage is restricted — you cannot move this SOR.' using errcode = '42501';
  end if;

  if v_opp.flow_stage_id is null then
    -- #812 adds the old-pipeline (status code) branch here.
    raise exception 'Mark as Lost: this deal is not on a Flow Canvas flow.' using errcode = 'P0001';
  end if;

  if v_opp.flow_snapshot_id is null then
    raise exception 'This deal has no Flow Snapshot on record, so it cannot be moved. A Super Admin needs to assign one first.'
      using errcode = 'P0001';
  end if;

  select snapshot_data into v_data from public.flow_snapshots where id = v_opp.flow_snapshot_id;
  v_won := nullif(v_data->>'wonStageId', '')::uuid;

  select st into v_from
    from jsonb_array_elements(coalesce(v_data->'stages', '[]'::jsonb)) st
    where (st->>'id')::uuid = v_opp.flow_stage_id;
  if v_from is null then
    raise exception 'That is not a Stage in this deal''s flow.' using errcode = 'P0001';
  end if;
  if coalesce((v_from->>'is_terminal')::boolean, false) then
    raise exception 'Mark as Lost: this deal is already closed.' using errcode = 'P0001';
  end if;

  select coalesce(array_agg((st->>'id')::uuid), '{}') into v_lost_ids
    from jsonb_array_elements(coalesce(v_data->'stages', '[]'::jsonb)) st
    where coalesce((st->>'is_terminal')::boolean, false)
      and st->>'terminal_outcome' = 'lost'
      and (v_won is null or (st->>'id')::uuid <> v_won);

  if cardinality(v_lost_ids) = 0 then
    raise exception 'This flow has no Lost Stage. Add one in Flow Canvas.' using errcode = 'P0001';
  end if;
  if p_lost_stage_id is not null then
    if not (p_lost_stage_id = any (v_lost_ids)) then
      raise exception 'Mark as Lost: that is not a Lost Stage of this deal''s flow.' using errcode = 'P0001';
    end if;
    v_to_id := p_lost_stage_id;
  elsif cardinality(v_lost_ids) > 1 then
    raise exception 'Mark as Lost: this flow has more than one Lost Stage. Pick which one.' using errcode = 'P0001';
  else
    v_to_id := v_lost_ids[1];
  end if;

  -- The move itself: the visit trigger closes the open Stage Visit and opens
  -- one on the Lost Stage; the move guard re-checks the permission above.
  update public.sales_opportunities
    set flow_stage_id = v_to_id,
        lost_reason_code = v_code,
        lost_reason = v_note,
        lost_from_flow_stage_id = v_opp.flow_stage_id
    where id = v_opp.id
    returning * into v_opp;

  v_content := 'Deal marked Lost: ' || v_label || coalesce(' — ' || v_note, '');
  v_meta := jsonb_build_object(
    'event', 'MARKED_LOST',
    'from', v_from->>'id',
    'to', v_to_id,
    'reasonCode', v_code,
    'reason', v_label,
    'note', v_note,
    'employeeId', v_actor
  );

  insert into public.sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
  values (v_opp.id, v_actor, 'SYSTEM', v_content, v_meta);

  insert into public.system_audit_logs (author_id, entity_type, entity_id, content, type, metadata)
  values (v_actor, 'OPPORTUNITY', v_opp.id::text, v_content, 'SYSTEM', v_meta);

  -- Tell the Purchase Request chat, when there is one. Nothing is cancelled.
  select id into v_request from public.purchase_requests where opportunity_id = v_opp.id;
  if v_request is not null then
    insert into public.purchase_request_messages (request_id, author_id, content, metadata)
    values (
      v_request, v_actor,
      v_content,
      jsonb_build_object('event', 'deal_marked_lost', 'reason_code', v_code)
    );
  end if;

  return v_opp;
end;
$$;

comment on function public.mark_opportunity_lost(uuid, text, text, uuid) is
  'The only way to lose a deal (#810). Same permission as a Stage move; skips Stage Fields and Conditions; moves to the flow''s Lost Stage (p_lost_stage_id when there are several), records the Stage it came from, writes history, posts in the Purchase Request chat, cancels nothing. Old-pipeline branch: #812. Reopen: #813.';

revoke all on function public.mark_opportunity_lost(uuid, text, text, uuid) from public, anon;
grant execute on function public.mark_opportunity_lost(uuid, text, text, uuid) to authenticated;
