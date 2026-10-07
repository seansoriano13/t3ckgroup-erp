-- ==============================================================================
-- 20261007100000_open_purchase_request_fixes.sql
--
-- Issue #304 follow-up — fixes to 20261005150000_open_purchase_request_action.
-- That file has been pushed, so everything here replaces it rather than
-- editing it.
--
-- WHO MAY CALL
-- `purchase_request_member_side`, `sor_open_purchase_request`,
-- `purchase_request_can_manage_members` and the two member RPCs were left
-- executable by `anon` (Supabase grants new public functions to it). They
-- are now `authenticated` only. The helpers added here are internal.
--
-- THE CONFIG IS THE SAVED ONE
-- `sor_open_purchase_request` used to take the Buyer, extra members,
-- left-out roles and window from its caller, so anyone with full access to
-- the SOR could open a request on any terms. It now reads the action's
-- config as saved in the Flow Snapshot the run's visit was made under (the
-- SOR's own snapshot, then the live action, as fallbacks), and resolves the
-- extra members' selectors itself with `sor_selector_covers`. `p_config` is
-- still accepted, so a frontend from before this migration keeps working,
-- and ignored.
--
-- FIRE ONCE
-- A run that has already opened its request is refused: the run now records
-- the request it opened (`sor_action_runs.purchase_request_id`). A
-- `created` run is still admitted while it has none, because a Decider's
-- Create flips the run to `created` before the request is opened. A run of
-- any other action kind is refused.
--
-- WINDOWS THAT ARE ALREADY OVER
-- A purchasing member added once the request's window is over (the opening
-- visit left, under `stage_left`; the Stage entered or left, under the
-- other rules; a Terminal Stage reached) gets no Stage Participant row. A
-- row opened then would never close, since the triggers that close windows
-- only fire on the move that ends them.
--
-- MEMBERS SEE THE LOCKED HEADER
-- `sor_access_level` answers `locked` for a member of the SOR's request who
-- has no better access, so a member who is neither on the Deal Team nor
-- holding a window still sees the SOR's locked header.
--
-- CORRECTION
-- 20261005150000's header calls its two new columns "nullable-defaulted".
-- `access_until_stage_id` is nullable; `access_until` is `not null default
-- 'stage_left'`.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: one
-- nullable column and its backfill, new and replaced functions with
-- unchanged signatures. Idempotent.
-- ==============================================================================

alter table public.sor_action_runs
  add column if not exists purchase_request_id uuid references public.purchase_requests (id) on delete set null;

comment on column public.sor_action_runs.purchase_request_id is
  'The Purchase Request an Open Purchase Request run opened or topped up (#304). Set once; a run with one is never run again.';

-- Runs that opened or topped up a request before this column existed: any
-- created Open Purchase Request run on an SOR that has a request.
update public.sor_action_runs r
set purchase_request_id = pr.id
from public.purchase_requests pr, public.flow_stage_actions fa
where r.purchase_request_id is null
  and r.outcome = 'created'
  and fa.id = r.action_id
  and fa.kind = 'open_purchase_request'
  and pr.opportunity_id = r.opportunity_id;

comment on column public.purchase_requests.access_until_stage_id is
  'The Stage `access_until` is measured against, for stage_entered and later_stage_left; null otherwise.';

-- ------------------------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------------------------

-- Whether an employee holds Purchasing access. The one place the rule lives.
create or replace function public._employee_has_purchasing_access(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = p_employee_id
      and e.has_purchasing_flow
      and not coalesce(e.is_deleted, false)
  );
$$;

revoke all on function public._employee_has_purchasing_access(uuid) from public, anon, authenticated;

create or replace function public.has_purchasing_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._employee_has_purchasing_access(get_employee_id());
$$;

-- An SOR's Deal Team, one row per role held. Column list mirrors
-- DEAL_TEAM_ROLES in resolvePeople.js.
create or replace function public._sor_deal_team_roles(p_opp public.sales_opportunities)
returns table (employee_id uuid, role text)
language sql
stable
set search_path = public
as $$
  select x.employee_id, x.role
  from (values
    (p_opp.registered_by, 'registrar'),
    (p_opp.deal_owner_id, 'deal_owner'),
    (p_opp.closing_sales_id, 'closing_sales'),
    (p_opp.support_sales_1_id, 'support_sales'),
    (p_opp.support_sales_2_id, 'support_sales'),
    (p_opp.sales_director_id, 'sales_director')
  ) as x (employee_id, role)
  where x.employee_id is not null;
$$;

revoke all on function public._sor_deal_team_roles(public.sales_opportunities) from public, anon, authenticated;

