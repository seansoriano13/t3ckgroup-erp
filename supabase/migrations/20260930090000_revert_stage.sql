-- Issue #386 (parent #384, ADR 0026) — Revert to last stage, when no Stage
-- Work was done. One atomic function; the service is a thin wrapper.

-- ─── columns ─────────────────────────────────────────────────────────────────

-- An undone Stage Visit is kept for audit but is not part of the SOR's story.
alter table public.sor_stage_visits add column if not exists undone_at timestamptz;
alter table public.sor_stage_visits add column if not exists undone_by uuid references public.employees (id);
-- True when the move that opened this visit stamped the SOR's Contract Date,
-- so a Revert clears only a date that move put there.
alter table public.sor_stage_visits add column if not exists contract_date_stamped boolean not null default false;

alter table public.tasks add column if not exists cancel_reason text;
alter table public.committee_tasks add column if not exists cancel_reason text;

-- ─── the visit trigger: who moved it, what it stamped, and Revert's bypass ──
--
-- Revert manages visits itself and sets `app.sor_revert` for its own
-- transaction, so this trigger and the move guard step aside. (Only a
-- security-definer function can set it: PostgREST exposes no set_config.)
create or replace function public.record_stage_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_sequence integer;
  v_actor uuid;
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
    where opportunity_id = NEW.id and left_at is null;

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

create or replace function public.sor_guard_stage_move()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.flow_stage_id is not distinct from OLD.flow_stage_id then
    return NEW;
  end if;

  if auth.role() = 'service_role' then
    return NEW;
  end if;

  -- Revert authorises itself (mover / Deal Owner / Super Admin) and a
  -- Restricted Stage does not stop it.
  if coalesce(current_setting('app.sor_revert', true), '') = 'on' then
    return NEW;
  end if;

  if public.sor_access_level(OLD.id) <> 'full' then
    raise exception 'You do not have access to move this stage.' using errcode = '42501';
  end if;

  if public.sor_is_stage_shut_out(OLD, public.get_employee_id(), OLD.flow_stage_id) then
    raise exception 'This stage is restricted — you cannot move this SOR.' using errcode = '42501';
  end if;

  return NEW;
end;
$$;

-- ─── undone visits grant nothing ─────────────────────────────────────────────

create or replace function public.sor_visible_visit_ids(p_opportunity_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select v.id
  from public.sor_stage_visits v
  where v.opportunity_id = p_opportunity_id
    and v.undone_at is null
    and public.is_super_admin()

  union

  select v.id
  from public.sor_stage_visits v
  join public.sales_opportunities o on o.id = v.opportunity_id
  where v.opportunity_id = p_opportunity_id
    and v.undone_at is null
    and not public.is_super_admin()
    and (
      public.sor_is_deal_team(o, public.get_employee_id())
      or public.sor_always_sees(o, public.get_employee_id())
    )
    and not public.sor_is_stage_shut_out(o, public.get_employee_id(), v.flow_stage_id)

  union

  select v.id
  from public.sor_stage_participants p
  join public.sor_stage_visits opened on opened.id = p.opened_visit_id
  join public.sor_stage_visits v on v.opportunity_id = p.opportunity_id
  where p.opportunity_id = p_opportunity_id
    and p.employee_id = public.get_employee_id()
    and not public.is_super_admin()
    and opened.undone_at is null
    and v.undone_at is null
    and (
      (p.closed_at is null and v.sequence >= opened.sequence)
      or (
        p.closed_at is not null
        and v.sequence >= opened.sequence
        and v.sequence <= (
          select max(closing.sequence)
          from public.sor_stage_visits closing
          where closing.opportunity_id = p.opportunity_id
            and closing.sequence >= opened.sequence
            and closing.left_at is not null
            and closing.left_at <= p.closed_at
        )
      )
    )
$$;

create or replace function public.sor_visit_audience(p_opportunity_id uuid, p_visit_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select public.sor_access_level(p_opportunity_id) in ('full', 'participant') as ok
  )
  select e.id from public.employees e, allowed
  where allowed.ok and e.is_super_admin

  union

  select e.id
  from public.employees e
  join public.sales_opportunities o on o.id = p_opportunity_id
  join public.sor_stage_visits v on v.id = p_visit_id and v.opportunity_id = p_opportunity_id
  , allowed
  where allowed.ok
    and v.undone_at is null
    and (
      public.sor_is_deal_team(o, e.id)
      or public.sor_always_sees(o, e.id)
    )
    and not public.sor_is_stage_shut_out(o, e.id, v.flow_stage_id)

  union

  select p.employee_id
  from public.sor_stage_participants p
  join public.sor_stage_visits opened on opened.id = p.opened_visit_id
  join public.sor_stage_visits v on v.id = p_visit_id and v.opportunity_id = p.opportunity_id
  , allowed
  where allowed.ok
    and p.opportunity_id = p_opportunity_id
    and p.closed_at is null
    and opened.undone_at is null
    and v.undone_at is null
    and v.sequence >= opened.sequence
$$;

-- ─── the Revert ──────────────────────────────────────────────────────────────

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

  update public.tasks set status = 'DELETED', cancel_reason = v_cancel
    where stage_visit_id = v_cur.id;

  update public.committee_tasks set status = 'CANCELLED', cancel_reason = v_cancel
    where stage_visit_id = v_cur.id;

  update public.sor_action_runs
    set closed_off_at = now(), closed_off_reason = 'reverted'
    where stage_visit_id = v_cur.id and closed_off_at is null;

  perform set_config('app.sor_revert', 'off', true);

  v_content := format('Stage reverted: %s → %s', coalesce(v_from_name, '—'), coalesce(v_to_name, '—'));
  v_meta := jsonb_build_object(
    'event', 'STAGE_REVERTED',
    'from', v_cur.flow_stage_id,
    'to', v_prev.flow_stage_id,
    'employeeId', v_actor
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
