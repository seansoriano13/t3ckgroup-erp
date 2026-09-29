-- allow-out-of-order: renumbered from 20260930200000, which prod ledger holds for main hotfix #410 (group_task_start_lead_time_and_member_delete); stays before 20260930210000, which redefines sor_revert_stage after it (#415).
-- Issue #402 (parent #384): a condition file given on the current Stage
-- Visit is Stage Work, same as a tick, but the check that decides whether
-- Revert asks Keep/Remove never looked at it. A tickbox writes a
-- sor_condition_status row (already checked below); a file is recorded only
-- as an attachment note on sales_opportunity_logs, tagged with its
-- condition (metadata.attachments[].conditionId) and Stage Visit
-- (the trigger-set stage_visit_id column, #295) — that note was never read.
-- A file carried in by a Resume is excluded the same way a carried tick or
-- follow-up already is: `carriedFromVisitId` on the log's own metadata.

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
  v_old_fresh_id uuid;
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
  -- One step only: straight after a no-work Revert the latest visit is the
  -- undone one; after a Keep/Remove Revert it is the visit that Revert opened.
  if v_latest_undone or v_cur.opened_by_revert then
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
    when exists (
      select 1 from public.sales_opportunity_logs l, jsonb_array_elements(l.metadata->'attachments') att
      where l.opportunity_id = p_opportunity_id
        and l.stage_visit_id = v_cur.id
        and l.metadata ? 'attachments'
        and not (l.metadata ? 'carriedFromVisitId')
        and att ? 'conditionId'
    ) then 'a tickbox was ticked or a condition file given'
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

  -- A Terminal Stage cancelled every held task on the way in; the tasks it
  -- cancelled go back on hold, their hold intact, before anything below reads
  -- holds (the no-work path then brings back live what this move held).
  update public.tasks
    set status = 'ON_HOLD', cancel_reason = null, cancelled_by_visit_id = null
    where cancelled_by_visit_id = v_cur.id;
  update public.committee_tasks
    set status = 'ON_HOLD', cancel_reason = null, cancelled_by_visit_id = null
    where cancelled_by_visit_id = v_cur.id;

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

  -- ADR 0027 — reverting a Return undoes its Start fresh: the earlier visit's
  -- cancelled tasks/Group Tasks un-cancel back to their prior status. That
  -- earlier visit is found the same way sor_start_fresh_stage_work found it:
  -- the latest not-undone visit to the same Stage before the reverted one.
  -- Its action runs reopen later, once whatever the Start fresh's own visit
  -- created is closed off below — reopening here first could collide with a
  -- still-live run the Start fresh's re-fired Stage Action just created,
  -- against sor_action_runs_live_unique (#385).
  if v_cur.return_choice = 'start_fresh' then
    select id into v_old_fresh_id from public.sor_stage_visits
      where opportunity_id = p_opportunity_id and flow_stage_id = v_cur.flow_stage_id
        and undone_at is null and revert_choice is distinct from 'remove' and sequence < v_cur.sequence
      order by sequence desc limit 1;
    if v_old_fresh_id is not null then
      -- A task that was on hold when Start fresh cancelled it goes back on
      -- hold (the SOR is not on its Stage any more); a live one goes back live.
      update public.tasks
        set status = case when held_at is not null then 'ON_HOLD' else coalesce(held_prev_status, 'INCOMPLETE') end,
            held_prev_status = case when held_at is not null then held_prev_status else null end,
            cancel_reason = null
        where stage_visit_id = v_old_fresh_id and cancel_reason = 'Superseded by a fresh start.';
      update public.committee_tasks
        set status = case when held_at is not null then 'ON_HOLD' else coalesce(held_prev_status, 'ACTIVE') end,
            held_prev_status = case when held_at is not null then held_prev_status else null end,
            cancel_reason = null
        where stage_visit_id = v_old_fresh_id and cancel_reason = 'Superseded by a fresh start.';
    end if;
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
    -- Either way the left visit stands (left, not undone): the History still
    -- shows who did what, even when that work was removed.
    update public.sor_stage_visits
      set revert_choice = v_choice, left_at = now(), left_by = v_actor
      where id = v_cur.id;

    if v_choice = 'keep' then
      -- Held exactly as leaving the Stage holds (record_stage_visit): open
      -- Stage Action tasks, except those whose action carries on past the Stage.
      update public.tasks
        set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_cur.id
        where stage_visit_id = v_cur.id and carried_from_visit_id is null and stage_action_id is not null
          and status in ('INCOMPLETE', 'AWAITING APPROVAL', 'NOT APPROVED')
          and not public.stage_action_carries_on(v_cur.flow_snapshot_id, stage_action_id);
      update public.committee_tasks
        set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_cur.id
        where stage_visit_id = v_cur.id and carried_from_visit_id is null and stage_action_id is not null
          and status = 'ACTIVE'
          and not public.stage_action_carries_on(v_cur.flow_snapshot_id, stage_action_id);
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
    insert into public.sor_stage_visits (opportunity_id, flow_stage_id, flow_snapshot_id, sequence, entered_at, entered_by, opened_by_revert)
    values (p_opportunity_id, v_prev.flow_stage_id, v_prev.flow_snapshot_id, v_next_seq, now(), v_actor, true)
    returning * into v_new_visit;

    -- v_prev is exactly the visit sor_resume_stage_work looks for: the latest
    -- visit to this Stage before the one just opened, neither undone nor removed.
    perform public.sor_resume_stage_work(p_opportunity_id);

    -- The left visit stands, so windows its own rule closed stay closed. A
    -- Terminal Stage closes every window regardless of rule; one whose rule the
    -- move into it did not meet reopens now the SOR is live again.
    update public.sor_stage_participants p
      set closed_at = null, closed_reason = null
      from public.sor_stage_visits opened
      where p.opportunity_id = p_opportunity_id
        and p.closed_reason = 'terminal' and p.closed_at >= v_cur.entered_at
        and opened.id = p.opened_visit_id
        and not (
          (p.until_rule = 'stage_left' and opened.flow_stage_id = v_prev.flow_stage_id)
          or (p.until_rule = 'stage_entered' and p.until_stage_id = v_cur.flow_stage_id)
          or (p.until_rule = 'later_stage_left' and p.until_stage_id = v_prev.flow_stage_id)
        );
  else
    -- Left as well as undone, so the reopened earlier visit is the only open
    -- one: every reader of "the current visit" by left_at finds it.
    update public.sor_stage_visits
      set undone_at = now(), undone_by = v_actor, left_at = now(), left_by = v_actor
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

    -- Access windows stand as they did before the erased move: what it (and
    -- this Revert's own stage change) closed by rule reopens, and what was
    -- opened on the erased visit closes.
    update public.sor_stage_participants
      set closed_at = null, closed_reason = null
      where opportunity_id = p_opportunity_id
        and closed_reason in ('rule_met', 'terminal') and closed_at >= v_cur.entered_at
        and opened_visit_id <> v_cur.id;
    update public.sor_stage_participants
      set closed_at = now(), closed_reason = 'reverted'
      where opened_visit_id = v_cur.id and closed_at is null;
  end if;

  -- A "keep" choice leaves whatever the Start fresh re-fired on v_cur live
  -- (kept work, not closed off, exactly like any other kept Optional Action —
  -- resumable later). Reopening the earlier run too would then double up a
  -- live run for the same Stage Action, against sor_action_runs_live_unique
  -- (#385); the earlier run stays closed off in that one case, since v_cur's
  -- still-live run already occupies its slot.
  if v_old_fresh_id is not null then
    update public.sor_action_runs r
      set closed_off_at = null, closed_off_reason = null
      where r.stage_visit_id = v_old_fresh_id and r.closed_off_reason = 'start_fresh'
        and not exists (
          select 1 from public.sor_action_runs live
          where live.opportunity_id = r.opportunity_id and live.stage_id = r.stage_id
            and live.action_id = r.action_id and live.closed_off_at is null
        );
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

-- The UI's own advance read of the same question (whether to show the
-- Keep/Remove dialog before calling Revert at all) mirrors sor_revert_stage's
-- v_reason exactly, so it needs the identical addition.
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
    when exists (
      select 1 from public.sales_opportunity_logs l, jsonb_array_elements(l.metadata->'attachments') att
      where l.opportunity_id = p_opportunity_id
        and l.stage_visit_id = v_cur.id
        and l.metadata ? 'attachments'
        and not (l.metadata ? 'carriedFromVisitId')
        and att ? 'conditionId'
    ) then 'a tickbox was ticked or a condition file given'
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
