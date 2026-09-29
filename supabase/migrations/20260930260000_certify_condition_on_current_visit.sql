-- Issue #413 (found in #401, parent #384) — opportunityService.js's
-- satisfyCondition read "the current visit" with one request, then wrote the
-- tick with a second one. A Revert landing between the two moved the SOR off
-- the Stage in between: the write still went ahead, stamped with whatever
-- visit the first read had resolved, seconds after that visit had closed —
-- S94023 repro'd a tick landing on the visit the SOR had already left.
--
-- Moved into one atomic RPC: the visit is resolved and the row written in
-- the same transaction, and the write now refuses outright when the SOR is
-- no longer on the condition's own Stage, rather than silently landing
-- somewhere else. `p_actor_id` stays a plain parameter, same contract
-- opportunityService.js's client call already had (mirrors
-- sor_decide_action_run, not every RPC here resolves it from the session).
--
-- Every bare column reference below is qualified with a table alias: the
-- `returns table` columns are also this function's own OUT-parameter names
-- (id, opportunity_id, ...), and an unqualified reference to one of those
-- names is ambiguous against the same-named table column.

create or replace function public.sor_certify_condition(
  p_opportunity_id uuid,
  p_condition_id uuid,
  p_stage_id uuid,
  p_actor_id uuid
)
returns table (
  id uuid,
  opportunity_id uuid,
  condition_id uuid,
  satisfied_by uuid,
  satisfied_at timestamptz,
  stage_visit_id uuid,
  was_new boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_flow boolean;
  v_visit public.sor_stage_visits;
  v_existing public.sor_condition_status;
  v_row public.sor_condition_status;
begin
  select so.flow_stage_id is not null into v_has_flow
    from public.sales_opportunities so
    where so.id = p_opportunity_id and coalesce(so.is_deleted, false) = false;
  if v_has_flow is null then
    raise exception 'Certify: that SOR could not be found.' using errcode = 'P0002';
  end if;

  -- A legacy pipeline deal (no flow_stage_id, so no visit ever opens for it)
  -- keeps the pre-#203 opportunity-wide read: stage_visit_id null, same as
  -- the client-side read this replaces.
  if v_has_flow then
    select v.* into v_visit from public.sor_stage_visits v
      where v.opportunity_id = p_opportunity_id and v.left_at is null
      order by v.sequence desc limit 1;
    if v_visit.id is null or v_visit.flow_stage_id is distinct from p_stage_id then
      raise exception 'Certify: the SOR has left this condition''s Stage — the tick was not recorded.' using errcode = 'P0001';
    end if;
  end if;

  select s.* into v_existing from public.sor_condition_status s
    where s.opportunity_id = p_opportunity_id and s.condition_id = p_condition_id
      and s.stage_visit_id is not distinct from v_visit.id;
  if v_existing.id is not null then
    return query select
      v_existing.id, v_existing.opportunity_id, v_existing.condition_id,
      v_existing.satisfied_by, v_existing.satisfied_at, v_existing.stage_visit_id, false;
    return;
  end if;

  insert into public.sor_condition_status (opportunity_id, condition_id, satisfied_by, stage_visit_id)
  values (p_opportunity_id, p_condition_id, p_actor_id, v_visit.id)
  returning * into v_row;

  return query select
    v_row.id, v_row.opportunity_id, v_row.condition_id,
    v_row.satisfied_by, v_row.satisfied_at, v_row.stage_visit_id, true;
end;
$$;

revoke all on function public.sor_certify_condition(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.sor_certify_condition(uuid, uuid, uuid, uuid) to authenticated;
