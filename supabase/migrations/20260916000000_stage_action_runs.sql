-- Issue #204 Part 2 — replaces the fragile "STAGE_ACTIONS_FIRED" log-marker
-- + ILIKE-on-description fire-once guard with a real per-action ledger,
-- `sor_action_runs`, plus direct linkage columns on the tasks it creates.

-- ─── linkage columns ─────────────────────────────────────────────────────────

alter table public.tasks
  add column if not exists stage_action_id uuid references public.flow_stage_actions (id) on delete set null;
alter table public.tasks
  add column if not exists stage_visit_id uuid references public.sor_stage_visits (id) on delete set null;

alter table public.committee_tasks
  add column if not exists stage_action_id uuid references public.flow_stage_actions (id) on delete set null;
alter table public.committee_tasks
  add column if not exists stage_visit_id uuid references public.sor_stage_visits (id) on delete set null;

-- ─── sor_action_runs ─────────────────────────────────────────────────────────

create table if not exists public.sor_action_runs (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.sales_opportunities (id) on delete cascade,
  stage_id        uuid not null references public.flow_stages (id) on delete cascade,
  action_id       uuid not null references public.flow_stage_actions (id) on delete cascade,
  stage_visit_id  uuid references public.sor_stage_visits (id) on delete set null,
  outcome         text not null default 'pending' check (outcome in ('pending', 'created', 'skipped', 'failed')),
  decider         jsonb,
  decided_by      uuid references public.employees (id),
  decided_at      timestamptz,
  task_id         uuid references public.tasks (id) on delete set null,
  group_task_id   uuid references public.committee_tasks (id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint sor_action_runs_unique unique (opportunity_id, stage_id, action_id)
);

create index if not exists sor_action_runs_opportunity_id_idx on public.sor_action_runs (opportunity_id);
create index if not exists sor_action_runs_pending_idx on public.sor_action_runs (stage_visit_id) where outcome = 'pending';

alter table public.sor_action_runs enable row level security;

-- No signed-in employee can insert/update/delete directly — only the
-- security-definer RPCs below write here (mirrors sor_stage_visits).
drop policy if exists sor_action_runs_read on public.sor_action_runs;
create policy sor_action_runs_read on public.sor_action_runs
  for select to authenticated
  using (true);

-- ─── RPCs ────────────────────────────────────────────────────────────────────

-- Upsert-if-absent: this IS the fire-once gate. Returns the existing row
-- untouched if one already exists for (opportunity_id, stage_id, action_id).
create or replace function public.sor_begin_action_run(
  p_opportunity_id uuid,
  p_stage_id uuid,
  p_action_id uuid,
  p_stage_visit_id uuid default null,
  p_decider jsonb default null
) returns public.sor_action_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sor_action_runs;
begin
  insert into public.sor_action_runs (opportunity_id, stage_id, action_id, stage_visit_id, decider)
  values (p_opportunity_id, p_stage_id, p_action_id, p_stage_visit_id, p_decider)
  on conflict (opportunity_id, stage_id, action_id) do nothing;

  select * into v_row
  from public.sor_action_runs
  where opportunity_id = p_opportunity_id
    and stage_id = p_stage_id
    and action_id = p_action_id;

  return v_row;
end;
$$;

create or replace function public.sor_finish_action_run(
  p_run_id uuid,
  p_outcome text,
  p_task_id uuid default null,
  p_group_task_id uuid default null
) returns public.sor_action_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sor_action_runs;
begin
  if p_outcome not in ('created', 'skipped', 'failed') then
    raise exception 'sor_finish_action_run: invalid outcome %', p_outcome;
  end if;

  update public.sor_action_runs
  set outcome = p_outcome,
      task_id = coalesce(p_task_id, task_id),
      group_task_id = coalesce(p_group_task_id, group_task_id)
  where id = p_run_id
  returning * into v_row;

  return v_row;
end;
$$;

-- Validates that p_actor_id resolves into the run's stored `decider`
-- selectors before recording a decision. Selector shapes mirror
-- resolvePeople.js's SELECTOR_TYPES: {type:'employee', id}, {type:'group', id}
-- (an Employee Group), {type:'team', team} (a Sub-department match), and
-- {type:'role', role} (a Deal Team role, resolved off the run's own SOR —
-- the spec's default Decider, "the Deal Owner", is a role selector, so this
-- branch is not optional). Column list mirrors DEAL_TEAM_ROLES in
-- resolvePeople.js.
create or replace function public.sor_decide_action_run(
  p_run_id uuid,
  p_decision text,
  p_actor_id uuid
) returns public.sor_action_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sor_action_runs;
  v_opportunity public.sales_opportunities;
  v_selector jsonb;
  v_allowed boolean := false;
begin
  if p_decision not in ('create', 'skip') then
    raise exception 'sor_decide_action_run: invalid decision %', p_decision;
  end if;

  select * into v_row from public.sor_action_runs where id = p_run_id;
  if v_row.id is null then
    raise exception 'sor_decide_action_run: run % not found', p_run_id;
  end if;

  if v_row.outcome <> 'pending' then
    raise exception 'sor_decide_action_run: run % already decided', p_run_id;
  end if;

  select * into v_opportunity from public.sales_opportunities where id = v_row.opportunity_id;

  if v_row.decider is null or jsonb_array_length(v_row.decider) = 0 then
    v_allowed := false;
  else
    for v_selector in select * from jsonb_array_elements(v_row.decider)
    loop
      if v_selector->>'type' = 'employee' and (v_selector->>'id')::uuid = p_actor_id then
        v_allowed := true;
      elsif v_selector->>'type' = 'group'
        and exists (
          select 1 from public.employee_group_members egm
          where egm.group_id = (v_selector->>'id')::uuid
            and egm.employee_id = p_actor_id
        ) then
        v_allowed := true;
      elsif v_selector->>'type' = 'team'
        and exists (
          select 1 from public.employees e
          where e.id = p_actor_id
            and upper(trim(e.sub_department)) = upper(trim(v_selector->>'team'))
        ) then
        v_allowed := true;
      elsif v_selector->>'type' = 'role' and v_opportunity.id is not null then
        case v_selector->>'role'
          when 'deal_owner' then
            v_allowed := v_opportunity.deal_owner_id = p_actor_id;
          when 'closing_sales' then
            v_allowed := v_opportunity.closing_sales_id = p_actor_id;
          when 'support_sales' then
            v_allowed := v_opportunity.support_sales_1_id = p_actor_id
              or v_opportunity.support_sales_2_id = p_actor_id;
          when 'sales_director' then
            v_allowed := v_opportunity.sales_director_id = p_actor_id;
          when 'registrar' then
            v_allowed := v_opportunity.registered_by = p_actor_id;
          else
            v_allowed := false;
        end case;
      end if;
      exit when v_allowed;
    end loop;
  end if;

  if not v_allowed then
    raise exception 'sor_decide_action_run: actor % is not a decider for run %', p_actor_id, p_run_id;
  end if;

  update public.sor_action_runs
  set decided_by = p_actor_id,
      decided_at = now(),
      outcome = case when p_decision = 'create' then 'created' else 'skipped' end
  where id = p_run_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ─── best-effort backfill from the old STAGE_ACTIONS_FIRED marker ───────────
-- Not authoritative (predates per-action attribution); unmatched history is
-- left alone rather than failing the migration.
do $$
declare
  v_log record;
  v_action record;
begin
  for v_log in
    select opportunity_id, (metadata->>'to')::uuid as stage_id
    from public.sales_opportunity_logs
    where metadata->>'event' = 'STAGE_ACTIONS_FIRED'
      and metadata->>'to' is not null
  loop
    for v_action in
      select id from public.flow_stage_actions where stage_id = v_log.stage_id
    loop
      begin
        insert into public.sor_action_runs (opportunity_id, stage_id, action_id, outcome)
        values (v_log.opportunity_id, v_log.stage_id, v_action.id, 'created')
        on conflict (opportunity_id, stage_id, action_id) do nothing;
      exception when others then
        -- best-effort: skip rows that don't resolve cleanly
        null;
      end;
    end loop;
  end loop;
end $$;