-- A run's action as saved: { id, kind, config } from the Flow Snapshot its
-- visit was made under, else the SOR's snapshot, else the live action. Both
-- snapshot shapes (an array, or arrays keyed by Stage) are read, as in
-- stage_action_carries_on.
create or replace function public._sor_action_run_saved_action(p_run_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with run as (
    select r.action_id, coalesce(v.flow_snapshot_id, o.flow_snapshot_id) as snapshot_id
    from sor_action_runs r
    join sales_opportunities o on o.id = r.opportunity_id
    left join sor_stage_visits v on v.id = r.stage_visit_id
    where r.id = p_run_id
  ),
  frozen as (
    select a.value
    from run
    join flow_snapshots s on s.id = run.snapshot_id,
      lateral jsonb_array_elements(
        case jsonb_typeof(s.snapshot_data->'actions')
          when 'array' then s.snapshot_data->'actions'
          when 'object' then (
            select coalesce(jsonb_agg(e), '[]'::jsonb)
            from jsonb_each(s.snapshot_data->'actions') g, jsonb_array_elements(g.value) e
          )
          else '[]'::jsonb
        end
      ) a
    where a.value->>'id' = run.action_id::text
    limit 1
  )
  select jsonb_build_object(
    'id', fa.id,
    'kind', coalesce((select value->>'kind' from frozen), fa.kind),
    'config', coalesce((select value->'config' from frozen), fa.config, '{}'::jsonb)
  )
  from run
  join flow_stage_actions fa on fa.id = run.action_id;
$$;

revoke all on function public._sor_action_run_saved_action(uuid) from public, anon, authenticated;

-- Whether a request's purchasing window has already closed for everyone:
-- what close_stage_participant_windows would have closed by now.
create or replace function public._purchase_request_window_over(p_req public.purchase_requests)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_req.opened_visit_id is null then true
    when exists (
      select 1 from sales_opportunities o
      join flow_stages s on s.id = o.flow_stage_id
      where o.id = p_req.opportunity_id and s.is_terminal
    ) then true
    when p_req.access_until = 'stage_left' then exists (
      select 1 from sor_stage_visits v
      where v.id = p_req.opened_visit_id and v.left_at is not null
    )
    when p_req.access_until = 'stage_entered' then exists (
      select 1 from sor_stage_visits opened
      join sor_stage_visits v on v.opportunity_id = opened.opportunity_id and v.sequence > opened.sequence
      where opened.id = p_req.opened_visit_id and v.flow_stage_id = p_req.access_until_stage_id
    )
    when p_req.access_until = 'later_stage_left' then exists (
      select 1 from sor_stage_visits opened
      join sor_stage_visits v on v.opportunity_id = opened.opportunity_id and v.sequence >= opened.sequence
      where opened.id = p_req.opened_visit_id
        and v.flow_stage_id = p_req.access_until_stage_id
        and v.left_at is not null
    )
    else false
  end;
$$;

revoke all on function public._purchase_request_window_over(public.purchase_requests) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Members
-- ------------------------------------------------------------------------------

create or replace function public.purchase_request_member_side(p_opportunity_id uuid, p_employee_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public._employee_has_purchasing_access(p_employee_id) then 'purchasing'
    when exists (
      select 1 from sales_opportunities o, public._sor_deal_team_roles(o) t
      where o.id = p_opportunity_id and t.employee_id = p_employee_id
    ) then 'sales'
    else 'other'
  end;
$$;

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
     and not public._purchase_request_window_over(v_req)
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

-- The config read is the modal's: { buyer, extras, leaveOutRoles, access }.
-- `p_config` is ignored; see the header.
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
    where opportunity_id = v_run.opportunity_id and buyer_id is null and v_buyer is not null;
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

comment on function public.sor_open_purchase_request(uuid, jsonb) is
  '#304: the Open Purchase Request Stage Action. Opens the SOR''s one request or tops an existing one up (Buyer only if none, missing members only), from the action''s saved config, under the caller''s full-access check, and marks the run created with its request. p_config is ignored.';

-- ------------------------------------------------------------------------------
-- sor_access_level: a request member is at least locked
-- ------------------------------------------------------------------------------
-- The body is 20261001140000's, unchanged but for the last `locked` arm.

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
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
        and p.closed_at is null
    ) then 'participant'
    when exists (
      select 1 from public.sor_mention_viewers m
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
    ) then 'participant'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
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

-- ------------------------------------------------------------------------------
-- Grants: signed-in callers only
-- ------------------------------------------------------------------------------

revoke all on function public.purchase_request_member_side(uuid, uuid) from public, anon;
revoke all on function public.sor_open_purchase_request(uuid, jsonb) from public, anon;
revoke all on function public.purchase_request_can_manage_members(uuid) from public, anon;
revoke all on function public.purchase_request_add_member(uuid, uuid) from public, anon;
revoke all on function public.purchase_request_remove_member(uuid, uuid) from public, anon;

grant execute on function public.purchase_request_member_side(uuid, uuid) to authenticated;
grant execute on function public.sor_open_purchase_request(uuid, jsonb) to authenticated;
grant execute on function public.purchase_request_can_manage_members(uuid) to authenticated;
grant execute on function public.purchase_request_add_member(uuid, uuid) to authenticated;
grant execute on function public.purchase_request_remove_member(uuid, uuid) to authenticated;
