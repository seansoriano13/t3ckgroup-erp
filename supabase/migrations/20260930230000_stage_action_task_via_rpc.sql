-- Issue #404 — Individual Task Stage Actions were inserted into `tasks` under
-- the mover's own permissions. The `tasks` insert policy only admits an
-- insert whose `logged_by` is the mover themself, a head, HR, or a Super
-- Admin (20260908101315_server_side_sor_task_visibility.sql), so a
-- non-head/HR/Super-Admin mover moving an SOR whose action assigns the task
-- to someone else got an RLS violation: the run recorded `failed` and no
-- task was ever created. Group Task actions were unaffected because
-- `committee_tasks_insert` only requires `created_by = get_employee_id()`,
-- and the mover always creates the Group Task as themself.
--
-- Fix: a security-definer RPC creates the task and marks the run `created`
-- atomically, gated on the caller having full access to the SOR (the same
-- predicate `sor_update` already uses to decide who may move a Stage at
-- all: `sor_can_edit_opportunity` or `sor_access_level = 'full'`) and on the
-- run not already having a task. The `tasks` insert policy itself is
-- untouched — a direct client insert still needs to be the assignee, a
-- head, HR, or a Super Admin; this RPC is the only new door.
--
-- "Not already having a task" rather than strictly `outcome = 'pending'`:
-- an Optional Action's `sor_decide_action_run` (20260916000000) already
-- flips a "When confirmed" run's outcome to `created` the moment a Decider
-- picks Create, before this function ever runs (that flip is the record of
-- the decision, not of the task existing) — `decideAction` then calls this
-- same builder to actually make the task. Gating on `task_id is null`
-- admits that ordering while still refusing a `skipped`/`failed` run and
-- still refusing a second call once a task exists (fire-once).

create or replace function public.sor_create_stage_action_task(
  p_run_id uuid,
  p_task_description text,
  p_project_title text default null,
  p_category_id text default null,
  p_logged_by uuid default null,
  p_priority text default 'MEDIUM',
  p_checklist jsonb default null,
  p_end_at timestamptz default null,
  p_reported_to uuid default null
) returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run  public.sor_action_runs;
  v_actor uuid := public.get_employee_id();
  v_task public.tasks;
begin
  if v_actor is null then
    raise exception 'sor_create_stage_action_task: not signed in' using errcode = '42501';
  end if;

  select * into v_run from public.sor_action_runs where id = p_run_id;
  if v_run.id is null then
    raise exception 'sor_create_stage_action_task: run % not found', p_run_id;
  end if;

  if v_run.task_id is not null then
    raise exception 'sor_create_stage_action_task: run % already has a task', p_run_id using errcode = '42501';
  end if;

  if v_run.outcome not in ('pending', 'created') then
    raise exception 'sor_create_stage_action_task: run % is not pending', p_run_id using errcode = '42501';
  end if;

  if not (
    public.sor_can_edit_opportunity(v_run.opportunity_id)
    or public.sor_access_level(v_run.opportunity_id) = 'full'
  ) then
    raise exception 'sor_create_stage_action_task: actor % lacks full access to opportunity %', v_actor, v_run.opportunity_id
      using errcode = '42501';
  end if;

  insert into public.tasks (
    task_description, project_title, category_id, logged_by, priority,
    checklist, status, remarks, start_at, end_at, reported_to,
    opportunity_id, stage_action_id, stage_visit_id
  ) values (
    p_task_description,
    p_project_title,
    p_category_id,
    coalesce(p_logged_by, v_actor),
    coalesce(p_priority, 'MEDIUM'),
    p_checklist,
    'INCOMPLETE',
    '',
    now(),
    p_end_at,
    p_reported_to,
    v_run.opportunity_id,
    v_run.action_id,
    v_run.stage_visit_id
  )
  returning * into v_task;

  update public.sor_action_runs
  set outcome = 'created',
      task_id = v_task.id
  where id = p_run_id;

  return v_task;
end;
$$;

comment on function public.sor_create_stage_action_task(uuid, text, text, text, uuid, text, jsonb, timestamptz, uuid) is
  '#404: creates an Individual Task Stage Action''s task and marks its sor_action_runs row created, atomically, under the caller''s own full-access check rather than the tasks insert policy — so a non-head/HR/Super-Admin mover with full access to the SOR can still fire an action that assigns the task to someone else.';
