-- Issue #391 (parent #384) — Return: Start fresh.
-- The earlier visit's Stage Work is closed off, never deleted: its live and
-- held tasks are cancelled as "superseded by a fresh start", its action runs
-- are closed off (sor_action_runs_live_unique from #385 lets a new run begin
-- once the old one is), and its ticks, files and field values are left where
-- they are — unlike Resume, nothing moves to the new visit.

alter table public.sor_stage_visits drop constraint if exists sor_stage_visits_return_choice_check;
alter table public.sor_stage_visits add constraint sor_stage_visits_return_choice_check
  check (return_choice in ('resume', 'start_fresh'));

create or replace function public.sor_start_fresh_stage_work(p_opportunity_id uuid)
returns public.sor_stage_visits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_new public.sor_stage_visits;
  v_old public.sor_stage_visits;
  v_cancel text := 'Superseded by a fresh start.';
begin
  select * into v_new from public.sor_stage_visits
    where opportunity_id = p_opportunity_id and left_at is null and undone_at is null
    order by sequence desc limit 1;
  if v_new.id is null then
    raise exception 'Start fresh: this SOR is not on a Stage.' using errcode = 'P0001';
  end if;
  if v_new.return_choice is not null then
    raise exception 'Start fresh: this visit already recorded a Return choice.' using errcode = 'P0001';
  end if;
  if not (public.is_super_admin() or (v_actor is not null and v_new.entered_by = v_actor)) then
    raise exception 'Start fresh: only whoever made the move can choose it.' using errcode = '42501';
  end if;

  -- The earlier visit that holds this Stage's work: the latest before this one.
  select * into v_old from public.sor_stage_visits
    where opportunity_id = p_opportunity_id and flow_stage_id = v_new.flow_stage_id
      and undone_at is null and sequence < v_new.sequence
    order by sequence desc limit 1;
  if v_old.id is null then
    raise exception 'Start fresh: this is not a Return — there is no earlier visit to this Stage.' using errcode = 'P0001';
  end if;

  -- Live and held tasks are cancelled; a completed one stands as it was.
  update public.tasks
    set status = 'DELETED', cancel_reason = v_cancel
    where stage_visit_id = v_old.id and status not in ('COMPLETED', 'DELETED');
  update public.committee_tasks
    set status = 'CANCELLED', cancel_reason = v_cancel
    where stage_visit_id = v_old.id and status in ('ACTIVE', 'ON_HOLD');

  -- Closed off, not deleted, so the earlier visit's history still shows them —
  -- and #385's live-unique index lets sor_begin_action_run start a fresh one.
  update public.sor_action_runs
    set closed_off_at = now(), closed_off_reason = 'start_fresh'
    where stage_visit_id = v_old.id and closed_off_at is null;

  update public.sor_stage_visits set return_choice = 'start_fresh' where id = v_new.id
    returning * into v_new;

  return v_new;
end;
$$;

revoke all on function public.sor_start_fresh_stage_work(uuid) from public, anon;
grant execute on function public.sor_start_fresh_stage_work(uuid) to authenticated;

-- The move and the Start fresh in one transaction, mirroring sor_move_and_resume.
create or replace function public.sor_move_and_start_fresh(p_opportunity_id uuid, p_flow_stage_id uuid, p_contract_date date default null)
returns public.sor_stage_visits
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.sales_opportunities
    set flow_stage_id = p_flow_stage_id,
        contract_date = coalesce(p_contract_date, contract_date)
    where id = p_opportunity_id;
  if not found then
    raise exception 'Start fresh: that SOR could not be moved.' using errcode = '42501';
  end if;
  return public.sor_start_fresh_stage_work(p_opportunity_id);
end;
$$;

revoke all on function public.sor_move_and_start_fresh(uuid, uuid, date) from public, anon;
grant execute on function public.sor_move_and_start_fresh(uuid, uuid, date) to authenticated;
