-- ==============================================================================
-- 20261005130200_open_purchase_request_action.sql
--
-- Issue #304 (part of #209) — the Open Purchase Request Stage Action, and
-- members added to or removed from a live request.
--
-- THE ACTION
-- `open_purchase_request` joins the action kinds. Its config (frozen into the
-- Flow Snapshot like any action's) is read by the client, which resolves
-- groups and the Buyer option to people and sends plain ids; the database
-- resolves what only it should: who has Purchasing access, and the SOR's Deal
-- Team. `sor_open_purchase_request` does the work and is called by
-- `sor_run_stage_actions` (automatic) or, after a Decider's Create, directly.
--
-- ONE REQUEST PER SOR, TOPPED UP
-- A second run on an SOR that already has a request (the same action mounted
-- on another Stage) opens nothing new. It sets the Buyer only if there is
-- none and adds members who are missing; it never replaces the Buyer,
-- removes a member or changes a window.
--
-- WINDOWS
-- A purchasing member gets a Stage Participant row (source purchase_request)
-- on the Stage Visit the request was opened on, for the configured window,
-- stored on the request so a member added later gets the same one. Any other
-- member reads the request and nothing else.
--
-- MEMBERS
-- Purchasing members (live Purchasing access, not a stored side) and Super Admins add and remove members; a sales-side
-- member cannot. The Buyer cannot be removed. Each change posts an event
-- message, which only an RPC may do.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: one new
-- action kind, two nullable-defaulted columns, new functions. Idempotent.
-- ==============================================================================

alter table public.flow_stage_actions drop constraint if exists flow_stage_actions_kind_chk;
alter table public.flow_stage_actions add constraint flow_stage_actions_kind_chk
  check (kind in ('create_group_task', 'create_individual_task', 'open_purchase_request'));

alter table public.purchase_requests
  add column if not exists access_until text not null default 'stage_left',
  add column if not exists access_until_stage_id uuid references public.flow_stages (id);

alter table public.purchase_requests drop constraint if exists purchase_requests_access_until_chk;
alter table public.purchase_requests add constraint purchase_requests_access_until_chk
  check (access_until in ('stage_left', 'stage_entered', 'later_stage_left', 'terminal'));

comment on column public.purchase_requests.access_until is
  'The purchasing members'' window into the SOR (#304), as the opening action configured it. Same rules as sor_stage_participants.until_rule.';

-- ------------------------------------------------------------------------------
-- Internals
-- ------------------------------------------------------------------------------

-- The side a person sits on: purchasing if they hold Purchasing access, sales
-- if they hold a Deal Team role on the SOR, otherwise other.
create or replace function public.purchase_request_member_side(p_opportunity_id uuid, p_employee_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from employees e
      where e.id = p_employee_id and e.has_purchasing_flow and not coalesce(e.is_deleted, false)
    ) then 'purchasing'
    when exists (
      select 1 from sales_opportunities o
      where o.id = p_opportunity_id
        and p_employee_id in (o.registered_by, o.deal_owner_id, o.closing_sales_id,
                              o.support_sales_1_id, o.support_sales_2_id, o.sales_director_id)
    ) then 'sales'
    else 'other'
  end;
$$;

-- Adds one member (no-op if already there); a purchasing member also gets a
-- window on the visit the request was opened on. Returns true if added.
create or replace function public._purchase_request_add_member(
  p_request_id uuid,
  p_employee_id uuid,
  p_actor uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.purchase_requests;
  v_side text;
  v_added uuid;
begin
  select * into v_req from public.purchase_requests where id = p_request_id;
  v_side := public.purchase_request_member_side(v_req.opportunity_id, p_employee_id);

  insert into public.purchase_request_members (request_id, employee_id, side, added_by)
  values (p_request_id, p_employee_id, v_side, p_actor)
  on conflict (request_id, employee_id) do nothing
  returning id into v_added;

  if v_added is null then
    return false;
  end if;

  if v_side = 'purchasing'
     and v_req.opportunity_id is not null
     and v_req.opened_visit_id is not null
     and not exists (
       select 1 from public.sor_stage_participants p
       where p.opportunity_id = v_req.opportunity_id
         and p.employee_id = p_employee_id
         and p.source = 'purchase_request'
         and p.source_id = p_request_id
         and p.closed_at is null
     ) then
    insert into public.sor_stage_participants
      (opportunity_id, employee_id, source, source_id, opened_visit_id, until_rule, until_stage_id)
    values
      (v_req.opportunity_id, p_employee_id, 'purchase_request', p_request_id, v_req.opened_visit_id,
       v_req.access_until, v_req.access_until_stage_id);
  end if;

  return true;
end;
$$;

revoke all on function public._purchase_request_add_member(uuid, uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- The action
-- ------------------------------------------------------------------------------

-- p_config: { buyer_id, extra_member_ids[], left_out_roles[], access_until,
-- access_until_stage_id }. Returns the request's id.
create or replace function public.sor_open_purchase_request(
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
  v_opp public.sales_opportunities;
  v_req public.purchase_requests;
  v_left_out text[];
  v_buyer uuid := nullif(p_config->>'buyer_id', '')::uuid;
  v_until text := coalesce(nullif(p_config->>'access_until', ''), 'stage_left');
  v_until_stage uuid := nullif(p_config->>'access_until_stage_id', '')::uuid;
  v_emp uuid;
  v_created boolean := false;
begin
  if v_actor is null then
    raise exception 'sor_open_purchase_request: not signed in' using errcode = '42501';
  end if;

  select * into v_run from public.sor_action_runs where id = p_run_id;
  if v_run.id is null then
    raise exception 'sor_open_purchase_request: run % not found', p_run_id;
  end if;
  if v_run.outcome not in ('pending', 'created') then
    raise exception 'sor_open_purchase_request: run % is not pending', p_run_id using errcode = '42501';
  end if;

  if not (
    public.sor_can_edit_opportunity(v_run.opportunity_id)
    or public.sor_access_level(v_run.opportunity_id) = 'full'
  ) then
    raise exception 'sor_open_purchase_request: actor % lacks full access to opportunity %', v_actor, v_run.opportunity_id
      using errcode = '42501';
  end if;

  select * into v_opp from public.sales_opportunities where id = v_run.opportunity_id;

  select coalesce(array_agg(r), '{}') into v_left_out
  from jsonb_array_elements_text(
    case when jsonb_typeof(p_config->'left_out_roles') = 'array' then p_config->'left_out_roles' else '[]'::jsonb end
  ) r;

  select * into v_req from public.purchase_requests where opportunity_id = v_run.opportunity_id;

  if v_req.id is null then
    insert into public.purchase_requests
      (opportunity_id, opened_by_action_id, opened_visit_id, buyer_id, created_by, access_until, access_until_stage_id)
    values
      (v_run.opportunity_id, v_run.action_id, v_run.stage_visit_id, v_buyer, v_actor, v_until, v_until_stage)
    on conflict (opportunity_id) do nothing
    returning * into v_req;
    v_created := v_req.id is not null;
    if v_req.id is null then
      -- Lost a race with a concurrent open: top the winner up instead.
      select * into v_req from public.purchase_requests where opportunity_id = v_run.opportunity_id;
      if v_req.buyer_id is null and v_buyer is not null then
        update public.purchase_requests set buyer_id = v_buyer where id = v_req.id returning * into v_req;
      end if;
    end if;
  elsif v_req.buyer_id is null and v_buyer is not null then
    update public.purchase_requests set buyer_id = v_buyer where id = v_req.id returning * into v_req;
  end if;

  -- Members: Purchasing access, the Deal Team minus the left-out roles, the
  -- configured extras, and the Buyer.
  for v_emp in
    select e.id from public.employees e
    where e.has_purchasing_flow and not coalesce(e.is_deleted, false)
    union
    select x from (
      select v_opp.registered_by as x, 'registrar' as role
      union all select v_opp.deal_owner_id, 'deal_owner'
      union all select v_opp.closing_sales_id, 'closing_sales'
      union all select v_opp.support_sales_1_id, 'support_sales'
      union all select v_opp.support_sales_2_id, 'support_sales'
      union all select v_opp.sales_director_id, 'sales_director'
    ) team
    where x is not null and not (role = any (v_left_out))
      and exists (select 1 from public.employees d where d.id = x and not coalesce(d.is_deleted, false))
    union
    select (m)::uuid from jsonb_array_elements_text(
      case when jsonb_typeof(p_config->'extra_member_ids') = 'array' then p_config->'extra_member_ids' else '[]'::jsonb end
    ) m
    union
    select v_req.buyer_id where v_req.buyer_id is not null
  loop
    perform public._purchase_request_add_member(v_req.id, v_emp, v_actor);
  end loop;

  if v_created then
    insert into public.purchase_request_messages (request_id, author_id, content, metadata)
    values (v_req.id, v_actor, 'Purchase Request opened.', jsonb_build_object('event', 'opened'));
  end if;

  update public.sor_action_runs set outcome = 'created' where id = p_run_id and outcome = 'pending';

  return v_req.id;
end;
$$;

grant execute on function public.sor_open_purchase_request(uuid, jsonb) to authenticated;

comment on function public.sor_open_purchase_request(uuid, jsonb) is
  '#304: the Open Purchase Request Stage Action. Opens the SOR''s one request or tops an existing one up (Buyer only if none, missing members only), under the caller''s full-access check, and marks the run created.';

-- ------------------------------------------------------------------------------
-- Members on a live request
-- ------------------------------------------------------------------------------

create or replace function public.purchase_request_can_manage_members(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(is_super_admin(), false)
      or (
        has_purchasing_access()
        and exists (
          select 1 from purchase_request_members m
          where m.request_id = p_request_id
            and m.employee_id = get_employee_id()
        )
      );
$$;

grant execute on function public.purchase_request_can_manage_members(uuid) to authenticated;

-- Posts "Added <name>." / "Removed <name>." in the request's chat.
create or replace function public._purchase_request_member_event(
  p_request_id uuid,
  p_actor uuid,
  p_employee_id uuid,
  p_event text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.purchase_request_messages (request_id, author_id, content, metadata)
  values (
    p_request_id,
    p_actor,
    format(
      '%s %s.',
      case p_event when 'member_added' then 'Added' else 'Removed' end,
      coalesce((select name from public.employees where id = p_employee_id), 'a member')
    ),
    jsonb_build_object('event', p_event, 'employee_id', p_employee_id)
  );
$$;

revoke all on function public._purchase_request_member_event(uuid, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.purchase_request_add_member(p_request_id uuid, p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
begin
  if v_actor is null or not public.purchase_request_can_manage_members(p_request_id) then
    raise exception 'purchase_request_add_member: not allowed' using errcode = '42501';
  end if;

  if public._purchase_request_add_member(p_request_id, p_employee_id, v_actor) then
    perform public._purchase_request_member_event(p_request_id, v_actor, p_employee_id, 'member_added');
  end if;
end;
$$;

create or replace function public.purchase_request_remove_member(p_request_id uuid, p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_req public.purchase_requests;
  v_removed uuid;
begin
  if v_actor is null or not public.purchase_request_can_manage_members(p_request_id) then
    raise exception 'purchase_request_remove_member: not allowed' using errcode = '42501';
  end if;

  select * into v_req from public.purchase_requests where id = p_request_id;
  if v_req.buyer_id = p_employee_id then
    raise exception 'purchase_request_remove_member: the Buyer cannot be removed' using errcode = '42501';
  end if;

  delete from public.purchase_request_members
  where request_id = p_request_id and employee_id = p_employee_id
  returning id into v_removed;

  if v_removed is null then
    return;
  end if;

  update public.sor_stage_participants
  set closed_at = now(), closed_reason = 'removed', removed_by = v_actor
  where source = 'purchase_request' and source_id = p_request_id
    and employee_id = p_employee_id and closed_at is null;

  perform public._purchase_request_member_event(p_request_id, v_actor, p_employee_id, 'member_removed');
end;
$$;

grant execute on function public.purchase_request_add_member(uuid, uuid) to authenticated;
grant execute on function public.purchase_request_remove_member(uuid, uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- sor_run_stage_actions: one more kind
-- ------------------------------------------------------------------------------
-- The body is #409's, unchanged but for the `open_purchase_request` branch.

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
