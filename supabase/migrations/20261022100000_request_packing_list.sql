-- Request Packing List (#464, spec #461, ADR 0033): a Stage Action that asks the
-- Warehouse to pack.
--
-- WHAT IT DOES
--   When the action runs on an SOR it creates ONE draft Packing List for that SOR,
--   but only if the SOR has no open (draft) Packing List. A packed list is signed
--   and closed, so it does not count: the next delivery gets a new request. When a
--   draft is created, the Warehouse staff list (`transmittal_warehouse`) gets
--   PACKING_LIST_REQUESTED, or, if the action's config names a `notify` list of
--   people and groups instead, those people. When an open list already exists the
--   run writes nothing and notifies nobody.
--   The draft is exactly a hand-made one (packing_list_create's insert and 'created'
--   event). Nothing is written to Odoo. No approver.
--
-- WHO MAY RUN IT
--   Nobody directly. The mover is often neither Purchasing nor on the Warehouse
--   list, so the builder inserts the list itself (SECURITY DEFINER, created_by = the
--   caller), behind the same full-access check as Open Costing Matrix. The saved
--   config in the SOR's Flow Snapshot is the only one read; p_config is ignored.
--
-- SAFE TO RUN AT ANY TIME: one CHECK widened with every old value kept, one nullable
-- column, replaced functions with unchanged signatures. Idempotent.

alter table public.flow_stage_actions drop constraint if exists flow_stage_actions_kind_chk;
alter table public.flow_stage_actions add constraint flow_stage_actions_kind_chk
  check (kind in ('create_group_task', 'create_individual_task', 'open_purchase_request', 'open_costing_matrix', 'request_packing_list'));

alter table public.sor_action_runs
  add column if not exists packing_list_id uuid references public.packing_lists (id) on delete set null;

comment on column public.sor_action_runs.packing_list_id is
  'The draft Packing List a Request Packing List run created (#464). Null on a run that found an open list and created nothing.';

-- ---------------------------------------------------------------------------
-- The action
-- ---------------------------------------------------------------------------

-- Returns the new draft's id, or null when the SOR already had an open one.
create or replace function public.sor_request_packing_list(
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
  v_config jsonb;
  v_opp public.sales_opportunities;
  v_row public.packing_lists;
  v_notify uuid[];
  v_to uuid;
begin
  if v_actor is null then
    raise exception 'sor_request_packing_list: not signed in' using errcode = '42501';
  end if;

  select * into v_run from public.sor_action_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'sor_request_packing_list: run % not found', p_run_id;
  end if;
  -- `created` with a decision is a Decider's Create.
  if not (v_run.outcome = 'pending' or (v_run.outcome = 'created' and v_run.decided_by is not null)) then
    raise exception 'sor_request_packing_list: run % is not pending', p_run_id using errcode = '42501';
  end if;
  if v_run.packing_list_id is not null then
    raise exception 'sor_request_packing_list: run % already created its Packing List', p_run_id using errcode = '42501';
  end if;

  if not (
    public.sor_can_edit_opportunity(v_run.opportunity_id)
    or public.sor_access_level(v_run.opportunity_id) = 'full'
  ) then
    raise exception 'sor_request_packing_list: actor % lacks full access to opportunity %', v_actor, v_run.opportunity_id
      using errcode = '42501';
  end if;

  v_action := public._sor_action_run_saved_action(p_run_id);
  if v_action->>'kind' is distinct from 'request_packing_list' then
    raise exception 'sor_request_packing_list: run % is not a Request Packing List action', p_run_id
      using errcode = '22023';
  end if;
  v_config := coalesce(v_action->'config', '{}'::jsonb);

  select * into v_opp from public.sales_opportunities
   where id = v_run.opportunity_id and not coalesce(is_deleted, false);
  if v_opp.id is null then
    raise exception 'sor_request_packing_list: opportunity % not found', v_run.opportunity_id using errcode = '22023';
  end if;

  -- An open (unsigned) Packing List already asks the Warehouse to pack: do nothing.
  if exists (
    select 1 from public.packing_lists p
     where p.opportunity_id = v_opp.id and p.state = 'draft'
  ) then
    update public.sor_action_runs set outcome = 'created' where id = p_run_id;
    return null;
  end if;

  insert into public.packing_lists (opportunity_id, created_by)
  values (v_opp.id, v_actor)
  returning * into v_row;

  perform public._packing_list_event(v_row.id, v_actor, 'created', jsonb_build_object('number', v_row.number));

  -- Who to tell: the config's people and groups, else the Warehouse staff list.
  if jsonb_typeof(v_config->'notify') = 'array' and jsonb_array_length(v_config->'notify') > 0 then
    select coalesce(array_agg(e.id), '{}'::uuid[]) into v_notify
    from public.employees e
    where not coalesce(e.is_deleted, false)
      and e.id <> v_actor
      and exists (
        select 1 from jsonb_array_elements(v_config->'notify') s
        where public.sor_selector_covers(s, v_opp, e.id)
      );
  else
    v_notify := public._ipas_list_members(array['transmittal_warehouse'], v_actor);
  end if;

  foreach v_to in array coalesce(v_notify, '{}'::uuid[])
  loop
    insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
    values (
      v_to,
      v_actor,
      'PACKING_LIST_REQUESTED',
      'Packing List requested',
      format('Please pack "%s": draft Packing List %s is ready.', coalesce(v_opp.project_title, 'this deal'), v_row.number),
      v_row.id::text
    );
  end loop;

  update public.sor_action_runs
  set outcome = 'created', packing_list_id = v_row.id
  where id = p_run_id;

  return v_row.id;
end;
$$;

comment on function public.sor_request_packing_list(uuid, jsonb) is
  '#464: the Request Packing List Stage Action. Creates a draft Packing List for the SOR unless it already has an open one, and notifies the Warehouse list (or the config''s notify list). p_config is ignored.';

revoke all on function public.sor_request_packing_list(uuid, jsonb) from public, anon;
grant execute on function public.sor_request_packing_list(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- _packing_list_editable: the Warehouse list may pack a list it did not create
-- ---------------------------------------------------------------------------
-- A list this action makes has the mover as `created_by`, and the mover is often
-- neither Purchasing nor on the Warehouse list, so the old "its creator or
-- Purchasing" rule would leave nobody in the Warehouse able to pack it. The rule
-- is now "its creator, Purchasing, or the Warehouse staff list" (the same people
-- who may make one). Everything else in the function is unchanged.

create or replace function public._packing_list_editable(p_packing_list_id uuid)
 returns public.packing_lists
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.packing_lists;
begin
  if v_actor is null then
    raise exception 'packing list: not signed in' using errcode = '42501';
  end if;
  select * into v_row from public.packing_lists where id = p_packing_list_id for update;
  if not found then
    raise exception 'packing list: no such Packing List' using errcode = 'P0002';
  end if;
  if not (public.packing_list_can_create() or v_row.created_by = v_actor) then
    raise exception 'packing list: only its creator, Purchasing or the Warehouse list changes a Packing List' using errcode = '42501';
  end if;
  if v_row.state <> 'draft' then
    raise exception 'packing list: % is packed and can''t be changed', v_row.number using errcode = '42501';
  end if;
  return v_row;
end;
$function$;

-- ---------------------------------------------------------------------------
-- sor_run_stage_actions: one more kind
-- ---------------------------------------------------------------------------
-- The body is 20261018160000's, unchanged but for the `request_packing_list` branch.

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
          nullif(v_action->>'created_by', '')::uuid
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
      elsif v_action->>'kind' = 'open_costing_matrix' then
        v_created := v_created || jsonb_build_object(
          'action_id', v_action->>'action_id',
          'kind', 'open_costing_matrix',
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

