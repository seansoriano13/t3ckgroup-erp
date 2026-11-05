-- Issue #883 (spec #907, decision 4) — the Buyer and the SOR's Purchasing
-- Incharge keep the SOR while a Purchase Request has an open line.
--
-- Before this, the Buyer's Stage Participant window was opened at the Lead
-- Stage (access "Only this Stage"). It closed on the move to NTP, where buying
-- opens, and the action run there reused the existing request and opened
-- nothing, so the Buyer saw only the quick view.
--
-- WHAT THIS CHANGES
--   _purchase_request_buyer_access   new helper: the employee is the request's
--                                    Buyer or the SOR's costing matrix Purchasing
--                                    Incharge, and the request has at least one
--                                    line that is not closed.
--   sor_access_level                 that employee gets 'participant' (the header).
--   sor_visible_visit_ids            and sees the SOR's current Stage Visit.
--   sor_open_purchase_request        a run that reuses an existing request raises
--                                    the access window again for the request's
--                                    purchasing members, on the run's visit and
--                                    with the action's own rule.
--
-- The bodies of the last two are the latest definitions copied verbatim, with
-- only the lines marked #883 added.

create or replace function public._purchase_request_buyer_access(p_opportunity_id uuid, p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_employee_id is not null
    and p_opportunity_id is not null
    and exists (
      select 1
      from public.purchase_requests r
      where r.opportunity_id = p_opportunity_id
        and (
          r.buyer_id = p_employee_id
          or exists (
            select 1 from public.costing_matrices m
            where m.opportunity_id = r.opportunity_id
              and m.purchasing_incharge_id = p_employee_id
          )
        )
        and exists (
          select 1 from public.purchase_request_items i
          where i.request_id = r.id
            and i.status not in ('available', 'received', 'cannot_source', 'cancelled')
        )
    );
$$;

revoke all on function public._purchase_request_buyer_access(uuid, uuid) from public, anon, authenticated;

create or replace function public.sor_access_level(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when not exists (select 1 from public.sales_opportunities where id = p_opportunity_id) then 'none'
    when public.is_super_admin() then 'full'
    when exists (
      select 1 from public.sales_opportunities o
      where o.id = p_opportunity_id
        and (
          public.sor_is_deal_team(o, public.get_employee_id())
          or public.sor_always_sees(o, public.get_employee_id())
        )
    ) then 'full'
    -- #545: the Final Acquire list or the Evaluation list, on an SOR that has a Costing Matrix.
    -- Independent of stage, mention and Stage Participants.
    when (public.costing_on_list('final_acquire') or public.costing_on_list('evaluation'))
      and exists (select 1 from public.costing_matrices m where m.opportunity_id = p_opportunity_id)
    then 'participant'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
        and p.closed_at is null
    ) then 'participant'
    -- #883: the Buyer and the SOR's Purchasing Incharge, while a Purchase Request has an open line.
    when public._purchase_request_buyer_access(p_opportunity_id, public.get_employee_id()) then 'participant'
    -- An open Mention Window, or the header grant on an SOR that still has no visit.
    when exists (
      select 1 from public.sor_mention_viewers m
      left join public.sor_stage_visits v on v.id = m.stage_visit_id
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
        and (
          (m.stage_visit_id is null
            and not exists (select 1 from public.sor_stage_visits sv where sv.opportunity_id = p_opportunity_id))
          -- v.id, not just v.left_at: a null grant left-joins to all-null v.
          or (v.id is not null and v.left_at is null and v.undone_at is null)
        )
    ) then 'participant'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
    ) then 'locked'
    -- A Mention Window the SOR has since left, or a header grant it outgrew.
    when exists (
      select 1 from public.sor_mention_viewers m
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
    ) then 'locked'
    when exists (
      select 1 from public.purchase_request_members m
      join public.purchase_requests r on r.id = m.request_id
      where r.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
    ) then 'locked'
    else 'none'
  end
$function$;

create or replace function public.sor_visible_visit_ids(p_opportunity_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $function$
  select v.id
  from public.sor_stage_visits v
  where v.opportunity_id = p_opportunity_id
    and v.undone_at is null
    and public.is_super_admin()

  union

  select v.id
  from public.sor_stage_visits v
  join public.sales_opportunities o on o.id = v.opportunity_id
  where v.opportunity_id = p_opportunity_id
    and v.undone_at is null
    and not public.is_super_admin()
    and (
      public.sor_is_deal_team(o, public.get_employee_id())
      or public.sor_always_sees(o, public.get_employee_id())
    )
    and not public.sor_is_stage_shut_out(o, public.get_employee_id(), v.flow_stage_id)

  union

  select v.id
  from public.sor_stage_participants p
  join public.sor_stage_visits opened on opened.id = p.opened_visit_id
  join public.sor_stage_visits v on v.opportunity_id = p.opportunity_id
  where p.opportunity_id = p_opportunity_id
    and p.employee_id = public.get_employee_id()
    and not public.is_super_admin()
    and opened.undone_at is null
    and v.undone_at is null
    and (
      (p.closed_at is null and v.sequence >= opened.sequence)
      or (
        p.closed_at is not null
        and v.sequence >= opened.sequence
        and v.sequence <= (
          select max(closing.sequence)
          from public.sor_stage_visits closing
          where closing.opportunity_id = p.opportunity_id
            and closing.sequence >= opened.sequence
            and closing.left_at is not null
            and closing.left_at <= p.closed_at
        )
      )
    )

  union

  -- #883: the Buyer and the SOR's Purchasing Incharge, while a Purchase Request has an open line,
  -- see the Stage Visit the SOR is in now (and nothing before it).
  select v.id
  from public.sor_stage_visits v
  where v.opportunity_id = p_opportunity_id
    and v.undone_at is null
    and v.left_at is null
    and not public.is_super_admin()
    and public._purchase_request_buyer_access(p_opportunity_id, public.get_employee_id())

  union

  -- Mention Windows: exactly the visit each Mention was made on, open or since
  -- left (a left one is the locked view's read-only look).
  select v.id
  from public.sor_mention_viewers m
  join public.sor_stage_visits v on v.id = m.stage_visit_id
  where m.opportunity_id = p_opportunity_id
    and m.employee_id = public.get_employee_id()
    and not public.is_super_admin()
    and v.undone_at is null
    -- TIGHTEN(mention): a Restricted Stage stays shut to a Mention. Uncomment:
    -- and not exists (
    --   select 1 from public.sales_opportunities o
    --   where o.id = v.opportunity_id
    --     and public.sor_is_stage_shut_out(o, public.get_employee_id(), v.flow_stage_id)
    -- )
$function$;

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

  update public.sor_action_runs
  set outcome = 'created', purchase_request_id = v_req.id
  where id = p_run_id;

  return v_req.id;
end;
$function$;
