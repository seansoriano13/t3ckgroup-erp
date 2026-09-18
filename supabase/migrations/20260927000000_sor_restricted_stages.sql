-- Issue #296 (part of #208, ADR 0021) — Restricted Stages.
--
-- #292 gave every Stage a `shut_out_roles`/`excluded_group_ids` config
-- (`flow_stage_access`) with nothing enforcing it. This migration is what
-- makes that config mean something against the read/move surface #295 built:
--
--   sor_is_stage_shut_out(opp, employee, stage) — the one predicate everyone
--   below calls: true when the employee's every matching Deal Team role on
--   this opportunity is shut out of the stage, or the employee resolves into
--   one of the stage's excluded Employee Groups. An employee who holds no
--   Deal Team role on this opportunity and belongs to no excluded group is
--   never shut out by this function — restriction only narrows access
--   someone would otherwise have, it grants nothing.
--
--   sor_visible_visit_ids — the Deal Team/Always-sees arm now excludes a
--   visit whose own `flow_stage_id` shuts the caller out. Because the check
--   is against *that visit's* stage, not the opportunity's current stage, a
--   visit recorded on a Stage that later shut the caller out stays excluded
--   forever, and a visit on a Stage that never restricted them stays visible
--   even after the SOR moves off it — no separate "role at the time" bit is
--   needed, the visit's own stage is that snapshot.
--
--   sor_locked_summary — `is_restricted` now reports true when the caller
--   would otherwise be Deal Team/Always-sees but is shut out of the
--   opportunity's *current* stage: the "This stage is restricted" case the
--   UI renders instead of a locked participant's ordinary summary.
--
--   sor_guard_stage_move — refuses a move when the caller is shut out of the
--   opportunity's current stage, even though sor_access_level still reads
--   'full' for them (access level is about the opportunity as a whole, not
--   any one stage).
--
--   sor_visit_audience — the Deal Team/Always-sees arm gets the same
--   exclusion as sor_visible_visit_ids, so a restricted visit sends no
--   mention/notification to a shut-out employee.

-- ===========================================================================
-- sor_is_stage_shut_out: the one restriction predicate.
-- ===========================================================================

