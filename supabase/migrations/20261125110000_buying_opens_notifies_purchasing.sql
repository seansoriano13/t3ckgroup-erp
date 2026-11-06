-- Buying opens here: tell Purchasing.
--
-- WHY: the Purchase Request is opened at an early Stage (Lead), so by the time the SOR reaches the Stage flagged
-- "Buying opens here" (NTP) the action only reuses the existing request and posts nothing. The "opened" notice is
-- once per request, so Purchasing never heard that buying had started.
--
-- WHAT THIS CHANGES
--   sor_open_purchase_request  (the 20261121160000 body, copied verbatim, plus one block): when a run reuses an existing
--                              request at the Stage flagged buying_opens_here, notify the request's Buyer and the SOR's
--                              Purchasing Incharge, or every Purchasing member while neither is named
--                              (type PURCHASE_REQUEST_BUYING_OPENED). A request created at that Stage keeps its one
--                              "opened" notice.
--
-- SAFE TO RUN AT ANY TIME: create or replace of the same signature.

create or replace function public.sor_open_purchase_request(p_run_id uuid, p_config jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_requesters jsonb;
  v_reraise public.purchase_requests;
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

  -- #462: the Costing Matrix's Purchasing Incharge, if the SOR has a matrix that
  -- names one; otherwise nobody and the request waits for a Take.
  if v_config->'buyer'->>'type' = 'employee' then
    v_buyer := nullif(v_config->'buyer'->>'id', '')::uuid;
  elsif v_config->'buyer'->>'type' = 'costing_incharge' then
    select m.purchasing_incharge_id into v_buyer
    from public.costing_matrices m
    where m.opportunity_id = v_run.opportunity_id;
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

  -- Who may request items: the action's list, or null (the Deal Team, as
  -- before) for an action saved before the setting existed.
  if jsonb_typeof(v_config->'requesters') = 'array' then
    v_requesters := v_config->'requesters';
  end if;

  insert into public.purchase_requests
    (opportunity_id, opened_by_action_id, opened_visit_id, buyer_id, created_by, access_until, access_until_stage_id, requesters)
  values
    (v_run.opportunity_id, v_run.action_id, v_run.stage_visit_id, v_buyer, v_actor, v_until, v_until_stage, v_requesters)
  on conflict (opportunity_id) do nothing
  returning * into v_req;
  v_created := v_req.id is not null;

  if not v_created then
    -- An existing request (an earlier action, or a concurrent open that won
    -- the race) is topped up: a Buyer only if it has none.
    update public.purchase_requests set buyer_id = v_buyer
    where opportunity_id = v_run.opportunity_id and buyer_id is null and v_buyer is not null
    returning true into v_buyer_set;
    -- A list arriving for a request that had none takes effect.
    update public.purchase_requests set requesters = v_requesters
    where opportunity_id = v_run.opportunity_id and requesters is null and v_requesters is not null;
    select * into v_req from public.purchase_requests where opportunity_id = v_run.opportunity_id;
  end if;

  -- Members: Purchasing access, the Deal Team minus the left-out roles, the
  -- configured extras, whoever may request items, and the Buyer.
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
    select e.id from public.employees e
    where not coalesce(e.is_deleted, false)
      and exists (
        select 1 from jsonb_array_elements(coalesce(v_req.requesters, '[]'::jsonb)) s
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

  -- #883: a run that reuses the request raises the window again for its purchasing
  -- members, on this run's visit and with this action's rule. Without it a window that
  -- closed at an earlier Stage (Lead only) never reopens at the buying Stage.
  if not v_created and v_run.stage_visit_id is not null then
    v_reraise := v_req;
    v_reraise.opened_visit_id := v_run.stage_visit_id;
    v_reraise.access_until := v_until;
    v_reraise.access_until_stage_id := v_until_stage;
    for v_emp in
      select m.employee_id from public.purchase_request_members m
      where m.request_id = v_req.id and m.side = 'purchasing'
    loop
      perform public._purchase_request_open_window(v_reraise, v_emp);
    end loop;
  end if;

  if v_created then
    insert into public.purchase_request_messages (request_id, author_id, content, metadata)
    values (v_req.id, v_actor, 'Purchase Request opened.', jsonb_build_object('event', 'opened'));
  end if;

  -- Buying opens here: this run reused a request opened at an earlier Stage, so the "opened" notice
  -- never reaches Purchasing again. At the Stage flagged "Buying opens here", tell the Buyer and the SOR's
  -- Purchasing Incharge (every Purchasing member while neither is named) that buying has started.
  if not v_created and v_run.stage_visit_id is not null and exists (
    select 1
    from public.sor_stage_visits sv
    join public.flow_stages fs on fs.id = sv.flow_stage_id
    where sv.id = v_run.stage_visit_id and fs.buying_opens_here
  ) then
    perform public._purchase_request_notify(
      v_req.id,
      coalesce(
        nullif(
          array(
            select x from (
              select v_req.buyer_id as x
              union
              select m.purchasing_incharge_id from public.costing_matrices m where m.opportunity_id = v_run.opportunity_id
            ) q where x is not null
          ),
          '{}'::uuid[]
        ),
        array(select e.id from public.employees e where public._employee_has_purchasing_access(e.id))
      ),
      v_actor, 'PURCHASE_REQUEST_BUYING_OPENED',
      'Buying has started',
      public._purchase_request_label(v_req.id) || ': the SOR reached the Stage where buying opens. P0s can be attached now.',
      false
    );
  end if;

  update public.sor_action_runs
  set outcome = 'created', purchase_request_id = v_req.id
  where id = p_run_id;

  return v_req.id;
end;
$function$;
