-- A Group Task made by a Stage Action is created by whoever moved the SOR
-- (committee_tasks.created_by), but the person who rates it is the SOR's Deal
-- Owner. Until now rating was tied to created_by, so the Deal Owner could
-- neither see nor rate it.
--
-- evaluator_id names who rates. NULL means "the creator rates" (every task
-- made outside a Stage Action, and every task that already exists), so the
-- column needs no backfill.

alter table public.committee_tasks
  add column if not exists evaluator_id uuid references public.employees(id);

-- Stage-Action tasks: the Deal Owner of the SOR rates. A SOR with no Deal
-- Owner leaves it NULL, so the creator still rates.
create or replace function public.sor_create_stage_group_task_action(
  p_run_id uuid,
  p_title text,
  p_description text,
  p_members jsonb,
  p_due_date timestamptz default null,
  p_template_id uuid default null,
  p_tag_ids uuid[] default null,
  p_created_by uuid default null
) returns public.committee_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run  public.sor_action_runs;
  v_actor uuid := public.get_employee_id();
  v_group_task public.committee_tasks;
  v_member jsonb;
  v_tag_id uuid;
begin
  if v_actor is null then
    raise exception 'sor_create_stage_group_task_action: not signed in' using errcode = '42501';
  end if;

  select * into v_run from public.sor_action_runs where id = p_run_id;
  if v_run.id is null then
    raise exception 'sor_create_stage_group_task_action: run % not found', p_run_id;
  end if;

  if v_run.group_task_id is not null then
    raise exception 'sor_create_stage_group_task_action: run % already has a group task', p_run_id using errcode = '42501';
  end if;

  if v_run.outcome not in ('pending', 'created') then
    raise exception 'sor_create_stage_group_task_action: run % is not pending', p_run_id using errcode = '42501';
  end if;

  if not (
    public.sor_can_edit_opportunity(v_run.opportunity_id)
    or public.sor_access_level(v_run.opportunity_id) = 'full'
  ) then
    raise exception 'sor_create_stage_group_task_action: actor % lacks full access to opportunity %', v_actor, v_run.opportunity_id
      using errcode = '42501';
  end if;

  if p_members is null or jsonb_array_length(p_members) = 0 then
    raise exception 'sor_create_stage_group_task_action: at least one member is required';
  end if;

  insert into public.committee_tasks (
    title, description, created_by, evaluator_id, due_date, status,
    template_id, opportunity_id, stage_action_id, stage_visit_id
  ) values (
    p_title,
    p_description,
    coalesce(p_created_by, v_actor),
    (select o.deal_owner_id from public.sales_opportunities o where o.id = v_run.opportunity_id),
    p_due_date,
    'ACTIVE',
    p_template_id,
    v_run.opportunity_id,
    v_run.action_id,
    v_run.stage_visit_id
  )
  returning * into v_group_task;

  for v_member in select * from jsonb_array_elements(p_members)
  loop
    insert into public.committee_task_members (
      committee_task_id, employee_id, task_description, checklist, role, custom_role, status
    ) values (
      v_group_task.id,
      (v_member->>'employee_id')::uuid,
      coalesce(v_member->>'task_description', ''),
      v_member->'checklist',
      v_member->>'role',
      v_member->>'custom_role',
      'PENDING'
    );
  end loop;

  if p_tag_ids is not null then
    foreach v_tag_id in array p_tag_ids
    loop
      insert into public.committee_task_tags (committee_task_id, tag_id, added_by)
      values (v_group_task.id, v_tag_id, v_actor);
    end loop;
  end if;

  update public.sor_action_runs
  set outcome = 'created',
      group_task_id = v_group_task.id
  where id = p_run_id;

  return v_group_task;
end;
$$;

-- The evaluator reads the task the same way its creator does: through the
-- SOR's visibility gate.
drop policy if exists "committee_tasks_read" on public.committee_tasks;
create policy "committee_tasks_read" on public.committee_tasks
  as permissive
  for select
  to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.committee_task_members ctm
      where ctm.committee_task_id = committee_tasks.id
        and ctm.employee_id = public.get_employee_id()
    )
    or (
      (created_by = public.get_employee_id() or evaluator_id = public.get_employee_id())
      and (
        opportunity_id is null
        or (
          stage_visit_id is not null
          and stage_visit_id in (select public.sor_visible_visit_ids(committee_tasks.opportunity_id))
        )
        or (
          stage_visit_id is null
          and public.sor_access_level(committee_tasks.opportunity_id) in ('full', 'participant')
        )
      )
    )
  );