create or replace function public.sor_is_stage_shut_out(
  p_opp public.sales_opportunities,
  p_employee_id uuid,
  p_stage_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  with fsa as (
    select * from public.flow_stage_access where stage_id = p_stage_id
  ),
  roles as (
    select role from (values
      ('deal_owner', p_opp.deal_owner_id = p_employee_id),
      ('closing_sales', p_opp.closing_sales_id = p_employee_id),
      ('support_sales', p_opp.support_sales_1_id = p_employee_id or p_opp.support_sales_2_id = p_employee_id),
      ('sales_director', p_opp.sales_director_id = p_employee_id),
      ('registrar', p_opp.registered_by = p_employee_id)
    ) as t(role, matches)
    where matches
  )
  select exists (select 1 from fsa)
    and (
      -- Every Deal Team role this employee holds on this opportunity is
      -- shut out of this stage. An employee holding no role here at all
      -- never satisfies this arm — that's the Employee Group arm's job.
      (
        exists (select 1 from roles)
        and not exists (
          select 1 from roles, fsa
          where not (roles.role = any(fsa.shut_out_roles))
        )
      )
      or exists (
        select 1
        from fsa, unnest(fsa.excluded_group_ids) as gid
        where exists (select 1 from public.employee_group_member_ids(gid) m where m = p_employee_id)
      )
    )
$function$;

comment on function public.sor_is_stage_shut_out(public.sales_opportunities, uuid, uuid) is
  'ADR 0021 / #296: true when p_employee_id is shut out of p_stage_id on '
  'p_opp — every Deal Team role they hold there is in shut_out_roles, or '
  'they resolve into an excluded Employee Group. Grants nothing; only '
  'narrows access sor_is_deal_team/sor_always_sees would otherwise give.';

-- ===========================================================================
-- sor_visible_visit_ids: narrow the Deal Team/Always-sees arm per #295's
-- own comment on exactly this line.
-- ===========================================================================

create or replace function public.sor_visible_visit_ids(p_opportunity_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $function$
  -- Super Admin: every visit, no exceptions, ever.
  select v.id
  from public.sor_stage_visits v
  where v.opportunity_id = p_opportunity_id
    and public.is_super_admin()

  union

  -- Deal Team / Always sees: every visit on this opportunity, except one
  -- recorded on a Stage that shuts this caller out (#296). Checked against
  -- the VISIT's own flow_stage_id, not the opportunity's current stage, so a
  -- Stage that restricted this caller stays closed on every visit it ever
  -- recorded, even long after the SOR has moved on.
  select v.id
  from public.sor_stage_visits v
  join public.sales_opportunities o on o.id = v.opportunity_id
  where v.opportunity_id = p_opportunity_id
    and not public.is_super_admin()
    and (
      public.sor_is_deal_team(o, public.get_employee_id())
      or public.sor_always_sees(o, public.get_employee_id())
    )
    and not public.sor_is_stage_shut_out(o, public.get_employee_id(), v.flow_stage_id)

  union

  -- Participants: unchanged by #296 — a Stage Participant's window is its
  -- own call-in and carries no Deal Team role/group exclusion to check.
  select v.id
  from public.sor_stage_participants p
  join public.sor_stage_visits opened on opened.id = p.opened_visit_id
  join public.sor_stage_visits v on v.opportunity_id = p.opportunity_id
  where p.opportunity_id = p_opportunity_id
    and p.employee_id = public.get_employee_id()
    and not public.is_super_admin()
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
$function$;

comment on function public.sor_visible_visit_ids(uuid) is
  'ADR 0021 / #295 & #296: setof sor_stage_visits.id the calling employee '
  'may read on this opportunity. Super Admin sees all; Deal Team/Always '
  'sees see all EXCEPT a visit whose own stage shuts them out '
  '(sor_is_stage_shut_out); Participants see only their window''s visits, '
  'read-only once closed.';

-- ===========================================================================
-- sor_locked_summary: is_restricted now means something.
-- ===========================================================================

create or replace function public.sor_locked_summary(p_opportunity_id uuid)
returns table (
  sales_reference text,
  project_title text,
  current_stage_name text,
  is_restricted boolean
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    o.sales_reference,
    o.project_title,
    fs.name,
    (
      (
        public.sor_is_deal_team(o, public.get_employee_id())
        or public.sor_always_sees(o, public.get_employee_id())
      )
      and public.sor_is_stage_shut_out(o, public.get_employee_id(), o.flow_stage_id)
      and not public.is_super_admin()
    )
  from public.sales_opportunities o
  left join public.flow_stages fs on fs.id = o.flow_stage_id
  where o.id = p_opportunity_id
    and public.sor_access_level(p_opportunity_id) in ('full', 'participant', 'locked')
$function$;

comment on function public.sor_locked_summary(uuid) is
  'ADR 0021 / #295 & #296: the locked-view summary (Sales Reference, '
  'project, current Stage name, restricted flag) for anyone at locked '
  'access or better. is_restricted is true for a Deal Team/Always-sees '
  'caller shut out of the current stage — "This stage is restricted" in '
  'the UI. Returns no rows below locked.';

-- ===========================================================================
-- sor_guard_stage_move: refuse a shut-out caller even at 'full' access.
-- ===========================================================================

create or replace function public.sor_guard_stage_move()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.flow_stage_id is not distinct from OLD.flow_stage_id then
    return NEW;
  end if;

  if auth.role() = 'service_role' then
    return NEW;
  end if;

  if public.sor_access_level(OLD.id) <> 'full' then
    raise exception 'You do not have access to move this stage.' using errcode = '42501';
  end if;

  -- #296: a Deal Team/Always-sees caller still reads 'full' at
  -- sor_access_level (that predicate is opportunity-wide, not per-stage),
  -- but a Restricted Stage refuses the move itself.
  if public.sor_is_stage_shut_out(OLD, public.get_employee_id(), OLD.flow_stage_id) then
    raise exception 'This stage is restricted — you cannot move this SOR.' using errcode = '42501';
  end if;

  return NEW;
end;
$$;

comment on function public.sor_guard_stage_move() is
  'ADR 0021 / #295 & #296: refuses a Stage move (moveAlongFlow''s UPDATE ... '
  'flow_stage_id) unless the caller''s sor_access_level is full AND they are '
  'not shut out of the CURRENT stage. Runs ahead of RLS''s own WITH CHECK.';

-- ===========================================================================
-- sor_visit_audience: same exclusion as sor_visible_visit_ids, so mentions/
-- notifications never reach a shut-out employee for a restricted visit.
-- ===========================================================================

create or replace function public.sor_visit_audience(p_opportunity_id uuid, p_visit_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $function$
  with allowed as (
    select public.sor_access_level(p_opportunity_id) in ('full', 'participant') as ok
  )
  select e.id from public.employees e, allowed
  where allowed.ok and e.is_super_admin

  union

  -- Deal Team + Always sees, provided the visit is one of theirs and this
  -- visit's stage does not shut them out (#296).
  select e.id
  from public.employees e
  join public.sales_opportunities o on o.id = p_opportunity_id
  join public.sor_stage_visits v on v.id = p_visit_id and v.opportunity_id = p_opportunity_id
  , allowed
  where allowed.ok
    and (
      public.sor_is_deal_team(o, e.id)
      or public.sor_always_sees(o, e.id)
    )
    and not public.sor_is_stage_shut_out(o, e.id, v.flow_stage_id)

  union

  -- Participants whose OPEN window currently covers this visit — unchanged.
  select p.employee_id
  from public.sor_stage_participants p
  join public.sor_stage_visits opened on opened.id = p.opened_visit_id
  join public.sor_stage_visits v on v.id = p_visit_id and v.opportunity_id = p.opportunity_id
  , allowed
  where allowed.ok
    and p.opportunity_id = p_opportunity_id
    and p.closed_at is null
    and v.sequence >= opened.sequence
$function$;

comment on function public.sor_visit_audience(uuid, uuid) is
  'ADR 0021 / #295 & #296: employee ids who may see p_visit_id right now, '
  'for mention rosters and notification routing. Excludes anyone '
  'out-of-window and anyone this visit''s stage shuts out.';
