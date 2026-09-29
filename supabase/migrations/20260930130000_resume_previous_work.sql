-- Issue #390 (parent #384, ADR 0027) — Return: Resume previous work.
-- Resumed Stage Work MOVES to the new Stage Visit and shows there only; the
-- earlier visit keeps one line saying it was resumed.

alter table public.sor_stage_visits add column if not exists return_choice text
  check (return_choice in ('resume', 'start_fresh'));
alter table public.sor_stage_visits add column if not exists resumed_at timestamptz;
alter table public.sor_stage_visits add column if not exists resumed_by uuid references public.employees (id);
alter table public.sor_stage_visits add column if not exists resumed_into_visit_id uuid references public.sor_stage_visits (id) on delete set null;

-- Each carried item remembers the visit it came from ("from an earlier visit").
alter table public.tasks add column if not exists carried_from_visit_id uuid references public.sor_stage_visits (id) on delete set null;
alter table public.committee_tasks add column if not exists carried_from_visit_id uuid references public.sor_stage_visits (id) on delete set null;
alter table public.sor_condition_status add column if not exists carried_from_visit_id uuid references public.sor_stage_visits (id) on delete set null;
alter table public.sor_stage_field_values add column if not exists carried_from_visit_id uuid references public.sor_stage_visits (id) on delete set null;
alter table public.sor_action_runs add column if not exists carried_from_visit_id uuid references public.sor_stage_visits (id) on delete set null;

create or replace function public.sor_resume_stage_work(p_opportunity_id uuid)
returns public.sor_stage_visits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_new public.sor_stage_visits;
  v_old public.sor_stage_visits;
begin
  select * into v_new from public.sor_stage_visits
    where opportunity_id = p_opportunity_id and left_at is null and undone_at is null
    order by sequence desc limit 1;
  if v_new.id is null then
    raise exception 'Resume: this SOR is not on a Stage.' using errcode = 'P0001';
  end if;
  if v_new.return_choice is not null then
    raise exception 'Resume: this visit already recorded a Return choice.' using errcode = 'P0001';
  end if;
  if not (public.is_super_admin() or (v_actor is not null and v_new.entered_by = v_actor)) then
    raise exception 'Resume: only whoever made the move can resume previous work.' using errcode = '42501';
  end if;

  -- The earlier visit that holds this Stage's work: the latest before this one.
  select * into v_old from public.sor_stage_visits
    where opportunity_id = p_opportunity_id and flow_stage_id = v_new.flow_stage_id
      and undone_at is null and sequence < v_new.sequence
    order by sequence desc limit 1;
  if v_old.id is null then
    raise exception 'Resume: this is not a Return — there is no earlier visit to this Stage.' using errcode = 'P0001';
  end if;

  -- Held tasks reopen, due dates pushed back by the time they were held.
  update public.tasks
    set status = coalesce(held_prev_status, 'INCOMPLETE'),
        end_at = case when end_at is null then null else end_at + (now() - held_at) end,
        held_at = null, held_from_visit_id = null, held_prev_status = null
    where stage_visit_id = v_old.id and status = 'ON_HOLD' and held_at is not null;
  update public.committee_tasks
    set status = coalesce(held_prev_status, 'ACTIVE'),
        due_date = case when due_date is null then null else due_date + (now() - held_at) end,
        held_at = null, held_from_visit_id = null, held_prev_status = null
    where stage_visit_id = v_old.id and status = 'ON_HOLD' and held_at is not null;

  -- Everything else moves as one set.
  update public.tasks set stage_visit_id = v_new.id, carried_from_visit_id = v_old.id where stage_visit_id = v_old.id;
  update public.committee_tasks set stage_visit_id = v_new.id, carried_from_visit_id = v_old.id where stage_visit_id = v_old.id;
  update public.sor_condition_status set stage_visit_id = v_new.id, carried_from_visit_id = v_old.id where stage_visit_id = v_old.id;
  update public.sor_stage_field_values set stage_visit_id = v_new.id, carried_from_visit_id = v_old.id where stage_visit_id = v_old.id;
  update public.sor_action_runs set stage_visit_id = v_new.id, carried_from_visit_id = v_old.id where stage_visit_id = v_old.id;

  -- Condition files and the Follow-up count live on logs stamped with the visit.
  update public.sales_opportunity_logs
    set stage_visit_id = v_new.id,
        metadata = metadata || jsonb_build_object('stageVisitId', v_new.id, 'carriedFromVisitId', v_old.id)
    where opportunity_id = p_opportunity_id
      and metadata->>'stageVisitId' = v_old.id::text;

  update public.sor_stage_visits
    set resumed_at = now(), resumed_by = v_actor, resumed_into_visit_id = v_new.id
    where id = v_old.id;
  update public.sor_stage_visits set return_choice = 'resume' where id = v_new.id
    returning * into v_new;

  return v_new;
end;
$$;

revoke all on function public.sor_resume_stage_work(uuid) from public, anon;
grant execute on function public.sor_resume_stage_work(uuid) to authenticated;
