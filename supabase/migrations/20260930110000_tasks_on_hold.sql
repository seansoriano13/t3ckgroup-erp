-- Issue #388 (parent #384) — tasks go on hold when the SOR leaves a Stage.

alter table public.tasks add column if not exists held_at timestamptz;
alter table public.tasks add column if not exists held_prev_status text;
alter table public.committee_tasks add column if not exists held_prev_status text;
alter table public.tasks add column if not exists held_from_visit_id uuid references public.sor_stage_visits (id) on delete set null;
alter table public.committee_tasks add column if not exists held_at timestamptz;
alter table public.committee_tasks add column if not exists held_from_visit_id uuid references public.sor_stage_visits (id) on delete set null;

create or replace function public.record_stage_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_sequence integer;
  v_actor uuid;
  v_left_visit uuid;
  v_terminal boolean;
begin
  if coalesce(current_setting('app.sor_revert', true), '') = 'on' then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.flow_stage_id is null then
      return NEW;
    end if;

    insert into public.sor_stage_visits (opportunity_id, flow_stage_id, flow_snapshot_id, sequence, entered_at, entered_by)
    values (NEW.id, NEW.flow_stage_id, NEW.flow_snapshot_id, 1, coalesce(NEW.created_at, now()), NEW.registered_by);

    return NEW;
  end if;

  -- UPDATE: only react to an actual stage change.
  if NEW.flow_stage_id is not distinct from OLD.flow_stage_id then
    return NEW;
  end if;

  v_actor := public.get_employee_id();

  update public.sor_stage_visits
    set left_at = now(), left_by = v_actor
    where opportunity_id = NEW.id and left_at is null and undone_at is null
    returning id into v_left_visit;

  -- Leaving a Stage puts the open tasks its Actions created on hold: off
  -- everyone's lists until a Return decides them. Finished work is untouched.
  if v_left_visit is not null then
    update public.tasks
      set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_left_visit
      where stage_visit_id = v_left_visit and stage_action_id is not null
        and status in ('INCOMPLETE', 'AWAITING APPROVAL', 'NOT APPROVED');
    update public.committee_tasks
      set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_left_visit
      where stage_visit_id = v_left_visit and stage_action_id is not null
        and status = 'ACTIVE';
  end if;

  -- Nothing can bring a held task back from a Terminal Stage.
  select coalesce(is_terminal, false) into v_terminal from public.flow_stages where id = NEW.flow_stage_id;
  if coalesce(v_terminal, false) then
    update public.tasks
      set status = 'DELETED', cancel_reason = 'Cancelled: the SOR reached a Terminal Stage.'
      where opportunity_id = NEW.id and status = 'ON_HOLD';
    update public.committee_tasks
      set status = 'CANCELLED', cancel_reason = 'Cancelled: the SOR reached a Terminal Stage.'
      where opportunity_id = NEW.id and status = 'ON_HOLD';
  end if;

  if NEW.flow_stage_id is not null then
    select coalesce(max(sequence), 0) + 1 into v_next_sequence
      from public.sor_stage_visits where opportunity_id = NEW.id;

    insert into public.sor_stage_visits
      (opportunity_id, flow_stage_id, flow_snapshot_id, sequence, entered_at, entered_by, contract_date_stamped)
    values
      (NEW.id, NEW.flow_stage_id, NEW.flow_snapshot_id, v_next_sequence, now(), v_actor,
       OLD.contract_date is null and NEW.contract_date is not null);
  end if;

  return NEW;
end;
$$;


