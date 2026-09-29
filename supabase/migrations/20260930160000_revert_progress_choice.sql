-- Issue #392 (parent #384) — Revert when Stage Work was done: the reverter
-- chooses Keep progress (the left visit's work goes on hold, resumable by a
-- later Return) or Remove progress (that work is cancelled/closed off, never
-- deleted). Either choice ends with a new Stage Visit on the earlier Stage,
-- that Stage's own earlier work resumed onto it exactly as `sor_resume_stage_work`
-- resumes a Return — reusing that function rather than duplicating it. Someone
-- shut out of the Stage being left (`sor_is_stage_shut_out`, #296/ADR 0021)
-- is never asked: their revert always keeps progress.

alter table public.sor_stage_visits add column if not exists revert_choice text;
alter table public.sor_stage_visits drop constraint if exists sor_stage_visits_revert_choice_check;
alter table public.sor_stage_visits add constraint sor_stage_visits_revert_choice_check
  check (revert_choice in ('keep', 'remove'));

-- Adding a parameter changes the function's identity; the old one-arg
-- signature is dropped so the two-arg version (with its default) takes over
-- every existing call site unchanged.
drop function if exists public.sor_revert_stage(uuid);

create or replace function public.sor_revert_stage(p_opportunity_id uuid, p_progress_choice text default null)
returns public.sales_opportunities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_opp public.sales_opportunities;
  v_cur public.sor_stage_visits;
  v_prev public.sor_stage_visits;
  v_new_visit public.sor_stage_visits;
  v_latest_undone boolean;
  v_from_name text;
  v_to_name text;
  v_reason text;
  v_choice text;
  v_shut_out boolean;
  v_cancel text;
  v_content text;
  v_meta jsonb;
  v_title text;
  v_msg text;
  v_earlier uuid;
  v_earlier_snapshot uuid;
  v_next_seq integer;
begin
  select * into v_opp from public.sales_opportunities
    where id = p_opportunity_id and coalesce(is_deleted, false) = false
    for update;
  if v_opp.id is null then
    raise exception 'Revert: that SOR could not be found.' using errcode = 'P0002';
  end if;

  select * into v_cur from public.sor_stage_visits
    where opportunity_id = p_opportunity_id and left_at is null and undone_at is null
    order by sequence desc limit 1;
  if v_cur.id is null then
    raise exception 'Revert: this SOR is not on a Stage.' using errcode = 'P0001';
  end if;

  select undone_at is not null into v_latest_undone from public.sor_stage_visits
    where opportunity_id = p_opportunity_id order by sequence desc limit 1;
  if v_latest_undone then
    raise exception 'Revert: the last move was already reverted. Going further back takes a move.' using errcode = 'P0001';
  end if;

  select * into v_prev from public.sor_stage_visits
    where opportunity_id = p_opportunity_id and undone_at is null and sequence < v_cur.sequence
    order by sequence desc limit 1;
  if v_prev.id is null then
    raise exception 'Revert: this SOR has never moved, so there is nothing to revert.' using errcode = 'P0001';
  end if;

  if not (
    public.is_super_admin()
    or (v_actor is not null and (v_cur.entered_by = v_actor or v_opp.deal_owner_id = v_actor))
  ) then
    raise exception 'Revert: only whoever made the last move, the Deal Owner, or a Super Admin can revert it.' using errcode = '42501';
  end if;

  select name into v_from_name from public.flow_stages where id = v_cur.flow_stage_id;
  select name into v_to_name from public.flow_stages where id = v_prev.flow_stage_id;

  -- Stage Work done on the Stage being left: a progress choice decides it.
  v_reason := case
    when exists (
      select 1 from public.tasks t
      where t.stage_visit_id = v_cur.id and t.carried_from_visit_id is null and t.status is distinct from 'INCOMPLETE'
    ) or exists (
      select 1 from public.committee_tasks t
      where t.stage_visit_id = v_cur.id and t.carried_from_visit_id is null and t.status is distinct from 'ACTIVE'
    ) then 'a task created there has progressed'
    when exists (select 1 from public.sor_condition_status s where s.stage_visit_id = v_cur.id and s.carried_from_visit_id is null)
      then 'a tickbox was ticked or a condition file given'
    when exists (select 1 from public.sor_stage_field_values f where f.stage_visit_id = v_cur.id and f.carried_from_visit_id is null)
      then 'a Stage Field value was saved'
    when exists (
      select 1 from public.sor_action_runs r where r.stage_visit_id = v_cur.id and r.carried_from_visit_id is null and r.decided_by is not null
    ) then 'an Optional Action was decided'
    when exists (
      select 1 from public.sales_opportunity_logs l
      where l.opportunity_id = p_opportunity_id
        and l.stage_visit_id = v_cur.id
        and l.metadata->>'event' = 'FOLLOW_UP_LOGGED'
        and not (l.metadata ? 'carriedFromVisitId')
    ) then 'a follow-up was logged'
    else null
  end;

  v_shut_out := public.sor_is_stage_shut_out(v_opp, v_actor, v_cur.flow_stage_id);

  if v_reason is not null then
    v_choice := case when v_shut_out then 'keep' else p_progress_choice end;
    if v_choice is null then
      raise exception 'Revert: Stage Work was done on % (%), so it cannot be reverted without choosing what to do with that work.',
        coalesce(v_from_name, 'that Stage'), v_reason using errcode = 'P0001';
    end if;
    if v_choice not in ('keep', 'remove') then
      raise exception 'Revert: the progress choice must be "keep" or "remove".' using errcode = 'P0001';
    end if;
  end if;

  perform set_config('app.sor_revert', 'on', true);

  update public.sales_opportunities
    set flow_stage_id = v_prev.flow_stage_id,
        contract_date = case when v_cur.contract_date_stamped then null else contract_date end
    where id = p_opportunity_id
    returning * into v_opp;

  -- ADR 0027 — reverting a Return undoes its Resume: the carried work moves
  -- back to the earlier visit, and its open action tasks go back on hold, as
  -- leaving that Stage put them. Done first, so nothing below treats carried
  -- work as the reverted move's own.
  select id, flow_snapshot_id into v_earlier, v_earlier_snapshot
    from public.sor_stage_visits where resumed_into_visit_id = v_cur.id;
  if v_earlier is not null then
    update public.tasks set stage_visit_id = carried_from_visit_id, carried_from_visit_id = null
      where stage_visit_id = v_cur.id and carried_from_visit_id = v_earlier;
    update public.committee_tasks set stage_visit_id = carried_from_visit_id, carried_from_visit_id = null
      where stage_visit_id = v_cur.id and carried_from_visit_id = v_earlier;
    update public.sor_condition_status set stage_visit_id = carried_from_visit_id, carried_from_visit_id = null
      where stage_visit_id = v_cur.id and carried_from_visit_id = v_earlier;
    update public.sor_stage_field_values set stage_visit_id = carried_from_visit_id, carried_from_visit_id = null
      where stage_visit_id = v_cur.id and carried_from_visit_id = v_earlier;
    update public.sor_action_runs set stage_visit_id = carried_from_visit_id, carried_from_visit_id = null
      where stage_visit_id = v_cur.id and carried_from_visit_id = v_earlier;
    update public.sales_opportunity_logs
      set stage_visit_id = v_earlier,
          metadata = (metadata - 'carriedFromVisitId') || jsonb_build_object('stageVisitId', v_earlier)
      where opportunity_id = p_opportunity_id and stage_visit_id = v_cur.id
        and metadata->>'carriedFromVisitId' = v_earlier::text;

    update public.tasks
      set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_earlier
      where stage_visit_id = v_earlier and stage_action_id is not null
        and status in ('INCOMPLETE', 'AWAITING APPROVAL', 'NOT APPROVED')
        and not public.stage_action_carries_on(v_earlier_snapshot, stage_action_id);
    update public.committee_tasks
      set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_earlier
      where stage_visit_id = v_earlier and stage_action_id is not null
        and status = 'ACTIVE'
        and not public.stage_action_carries_on(v_earlier_snapshot, stage_action_id);

    update public.sor_stage_visits set resumed_at = null, resumed_by = null, resumed_into_visit_id = null
      where id = v_earlier;
  end if;

  -- Everyone the reverted move notified hears to disregard it (collected before
  -- the work is cancelled; the notifying rows themselves are left as history).
  v_title := coalesce(v_opp.project_title, 'this SOR');
  v_msg := format('The move into %s on "%s" was reverted. Disregard what it sent you.', coalesce(v_from_name, 'a Stage'), v_title);
  insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
  select distinct r.rid, v_actor, 'OPPORTUNITY_STAGE_REVERTED', 'Stage move reverted: ' || v_title, v_msg, p_opportunity_id::text
  from (
    select t.logged_by as rid from public.tasks t where t.stage_visit_id = v_cur.id
    union
    select m.employee_id from public.committee_task_members m
      join public.committee_tasks ct on ct.id = m.committee_task_id where ct.stage_visit_id = v_cur.id
    union
    select n.recipient_id from public.notifications n
      where n.type = 'OPPORTUNITY_ACTION_DECISION_DUE' and n.reference_id = p_opportunity_id::text
        and n.created_at >= v_cur.entered_at
  ) r
  where r.rid is not null and r.rid is distinct from v_actor;

  if v_reason is not null then
    -- Issue #392 — the choice decides the left visit's own work; either way a
    -- fresh visit on the earlier Stage resumes that Stage's own earlier work.
    update public.sor_stage_visits
      set revert_choice = v_choice,
          left_at = case when v_choice = 'keep' then now() else left_at end,
          left_by = case when v_choice = 'keep' then v_actor else left_by end,
          undone_at = case when v_choice = 'remove' then now() else undone_at end,
          undone_by = case when v_choice = 'remove' then v_actor else undone_by end
      where id = v_cur.id;

    if v_choice = 'keep' then
      update public.tasks
        set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_cur.id
        where stage_visit_id = v_cur.id and carried_from_visit_id is null
          and status in ('INCOMPLETE', 'AWAITING APPROVAL', 'NOT APPROVED');
      update public.committee_tasks
        set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_cur.id
        where stage_visit_id = v_cur.id and carried_from_visit_id is null
          and status = 'ACTIVE';
    else
      v_cancel := format('Cancelled: the Revert out of %s removed its progress.', coalesce(v_from_name, 'this Stage'));
      update public.tasks set status = 'DELETED', cancel_reason = v_cancel
        where stage_visit_id = v_cur.id and carried_from_visit_id is null and status not in ('COMPLETED', 'DELETED');
      update public.committee_tasks set status = 'CANCELLED', cancel_reason = v_cancel
        where stage_visit_id = v_cur.id and carried_from_visit_id is null and status in ('ACTIVE', 'ON_HOLD');
      update public.sor_action_runs
        set closed_off_at = now(), closed_off_reason = 'reverted'
        where stage_visit_id = v_cur.id and carried_from_visit_id is null and closed_off_at is null;
    end if;

    select coalesce(max(sequence), 0) + 1 into v_next_seq from public.sor_stage_visits where opportunity_id = p_opportunity_id;
    insert into public.sor_stage_visits (opportunity_id, flow_stage_id, flow_snapshot_id, sequence, entered_at, entered_by)
    values (p_opportunity_id, v_prev.flow_stage_id, v_prev.flow_snapshot_id, v_next_seq, now(), v_actor)
    returning * into v_new_visit;

    -- v_prev is exactly the visit sor_resume_stage_work looks for: the latest,
    -- not-undone visit to this Stage before the one just opened.
    perform public.sor_resume_stage_work(p_opportunity_id);
  else
    update public.sor_stage_visits
      set undone_at = now(), undone_by = v_actor
      where id = v_cur.id;

    update public.sor_stage_visits
      set left_at = null, left_by = null
      where id = v_prev.id;

    -- Work the reverted move put on hold comes straight back.
    update public.tasks
      set status = coalesce(held_prev_status, 'INCOMPLETE'), held_at = null, held_from_visit_id = null, held_prev_status = null
      where held_from_visit_id = v_prev.id and status = 'ON_HOLD' and held_at >= v_cur.entered_at;
    update public.committee_tasks
      set status = coalesce(held_prev_status, 'ACTIVE'), held_at = null, held_from_visit_id = null, held_prev_status = null
      where held_from_visit_id = v_prev.id and status = 'ON_HOLD' and held_at >= v_cur.entered_at;

    update public.tasks set status = 'DELETED', cancel_reason = format('Cancelled: the move into %s was reverted.', coalesce(v_from_name, 'this Stage'))
      where stage_visit_id = v_cur.id;

    update public.committee_tasks set status = 'CANCELLED', cancel_reason = format('Cancelled: the move into %s was reverted.', coalesce(v_from_name, 'this Stage'))
      where stage_visit_id = v_cur.id;

    update public.sor_action_runs
      set closed_off_at = now(), closed_off_reason = 'reverted'
      where stage_visit_id = v_cur.id and closed_off_at is null;
  end if;

  perform set_config('app.sor_revert', 'off', true);

  v_content := format('Stage reverted: %s → %s', coalesce(v_from_name, '—'), coalesce(v_to_name, '—'))
    || case when v_cur.contract_date_stamped then ' (Contract Date cleared)' else '' end
    || case
         when v_reason is not null and v_choice = 'keep' then ' (kept the earlier progress)'
         when v_reason is not null and v_choice = 'remove' then ' (removed the earlier progress)'
         else ''
       end;
  v_meta := jsonb_build_object(
    'event', 'STAGE_REVERTED',
    'from', v_cur.flow_stage_id,
    'to', v_prev.flow_stage_id,
    'employeeId', v_actor,
    'clearedContractDate', coalesce(v_cur.contract_date_stamped, false),
    'progressChoice', case when v_reason is not null then v_choice else null end
  );

  insert into public.sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
  values (p_opportunity_id, v_actor, 'SYSTEM', v_content, v_meta);

  insert into public.system_audit_logs (author_id, entity_type, entity_id, content, type, metadata)
  values (v_actor, 'OPPORTUNITY', p_opportunity_id::text, v_content, 'SYSTEM', v_meta);

  return v_opp;
end;
$$;

revoke all on function public.sor_revert_stage(uuid, text) from public, anon;
grant execute on function public.sor_revert_stage(uuid, text) to authenticated;

-- A read-only pre-check so the frontend can decide, before calling Revert,
-- whether to open the Keep/Remove dialog — mirroring how #390's Return prompt
-- asks `getReturnStageIds` up front rather than reading the RPC's refusal.
-- True only when Stage Work was done AND the reverter is not shut out of the
-- Stage being left (a shut-out reverter is never asked, per #392).
create or replace function public.sor_revert_needs_progress_choice(p_opportunity_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_opp public.sales_opportunities;
  v_cur public.sor_stage_visits;
  v_reason text;
begin
  select * into v_opp from public.sales_opportunities
    where id = p_opportunity_id and coalesce(is_deleted, false) = false;
  if v_opp.id is null then
    return false;
  end if;

  select * into v_cur from public.sor_stage_visits
    where opportunity_id = p_opportunity_id and left_at is null and undone_at is null
    order by sequence desc limit 1;
  if v_cur.id is null then
    return false;
  end if;

  v_reason := case
    when exists (
      select 1 from public.tasks t
      where t.stage_visit_id = v_cur.id and t.carried_from_visit_id is null and t.status is distinct from 'INCOMPLETE'
    ) or exists (
      select 1 from public.committee_tasks t
      where t.stage_visit_id = v_cur.id and t.carried_from_visit_id is null and t.status is distinct from 'ACTIVE'
    ) then 'a task created there has progressed'
    when exists (select 1 from public.sor_condition_status s where s.stage_visit_id = v_cur.id and s.carried_from_visit_id is null)
      then 'a tickbox was ticked or a condition file given'
    when exists (select 1 from public.sor_stage_field_values f where f.stage_visit_id = v_cur.id and f.carried_from_visit_id is null)
      then 'a Stage Field value was saved'
    when exists (
      select 1 from public.sor_action_runs r where r.stage_visit_id = v_cur.id and r.carried_from_visit_id is null and r.decided_by is not null
    ) then 'an Optional Action was decided'
    when exists (
      select 1 from public.sales_opportunity_logs l
      where l.opportunity_id = p_opportunity_id
        and l.stage_visit_id = v_cur.id
        and l.metadata->>'event' = 'FOLLOW_UP_LOGGED'
        and not (l.metadata ? 'carriedFromVisitId')
    ) then 'a follow-up was logged'
    else null
  end;

  return v_reason is not null and not public.sor_is_stage_shut_out(v_opp, v_actor, v_cur.flow_stage_id);
end;
$$;

revoke all on function public.sor_revert_needs_progress_choice(uuid) from public, anon;
grant execute on function public.sor_revert_needs_progress_choice(uuid) to authenticated;
