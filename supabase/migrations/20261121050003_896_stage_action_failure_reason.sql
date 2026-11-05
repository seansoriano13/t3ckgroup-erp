-- #896: a Stage Action that fails now says why.
--
-- Before, sor_run_stage_actions caught every error, marked the run `failed`
-- and handed the name back. The person who moved the SOR saw "create them by
-- hand: DELCOM ..." with no reason, and the run row kept no reason either.
--
-- This migration:
--   1. adds sor_action_runs.failure_reason, written on every failed run;
--   2. makes a Group Task whose member no longer exists fail with a plain
--      message ("member no longer exists") instead of a foreign-key error;
--   3. returns failed_reasons, [{ action_id, name, reason }], beside the
--      existing failed list, so the toast can name the reason. `failed` keeps
--      its shape: callers that only read names are unaffected.
--
-- The function body is the latest one (20261107110000_707_evaluation_of_specification_action.sql)
-- with only the group-task member check and the failure handler changed.

alter table public.sor_action_runs add column if not exists failure_reason text;

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
  v_failed text[] := '{}';
  v_failed_reasons jsonb[] := '{}';
  v_reason text;
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
        -- #896: a member who was deleted from employees fails the action with a
        -- plain reason, not a foreign-key error from inside the group task insert.
        if exists (
          select 1
            from jsonb_array_elements(coalesce(v_action->'members', '[]'::jsonb)) m
           where nullif(m->>'employee_id', '') is not null
             and not exists (select 1 from public.employees e where e.id = (m->>'employee_id')::uuid)
        ) then
          raise exception 'member no longer exists' using errcode = 'P0001';
        end if;
        perform public.sor_create_stage_group_task_action(
          v_run.id,
          v_action->>'group_title',
          v_action->>'group_description',
          coalesce(v_action->'members', '[]'::jsonb),
          nullif(v_action->>'due_date', '')::timestamptz,
          nullif(v_action->>'template_id', '')::uuid,
          case
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
      elsif v_action->>'kind' = 'open_purchase_request' then
        v_created := v_created || jsonb_build_object(
          'action_id', v_action->>'action_id',
          'kind', 'open_purchase_request',
          'request_id', public.sor_open_purchase_request(v_run.id, coalesce(v_action->'purchase_request', '{}'::jsonb))
        );
      elsif v_action->>'kind' in ('open_costing_matrix', 'evaluate_specification') then
        v_created := v_created || jsonb_build_object(
          'action_id', v_action->>'action_id',
          'kind', v_action->>'kind',
          'matrix_id', public.sor_open_costing_matrix(v_run.id, '{}'::jsonb)
        );
      elsif v_action->>'kind' = 'request_packing_list' then
        v_created := v_created || jsonb_build_object(
          'action_id', v_action->>'action_id',
          'kind', 'request_packing_list',
          'packing_list_id', public.sor_request_packing_list(v_run.id, '{}'::jsonb)
        );
      else
        raise exception 'sor_run_stage_actions: no builder for kind %', v_action->>'kind';
      end if;
    exception when others then
      v_reason := left(coalesce(nullif(sqlerrm, ''), 'unknown error'), 300);
      update public.sor_action_runs set failure_reason = v_reason where id = v_run.id;
      perform public.sor_finish_action_run(v_run.id, 'failed');
      v_failed := array_append(v_failed, coalesce(v_action->>'name', 'Stage Action'));
      v_failed_reasons := v_failed_reasons || jsonb_build_object(
        'action_id', v_action->>'action_id',
        'name', coalesce(v_action->>'name', 'Stage Action'),
        'reason', v_reason
      );
    end;
  end loop;

  return jsonb_build_object(
    'failed', to_jsonb(v_failed),
    'created', to_jsonb(v_created),
    'failed_reasons', to_jsonb(v_failed_reasons)
  );
end;
$$;
