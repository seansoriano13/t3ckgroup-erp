-- Code-review fixes for #209's Purchase Request functions.
--   1. has_purchasing_access / is_purchase_request_member / can_read_purchase_request
--      were executable by anon and public: revoke, grant to authenticated.
--   2. Deal Team members (any side, incl. a Purchasing member who is also on the
--      Deal Team) and the Buyer may add Requested Items.
--   3. The Buyer may add a substitute regardless of side.
--   4. A top-up that sets a Buyer on a request with none posts `buyer_set`.
-- Redefines: purchase_request_can_add_items, pr_can_add_substitute,
-- sor_open_purchase_request (body of 20261007100000 plus the buyer_set event).

revoke all on function public.has_purchasing_access() from public, anon;
revoke all on function public.is_purchase_request_member(uuid) from public, anon;
revoke all on function public.can_read_purchase_request(uuid) from public, anon;
grant execute on function public.has_purchasing_access() to authenticated;
grant execute on function public.is_purchase_request_member(uuid) to authenticated;
grant execute on function public.can_read_purchase_request(uuid) to authenticated;

create or replace function public.purchase_request_can_add_items(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from purchase_requests r
    where r.id = p_request_id
      and get_employee_id() is not null
      and (
        r.buyer_id = get_employee_id()
        or exists (
          select 1 from purchase_request_members m
          where m.request_id = r.id
            and m.employee_id = get_employee_id()
            and (
              m.side = 'sales'
              or exists (
                select 1 from sales_opportunities o, public._sor_deal_team_roles(o) t
                where o.id = r.opportunity_id and t.employee_id = m.employee_id
              )
            )
        )
      )
  );
$$;

create or replace function public.pr_can_add_substitute(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(is_super_admin(), false)
      or exists (select 1 from purchase_requests r where r.id = p_request_id and r.buyer_id = get_employee_id());
$$;

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
  v_action jsonb;
  v_config jsonb;
  v_opp public.sales_opportunities;
  v_req public.purchase_requests;
  v_left_out text[];
  v_buyer uuid;
  v_until text;
  v_until_stage uuid;
  v_emp uuid;
  v_created boolean;
  v_buyer_set boolean := false;
begin
  if v_actor is null then
    raise exception 'sor_open_purchase_request: not signed in' using errcode = '42501';
  end if;

  select * into v_run from public.sor_action_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'sor_open_purchase_request: run % not found', p_run_id;
  end if;
  if v_run.purchase_request_id is not null then
    raise exception 'sor_open_purchase_request: run % already opened its request', p_run_id using errcode = '42501';
  end if;
  -- `created` with a decision is a Decider's Create, still to be built.
  if not (v_run.outcome = 'pending' or (v_run.outcome = 'created' and v_run.decided_by is not null)) then
    raise exception 'sor_open_purchase_request: run % is not pending', p_run_id using errcode = '42501';
  end if;

  if not (
    public.sor_can_edit_opportunity(v_run.opportunity_id)
    or public.sor_access_level(v_run.opportunity_id) = 'full'
  ) then
    raise exception 'sor_open_purchase_request: actor % lacks full access to opportunity %', v_actor, v_run.opportunity_id
      using errcode = '42501';
  end if;

  v_action := public._sor_action_run_saved_action(p_run_id);
  if v_action->>'kind' is distinct from 'open_purchase_request' then
    raise exception 'sor_open_purchase_request: run % is not an Open Purchase Request action', p_run_id
      using errcode = '22023';
  end if;
  v_config := coalesce(v_action->'config', '{}'::jsonb);

  -- TODO(#266): the Costing Matrix's Purchasing Incharge does not exist yet,
  -- so that Buyer option resolves to nobody and the request waits for a Take.
  if v_config->'buyer'->>'type' = 'employee' then
    v_buyer := nullif(v_config->'buyer'->>'id', '')::uuid;
  end if;

  v_until := coalesce(nullif(v_config->'access'->>'until', ''), 'stage_left');
  if v_until in ('stage_entered', 'later_stage_left') then
    v_until_stage := nullif(v_config->'access'->>'stageId', '')::uuid;
  end if;

  select coalesce(array_agg(r), '{}') into v_left_out
  from jsonb_array_elements_text(
    case when jsonb_typeof(v_config->'leaveOutRoles') = 'array' then v_config->'leaveOutRoles' else '[]'::jsonb end
  ) r;

  select * into v_opp from public.sales_opportunities where id = v_run.opportunity_id;

  insert into public.purchase_requests
    (opportunity_id, opened_by_action_id, opened_visit_id, buyer_id, created_by, access_until, access_until_stage_id)
  values
    (v_run.opportunity_id, v_run.action_id, v_run.stage_visit_id, v_buyer, v_actor, v_until, v_until_stage)
  on conflict (opportunity_id) do nothing
  returning * into v_req;
  v_created := v_req.id is not null;

  if not v_created then
    -- An existing request (an earlier action, or a concurrent open that won
    -- the race) is topped up: a Buyer only if it has none.
    update public.purchase_requests set buyer_id = v_buyer
    where opportunity_id = v_run.opportunity_id and buyer_id is null and v_buyer is not null
    returning true into v_buyer_set;
    select * into v_req from public.purchase_requests where opportunity_id = v_run.opportunity_id;
  end if;

  -- Members: Purchasing access, the Deal Team minus the left-out roles, the
  -- configured extras, and the Buyer.
  for v_emp in
    select e.id from public.employees e
    where public._employee_has_purchasing_access(e.id)
    union
    select t.employee_id from public._sor_deal_team_roles(v_opp) t
    where not (t.role = any (v_left_out))
      and exists (select 1 from public.employees d where d.id = t.employee_id and not coalesce(d.is_deleted, false))
    union
    select e.id from public.employees e
    where not coalesce(e.is_deleted, false)
      and exists (
        select 1 from jsonb_array_elements(
          case when jsonb_typeof(v_config->'extras') = 'array' then v_config->'extras' else '[]'::jsonb end
        ) s
        where public.sor_selector_covers(s, v_opp, e.id)
      )
    union
    select v_req.buyer_id where v_req.buyer_id is not null
  loop
    perform public._purchase_request_add_member(v_req.id, v_emp, v_actor);
  end loop;

  -- A top-up that gave a Buyer to a request that had none posts the same
  -- `buyer_set` event as Take / Set Buyer; the message trigger notifies them.
  if v_buyer_set then
    perform public._purchase_request_post_event(
      v_req.id, v_actor,
      format('%s was set as Buyer.', coalesce((select name from public.employees where id = v_req.buyer_id), 'Someone')),
      jsonb_build_object('event', 'buyer_set', 'buyer_id', v_req.buyer_id, 'previous_buyer_id', null)
    );
  end if;

  if v_created then
    insert into public.purchase_request_messages (request_id, author_id, content, metadata)
    values (v_req.id, v_actor, 'Purchase Request opened.', jsonb_build_object('event', 'opened'));
  end if;

  update public.sor_action_runs
  set outcome = 'created', purchase_request_id = v_req.id
  where id = p_run_id;

  return v_req.id;
end;
$$;

revoke all on function public.purchase_request_can_add_items(uuid) from public, anon;
revoke all on function public.pr_can_add_substitute(uuid) from public, anon;
revoke all on function public.sor_open_purchase_request(uuid, jsonb) from public, anon;
grant execute on function public.purchase_request_can_add_items(uuid) to authenticated;
grant execute on function public.pr_can_add_substitute(uuid) to authenticated;
grant execute on function public.sor_open_purchase_request(uuid, jsonb) to authenticated;
