-- Evaluation of Specification as a Flow Canvas action (#707, spec #699).
--
-- WHAT THIS ADDS
--   flow_stage_actions    accepts the kind `evaluate_specification`. Its config is the Open Costing Matrix
--                         config (Incharges, markup preset, extras, access): the action opens the SOR's one
--                         Costing Matrix the same way, so the Technical teams (#706) have rows to judge.
--   stage_conditions      accepts the kind `costing_evaluation_approved` (no config). The Flow Canvas adds it
--                         to the Stage together with the action, so the deal waits there until the matrix's
--                         Evaluation of Specification sign-off is live. It reads
--                         costing_condition_inputs.evaluation_approved, which already exists.
--   sor_open_costing_matrix, sor_run_stage_actions
--                         run the new kind exactly as Open Costing Matrix.
--
-- The group task kind and the "Evaluation of Specification" group task template are untouched: flows that use
-- them keep working.
--
-- SAFE TO RUN AT ANY TIME: two CHECKs widened with every old value kept, replaced functions with unchanged
-- signatures. Idempotent.

alter table public.flow_stage_actions drop constraint if exists flow_stage_actions_kind_chk;
alter table public.flow_stage_actions add constraint flow_stage_actions_kind_chk
  check (kind in ('create_group_task', 'create_individual_task', 'open_purchase_request', 'open_costing_matrix', 'request_packing_list', 'evaluate_specification'));

alter table public.stage_conditions drop constraint if exists stage_conditions_kind_chk;
alter table public.stage_conditions add constraint stage_conditions_kind_chk check (kind in ('attachment', 'field', 'tickbox', 'assignment', 'deadline', 'project_evaluation', 'inclusions', 'purchasing', 'purchasing_settled', 'costing_settled', 'costing_priced', 'goods_checked', 'orders_filed', 'costing_evaluation_approved'));

-- sor_open_costing_matrix (latest: 20261022130000_costing_matrix_backfill.sql): also runs the Evaluation of Specification kind.
create or replace function public.sor_open_costing_matrix(
  p_run_id uuid,
  p_config jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_run public.sor_action_runs;
  v_action jsonb;
  v_opp public.sales_opportunities;
  v_visit uuid;
  v_matrix uuid;
begin
  if v_actor is null then
    raise exception 'sor_open_costing_matrix: not signed in' using errcode = '42501';
  end if;

  select * into v_run from public.sor_action_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'sor_open_costing_matrix: run % not found', p_run_id;
  end if;
  if v_run.costing_matrix_id is not null then
    raise exception 'sor_open_costing_matrix: run % already opened its matrix', p_run_id using errcode = '42501';
  end if;
  -- `created` with a decision is a Decider's Create, still to be built.
  if not (v_run.outcome = 'pending' or (v_run.outcome = 'created' and v_run.decided_by is not null)) then
    raise exception 'sor_open_costing_matrix: run % is not pending', p_run_id using errcode = '42501';
  end if;

  if not (
    public.sor_can_edit_opportunity(v_run.opportunity_id)
    or public.sor_access_level(v_run.opportunity_id) = 'full'
  ) then
    raise exception 'sor_open_costing_matrix: actor % lacks full access to opportunity %', v_actor, v_run.opportunity_id
      using errcode = '42501';
  end if;

  v_action := public._sor_action_run_saved_action(p_run_id);
  if v_action->>'kind' is null or v_action->>'kind' not in ('open_costing_matrix', 'evaluate_specification') then
    raise exception 'sor_open_costing_matrix: run % is not an Open Costing Matrix or Evaluation of Specification action', p_run_id
      using errcode = '22023';
  end if;

  select * into v_opp from public.sales_opportunities where id = v_run.opportunity_id;

  v_visit := coalesce(
    v_run.stage_visit_id,
    (select v.id from public.sor_stage_visits v
      where v.opportunity_id = v_run.opportunity_id and v.left_at is null and v.undone_at is null
      order by v.sequence desc limit 1)
  );

  v_matrix := public.costing_open_matrix(
    v_run.opportunity_id,
    public._costing_action_open_args(v_opp, coalesce(v_action->'config', '{}'::jsonb), v_visit)
  );

  update public.sor_action_runs
  set outcome = 'created', costing_matrix_id = v_matrix
  where id = p_run_id;

  return v_matrix;
end;
$$;

comment on function public.sor_open_costing_matrix(uuid, jsonb) is
  '#462: the Open Costing Matrix Stage Action. Opens the SOR''s one Costing Matrix or tops an existing one up (blank Incharges, a missing default factor, missing members), from the action''s saved config, under the caller''s full-access check, and marks the run created with its matrix. p_config is ignored.';

revoke all on function public.sor_open_costing_matrix(uuid, jsonb) from public, anon;
grant execute on function public.sor_open_costing_matrix(uuid, jsonb) to authenticated;

-- sor_run_stage_actions (latest: 20261103110000_group_task_evaluator_run_actions.sql): one more kind.
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
      perform public.sor_finish_action_run(v_run.id, 'failed');
      v_failed := array_append(v_failed, coalesce(v_action->>'name', 'Stage Action'));
    end;
  end loop;

  return jsonb_build_object('failed', to_jsonb(v_failed), 'created', to_jsonb(v_created));
end;
$$;