-- Revert also revives what the reverted move held.
create or replace function public.sor_revert_stage(p_opportunity_id uuid)
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
  v_latest_undone boolean;
  v_from_name text;
  v_to_name text;
  v_reason text;
  v_cancel text;
  v_content text;
  v_meta jsonb;
  v_title text;
  v_msg text;
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

  -- Stage Work done on the Stage being left: this path does not handle it.
  v_reason := case
    when exists (
      select 1 from public.tasks t
      where t.stage_visit_id = v_cur.id and t.status is distinct from 'INCOMPLETE'
    ) or exists (
      select 1 from public.committee_tasks t
      where t.stage_visit_id = v_cur.id and t.status is distinct from 'ACTIVE'
    ) then 'a task created there has progressed'
    when exists (select 1 from public.sor_condition_status s where s.stage_visit_id = v_cur.id)
      then 'a tickbox was ticked or a condition file given'
    when exists (select 1 from public.sor_stage_field_values f where f.stage_visit_id = v_cur.id)
      then 'a Stage Field value was saved'
    when exists (
      select 1 from public.sor_action_runs r where r.stage_visit_id = v_cur.id and r.decided_by is not null
    ) then 'an Optional Action was decided'
    when exists (
      select 1 from public.sales_opportunity_logs l
      where l.opportunity_id = p_opportunity_id
        and l.stage_visit_id = v_cur.id
        and l.metadata->>'event' = 'FOLLOW_UP_LOGGED'
    ) then 'a follow-up was logged'
    else null
  end;
  if v_reason is not null then
    raise exception 'Revert: Stage Work was done on % (%), so it cannot be reverted without choosing what to do with that work.',
      coalesce(v_from_name, 'that Stage'), v_reason using errcode = 'P0001';
  end if;

  perform set_config('app.sor_revert', 'on', true);

  update public.sales_opportunities
    set flow_stage_id = v_prev.flow_stage_id,
        contract_date = case when v_cur.contract_date_stamped then null else contract_date end
    where id = p_opportunity_id
    returning * into v_opp;

  update public.sor_stage_visits
    set undone_at = now(), undone_by = v_actor
    where id = v_cur.id;

  update public.sor_stage_visits
    set left_at = null, left_by = null
    where id = v_prev.id;

  v_cancel := format('Cancelled: the move into %s was reverted.', coalesce(v_from_name, 'this Stage'));

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

  -- Work the reverted move put on hold comes straight back.
  update public.tasks
    set status = coalesce(held_prev_status, 'INCOMPLETE'), held_at = null, held_from_visit_id = null, held_prev_status = null
    where held_from_visit_id = v_prev.id and status = 'ON_HOLD' and held_at >= v_cur.entered_at;
  update public.committee_tasks
    set status = coalesce(held_prev_status, 'ACTIVE'), held_at = null, held_from_visit_id = null, held_prev_status = null
    where held_from_visit_id = v_prev.id and status = 'ON_HOLD' and held_at >= v_cur.entered_at;

  update public.tasks set status = 'DELETED', cancel_reason = v_cancel
    where stage_visit_id = v_cur.id;

  update public.committee_tasks set status = 'CANCELLED', cancel_reason = v_cancel
    where stage_visit_id = v_cur.id;

  update public.sor_action_runs
    set closed_off_at = now(), closed_off_reason = 'reverted'
    where stage_visit_id = v_cur.id and closed_off_at is null;

  perform set_config('app.sor_revert', 'off', true);

  v_content := format('Stage reverted: %s → %s', coalesce(v_from_name, '—'), coalesce(v_to_name, '—'))
    || case when v_cur.contract_date_stamped then ' (Contract Date cleared)' else '' end;
  v_meta := jsonb_build_object(
    'event', 'STAGE_REVERTED',
    'from', v_cur.flow_stage_id,
    'to', v_prev.flow_stage_id,
    'employeeId', v_actor,
    'clearedContractDate', coalesce(v_cur.contract_date_stamped, false)
  );

  insert into public.sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
  values (p_opportunity_id, v_actor, 'SYSTEM', v_content, v_meta);

  insert into public.system_audit_logs (author_id, entity_type, entity_id, content, type, metadata)
  values (v_actor, 'OPPORTUNITY', p_opportunity_id::text, v_content, 'SYSTEM', v_meta);

  return v_opp;
end;
$$;

revoke all on function public.sor_revert_stage(uuid) from public, anon;
grant execute on function public.sor_revert_stage(uuid) to authenticated;
