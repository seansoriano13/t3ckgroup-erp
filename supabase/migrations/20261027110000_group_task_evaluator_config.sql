-- A Stage Action's Group Task can name who rates it (flow canvas: the action's
-- Evaluator). The client resolves the configured people to an employee id and
-- passes it as p_evaluator_id; unset falls back to the SOR's Deal Owner, and
-- a SOR with no Deal Owner leaves it NULL (the creator rates).
--
-- The function gains a parameter, so the 8-argument version is dropped:
-- leaving it would keep a second overload that never sets the evaluator.

create or replace function public.sor_create_stage_group_task_action(
  p_run_id uuid,
  p_title text,
  p_description text,
  p_members jsonb,
  p_due_date timestamptz default null,
  p_template_id uuid default null,
  p_tag_ids uuid[] default null,
  p_created_by uuid default null,
  p_evaluator_id uuid default null
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
    coalesce(
      p_evaluator_id,
      (select o.deal_owner_id from public.sales_opportunities o where o.id = v_run.opportunity_id)
    ),
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

create or replace function public.sor_run_stage_actions(
  p_opportunity_id uuid,
  p_stage_id uuid,
  p_stage_visit_id uuid,
  p_actions jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_action jsonb;
  v_run public.sor_action_runs;
  v_decider_id text;
  v_tag_ids uuid[];
  v_failed text[] := '{}';
  v_created jsonb[] := '{}';
  v_project_title text;
begin
  if v_actor is null then
    raise exception 'sor_run_stage_actions: not signed in' using errcode = '42501';
  end if;

  if not (
    public.sor_can_edit_opportunity(p_opportunity_id)
    or public.sor_access_level(p_opportunity_id) = 'full'
  ) then
    raise exception 'sor_run_stage_actions: actor % lacks full access to opportunity %', v_actor, p_opportunity_id
      using errcode = '42501';
  end if;

  select project_title into v_project_title from public.sales_opportunities where id = p_opportunity_id;

  for v_action in select * from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb))
  loop
    -- Issue #204 Part 2's fire-once gate — unchanged. A run already begun
    -- (any outcome, by an earlier call that DID make it this far, or by this
    -- same call being retried after a partial failure elsewhere) is skipped.
    v_run := public.sor_begin_action_run(
      p_opportunity_id,
      p_stage_id,
      (v_action->>'action_id')::uuid,
      p_stage_visit_id,
      case when (v_action->>'confirm')::boolean then v_action->'decider' else null end
    );
    if v_run.outcome <> 'pending' then
      continue;
    end if;

    if (v_action->>'confirm')::boolean then
      -- "When confirmed" — no task yet. Notify every Decider directly (a
      -- plain notifications insert, same as createNotification) and leave
      -- the run pending for sor_decide_action_run to resolve later.
      for v_decider_id in select * from jsonb_array_elements_text(coalesce(v_action->'decider_ids', '[]'::jsonb))
      loop
        insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
        values (
          v_decider_id::uuid,
          v_actor,
          'OPPORTUNITY_ACTION_DECISION_DUE',
          coalesce(v_action->>'notification_title', v_action->>'name', 'Stage Action'),
          format(
            'A Stage Action on "%s" (%s) needs your decision: Create or Skip.',
            coalesce(v_project_title, v_action->>'name', 'this deal'),
            coalesce(v_action->>'stage_name', '')
          ),
          p_opportunity_id::text
        );
      end loop;
      continue;
    end if;

    begin
      if v_action->>'kind' = 'create_individual_task' then
        perform public.sor_create_stage_action_task(
          v_run.id,
          v_action->>'task_description',
          v_action->>'project_title',
          v_action->>'category_id',
          nullif(v_action->>'logged_by', '')::uuid,
          coalesce(v_action->>'priority', 'MEDIUM'),
          v_action->'checklist',
          nullif(v_action->>'end_at', '')::timestamptz,
          nullif(v_action->>'reported_to', '')::uuid
        );
        v_created := v_created || jsonb_build_object(
          'action_id', v_action->>'action_id',
          'kind', 'create_individual_task',
          'task_id', (select task_id from public.sor_action_runs where id = v_run.id)
        );
      elsif v_action->>'kind' = 'create_group_task' then
        perform public.sor_create_stage_group_task_action(
          v_run.id,
          v_action->>'group_title',
          v_action->>'group_description',
          coalesce(v_action->'members', '[]'::jsonb),
          nullif(v_action->>'due_date', '')::timestamptz,
          nullif(v_action->>'template_id', '')::uuid,
          case
            -- `tag_ids` may be absent (SQL NULL), a JSON `null` (config
            -- carried no tags), or an array — only the array shape is safe
            -- to feed to jsonb_array_elements_text.
            when jsonb_typeof(v_action->'tag_ids') = 'array' then
              (select array_agg(t::uuid) from jsonb_array_elements_text(v_action->'tag_ids') t)
            else null
          end,
          nullif(v_action->>'created_by', '')::uuid,
          nullif(v_action->>'evaluator_id', '')::uuid
        );
        v_created := v_created || jsonb_build_object(
          'action_id', v_action->>'action_id',
          'kind', 'create_group_task',
          'group_task_id', (select group_task_id from public.sor_action_runs where id = v_run.id)
        );
      else
        -- No branch for this kind — same "fails loudly, named to the mover"
        -- rule the old client-side builder followed for an unimplemented kind.
        raise exception 'sor_run_stage_actions: no builder for kind %', v_action->>'kind';
      end if;
    exception when others then
      perform public.sor_finish_action_run(v_run.id, 'failed');
      v_failed := array_append(v_failed, coalesce(v_action->>'name', 'Stage Action'));
    end;
  end loop;

  return jsonb_build_object('failed', to_jsonb(v_failed), 'created', to_jsonb(v_created));
end;
$$;

drop function if exists public.sor_create_stage_group_task_action(uuid, text, text, jsonb, timestamptz, uuid, uuid[], uuid);

comment on function public.sor_create_stage_group_task_action(uuid, text, text, jsonb, timestamptz, uuid, uuid[], uuid, uuid) is
  '#409: creates a Group Task Stage Action''s committee_tasks/committee_task_members/committee_task_tags rows and marks its sor_action_runs row created, atomically, under the caller''s own full-access check rather than the committee_tasks insert policy. p_evaluator_id names who rates it (default: the SOR''s Deal Owner).';
