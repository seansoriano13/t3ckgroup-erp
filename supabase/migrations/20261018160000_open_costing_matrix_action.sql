-- Open Costing Matrix, the Stage Action that mounts the matrix (#462, spec #266,
-- ADR 0033). Copies Open Purchase Request (#304) end to end.
--
-- WHAT THIS ADDS
--   flow_stage_actions    accepts the kind `open_costing_matrix`. The config the Flow
--                         Canvas saves (frozen into the Flow Snapshot like any action's):
--                           salesIncharge       { type: 'role', role } | { type: 'employee', id };
--                                               blank = the Deal Owner role
--                           purchasingIncharge  { type: 'employee', id } | null
--                           assigners           people selectors told when the matrix
--                                               opens with no Purchasing Incharge
--                           markupPresetId      a costing_markup_presets row (#269)
--                           extras              people selectors called in as Stage
--                                               Participants (they read the matrix
--                                               without money: the participant tier)
--                           access              { until, stageId }, their window
--   sor_stage_participants  accepts the source `costing_matrix` (source_id = the matrix)
--   sor_action_runs         costing_matrix_id: the matrix a run opened or topped up. A
--                           run that has one is never run again.
--   sor_open_costing_matrix(run, config)
--                         the one way the action runs: from sor_run_stage_actions
--                         (automatic) or, after a Decider's Create, called by the
--                         browser (Optional Action). It reads the action's SAVED config
--                         from the Flow Snapshot and ignores the caller's.
--   costing_open_matrix(opp, cfg)
--                         #267's function, now applying the config (see below).
--   sor_run_stage_actions   one more kind.
--   sor_open_purchase_request
--                         resolves the TODO(#266): the `costing_incharge` Buyer option is
--                         the matrix's Purchasing Incharge.
--
-- ONE MATRIX PER SOR, TOPPED UP
--   costing_open_matrix creates the matrix and its money row once. A later run (the
--   same action on another Stage, or another action) fills only what is still empty:
--   a blank Sales or Purchasing Incharge, a missing default factor, and the members
--   who have no open window on this matrix. It never replaces an Incharge or a factor,
--   never closes or removes a window, and never deletes. A member whose earlier window
--   has closed is called in again with the later run's window (the later Stage asked
--   for them); someone with a window still open is left as they are.
--
-- WHO MAY RUN IT
--   Nobody directly. costing_open_matrix stays service-role only, and
--   costing_matrices has no INSERT grant, so a plain client insert is refused. The
--   action runs through sor_run_stage_actions / sor_open_costing_matrix, which refuse a
--   caller without edit or full access to the SOR (the Open Purchase Request rule) and a
--   run that is not this kind. The Deal Team moves the SOR, so the Deal Team runs it.
--
-- NOTIFICATIONS
--   An extra member who is not the caller gets "Added to a deal". When the run CREATES
--   the matrix and it still has no Purchasing Incharge, each person in `assigners` gets
--   OPPORTUNITY_COSTING_INCHARGE_NEEDED. Incharges themselves get nothing (Incharge is
--   a name, not a call-in).
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: two CHECKs widened
-- with every old value kept, one nullable column, replaced functions with unchanged
-- signatures. Idempotent.

alter table public.flow_stage_actions drop constraint if exists flow_stage_actions_kind_chk;
alter table public.flow_stage_actions add constraint flow_stage_actions_kind_chk
  check (kind in ('create_group_task', 'create_individual_task', 'open_purchase_request', 'open_costing_matrix'));

alter table public.sor_stage_participants drop constraint if exists sor_stage_participants_source_chk;
alter table public.sor_stage_participants add constraint sor_stage_participants_source_chk
  check (source in ('action', 'assignment', 'purchase_request', 'costing_matrix'));

alter table public.sor_action_runs
  add column if not exists costing_matrix_id uuid references public.costing_matrices (id) on delete set null;

comment on column public.sor_action_runs.costing_matrix_id is
  'The Costing Matrix an Open Costing Matrix run opened or topped up (#462). Set once; a run with one is never run again.';

-- Functions
-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Whether a window opened on a Stage Visit is already over for everyone: what
-- close_stage_participant_windows would have closed by now. A row opened then
-- would never close, because the trigger only fires on the move that ends it.
-- The same rule as _purchase_request_window_over, taking the pieces.
create or replace function public._sor_window_over(
  p_opportunity_id uuid,
  p_visit_id uuid,
  p_until text,
  p_until_stage_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_visit_id is null then true
    when exists (
      select 1 from sales_opportunities o
      join flow_stages s on s.id = o.flow_stage_id
      where o.id = p_opportunity_id and s.is_terminal
    ) then true
    when p_until = 'stage_left' then exists (
      select 1 from sor_stage_visits v
      where v.id = p_visit_id and v.left_at is not null
    )
    when p_until = 'stage_entered' then exists (
      select 1 from sor_stage_visits opened
      join sor_stage_visits v on v.opportunity_id = opened.opportunity_id and v.sequence > opened.sequence
      where opened.id = p_visit_id and v.flow_stage_id = p_until_stage_id
    )
    when p_until = 'later_stage_left' then exists (
      select 1 from sor_stage_visits opened
      join sor_stage_visits v on v.opportunity_id = opened.opportunity_id and v.sequence >= opened.sequence
      where opened.id = p_visit_id
        and v.flow_stage_id = p_until_stage_id
        and v.left_at is not null
    )
    else false
  end;
$$;

revoke all on function public._sor_window_over(uuid, uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- costing_open_matrix: creates the SOR's matrix once and applies the config
-- ---------------------------------------------------------------------------
-- p_config (all optional, all resolved to ids by the caller):
--   sales_incharge_id, purchasing_incharge_id   filled only while blank
--   default_preset_id                           sets default_preset_id and default_factor
--                                               (the preset's factor) only while the matrix
--                                               has no default factor, and only if the preset
--                                               is active
--   member_ids[], opened_visit_id, access_until, access_until_stage_id
--                                               Stage Participant windows, source costing_matrix
--   assigner_ids[]                              told when THIS call creates the matrix and it
--                                               has no Purchasing Incharge
-- Returns the matrix id. Not granted to authenticated: sor_open_costing_matrix is
-- the way in; until then the service role calls it (the policy tests).
create or replace function public.costing_open_matrix(p_opportunity_id uuid, p_config jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id          uuid;
  v_created     boolean;
  v_sales       uuid := nullif(p_config ->> 'sales_incharge_id', '')::uuid;
  v_buyer       uuid := nullif(p_config ->> 'purchasing_incharge_id', '')::uuid;
  v_preset      public.costing_markup_presets;
  v_visit       uuid := nullif(p_config ->> 'opened_visit_id', '')::uuid;
  v_until       text := coalesce(nullif(p_config ->> 'access_until', ''), 'stage_left');
  v_until_stage uuid := nullif(p_config ->> 'access_until_stage_id', '')::uuid;
  v_actor       uuid := public.get_employee_id();
  v_label       text;
  v_emp         uuid;
begin
  if not exists (select 1 from public.sales_opportunities where id = p_opportunity_id) then
    raise exception 'costing_open_matrix: SOR not found' using errcode = 'P0002';
  end if;

  perform set_config('costing.bypass', 'on', true);

  insert into public.costing_matrices (opportunity_id, sales_incharge_id, purchasing_incharge_id)
  values (p_opportunity_id, v_sales, v_buyer)
  on conflict (opportunity_id) do nothing
  returning id into v_id;
  v_created := v_id is not null;

  if not v_created then
    select id into v_id from public.costing_matrices where opportunity_id = p_opportunity_id;
    update public.costing_matrices
       set sales_incharge_id = coalesce(sales_incharge_id, v_sales),
           purchasing_incharge_id = coalesce(purchasing_incharge_id, v_buyer)
     where id = v_id
       and ((sales_incharge_id is null and v_sales is not null)
         or (purchasing_incharge_id is null and v_buyer is not null));
  end if;

  insert into public.costing_matrix_money (matrix_id) values (v_id) on conflict (matrix_id) do nothing;

  -- The markup default: a typed factor, or one already chosen, stays.
  if nullif(p_config ->> 'default_preset_id', '') is not null then
    select * into v_preset from public.costing_markup_presets
     where id = (p_config ->> 'default_preset_id')::uuid and active;
    if found then
      update public.costing_matrix_money
         set default_preset_id = v_preset.id, default_factor = v_preset.factor
       where matrix_id = v_id and default_factor is null;
    end if;
  end if;

  select nullif(concat_ws(' · ', o.sales_reference, o.project_title), '') into v_label
    from public.sales_opportunities o where o.id = p_opportunity_id;

  -- Members: a window each, for whoever has no open one on this matrix.
  if v_visit is not null
     and jsonb_typeof(p_config -> 'member_ids') = 'array'
     and not public._sor_window_over(p_opportunity_id, v_visit, v_until, v_until_stage) then
    for v_emp in
      select distinct e.id
        from jsonb_array_elements_text(p_config -> 'member_ids') m
        join public.employees e on e.id = m::uuid and not coalesce(e.is_deleted, false)
    loop
      if not exists (
        select 1 from public.sor_stage_participants p
         where p.opportunity_id = p_opportunity_id
           and p.employee_id = v_emp
           and p.source = 'costing_matrix'
           and p.source_id = v_id
           and p.closed_at is null
      ) then
        insert into public.sor_stage_participants
          (opportunity_id, employee_id, source, source_id, opened_visit_id, until_rule, until_stage_id)
        values
          (p_opportunity_id, v_emp, 'costing_matrix', v_id, v_visit, v_until,
           case when v_until in ('stage_entered', 'later_stage_left') then v_until_stage end);

        if v_emp is distinct from v_actor then
          insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
          values (v_emp, v_actor, 'SOR_STAGE_PARTICIPANT_ADDED', 'Added to a deal',
                  format('You were added to %s to see its Costing Matrix.', coalesce(v_label, 'a deal')),
                  p_opportunity_id::text);
        end if;
      end if;
    end loop;
  end if;

  -- Opened with nobody to buy: tell whoever assigns one.
  if v_created
     and jsonb_typeof(p_config -> 'assigner_ids') = 'array'
     and exists (select 1 from public.costing_matrices where id = v_id and purchasing_incharge_id is null) then
    for v_emp in
      select distinct e.id
        from jsonb_array_elements_text(p_config -> 'assigner_ids') a
        join public.employees e on e.id = a::uuid and not coalesce(e.is_deleted, false)
    loop
      insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
      values (v_emp, v_actor, 'OPPORTUNITY_COSTING_INCHARGE_NEEDED', 'Costing Matrix needs a Purchasing Incharge',
              format('The Costing Matrix for %s opened with no Purchasing Incharge. Please name one.', coalesce(v_label, 'a deal')),
              p_opportunity_id::text);
    end loop;
  end if;

  perform set_config('costing.bypass', 'off', true);
  return v_id;
end;
$$;

revoke all on function public.costing_open_matrix(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.costing_open_matrix(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- The action
-- ---------------------------------------------------------------------------

-- Returns the matrix's id. `p_config` is accepted for symmetry with
-- sor_open_purchase_request and ignored: the saved config is the only one read.
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
  v_config jsonb;
  v_opp public.sales_opportunities;
  v_sel jsonb;
  v_sales uuid;
  v_buyer uuid;
  v_visit uuid;
  v_until text;
  v_until_stage uuid;
  v_members jsonb;
  v_assigners jsonb;
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
  if v_action->>'kind' is distinct from 'open_costing_matrix' then
    raise exception 'sor_open_costing_matrix: run % is not an Open Costing Matrix action', p_run_id
      using errcode = '22023';
  end if;
  v_config := coalesce(v_action->'config', '{}'::jsonb);

  select * into v_opp from public.sales_opportunities where id = v_run.opportunity_id;

  -- Sales Incharge: the configured role or person; the Deal Owner role by default.
  v_sel := coalesce(v_config->'salesIncharge', jsonb_build_object('type', 'role', 'role', 'deal_owner'));
  v_sales := case v_sel->>'type'
    when 'employee' then nullif(v_sel->>'id', '')::uuid
    when 'role' then case v_sel->>'role'
      when 'deal_owner' then v_opp.deal_owner_id
      when 'closing_sales' then v_opp.closing_sales_id
      when 'support_sales' then coalesce(v_opp.support_sales_1_id, v_opp.support_sales_2_id)
      when 'sales_director' then v_opp.sales_director_id
      when 'registrar' then v_opp.registered_by
    end
  end;
  select e.id into v_sales from public.employees e where e.id = v_sales and not coalesce(e.is_deleted, false);

  if v_config->'purchasingIncharge'->>'type' = 'employee' then
    select e.id into v_buyer from public.employees e
     where e.id = nullif(v_config->'purchasingIncharge'->>'id', '')::uuid and not coalesce(e.is_deleted, false);
  end if;

  v_visit := coalesce(
    v_run.stage_visit_id,
    (select v.id from public.sor_stage_visits v
      where v.opportunity_id = v_run.opportunity_id and v.left_at is null and v.undone_at is null
      order by v.sequence desc limit 1)
  );
  v_until := coalesce(nullif(v_config->'access'->>'until', ''), 'stage_left');
  if v_until in ('stage_entered', 'later_stage_left') then
    v_until_stage := nullif(v_config->'access'->>'stageId', '')::uuid;
  end if;

  select coalesce(jsonb_agg(e.id), '[]'::jsonb) into v_members
  from public.employees e
  where not coalesce(e.is_deleted, false)
    and exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(v_config->'extras') = 'array' then v_config->'extras' else '[]'::jsonb end
      ) s
      where public.sor_selector_covers(s, v_opp, e.id)
    );

  select coalesce(jsonb_agg(e.id), '[]'::jsonb) into v_assigners
  from public.employees e
  where not coalesce(e.is_deleted, false)
    and exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(v_config->'assigners') = 'array' then v_config->'assigners' else '[]'::jsonb end
      ) s
      where public.sor_selector_covers(s, v_opp, e.id)
    );

  v_matrix := public.costing_open_matrix(v_run.opportunity_id, jsonb_build_object(
    'sales_incharge_id', v_sales,
    'purchasing_incharge_id', v_buyer,
    'default_preset_id', nullif(v_config->>'markupPresetId', ''),
    'member_ids', v_members,
    'opened_visit_id', v_visit,
    'access_until', v_until,
    'access_until_stage_id', v_until_stage,
    'assigner_ids', v_assigners
  ));

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

-- ---------------------------------------------------------------------------
-- sor_open_purchase_request: the Costing Purchasing Incharge as the Buyer
-- ---------------------------------------------------------------------------
-- The body is 20261009110000's, unchanged but for the `costing_incharge` Buyer
-- option, which was a TODO(#266) resolving to nobody. It is the SOR's matrix's
-- Purchasing Incharge at the moment the request opens; no matrix, or none named,
-- is no Buyer (the request waits for a Take, as before). A later run of the
-- action still sets a Buyer only where there is none.

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

-- ---------------------------------------------------------------------------
-- sor_run_stage_actions: one more kind
-- ---------------------------------------------------------------------------
-- The body is 20261005130200's, unchanged but for the `open_costing_matrix` branch.

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

