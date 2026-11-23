-- #1178: the SORs list times out for people who see many SORs (Bugsink T3CKGROUP-ERP-2).
--
-- Cause: sor_logs_for_sors (#1042) asks sor_visible_visit_ids and sor_access_level about every SOR on the
-- list. Both look the caller up again inside every arm and every row: get_employee_id() and
-- is_super_admin() each cost about 0.6 ms a call, and they run several times per SOR and per Stage Visit.
-- On prod (2026-11-23) a Finance Assistant sees 324 SORs; one sor_logs_for_sors call took 5.5-5.9 s, and
-- the SORs page makes two at once, so one of them passed the 8 s statement timeout.
--
-- Fix: the same two rules, written once each, with the caller passed in:
--   * _sor_access_level_as(sor, employee, is_super, costing_lister)
--   * _sor_visible_visit_ids_as(sor, employee, is_super)
-- sor_access_level / sor_visible_visit_ids become thin wrappers that look the caller up once and call
-- them, so every existing caller (the sor_log_read policy, screens, other functions) gets the same answer,
-- a little faster. sor_logs_for_sors, sor_readable_visit_ids and sor_readable_log_sor_ids look the caller up
-- once per query instead of once per SOR. Same rules, same answers (ADR 0021 unchanged), different shape.
--
-- The _as functions are private: no role but the owner may execute them, because they trust the employee
-- id they are given. Only the SECURITY DEFINER wrappers below call them, always with the real caller.
--
-- SAFE TO RUN AT ANY TIME. Idempotent.

create or replace function public._sor_access_level_as(
  p_opportunity_id uuid,
  p_employee_id uuid,
  p_is_super_admin boolean,
  p_costing_lister boolean default null
)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when not exists (select 1 from public.sales_opportunities where id = p_opportunity_id) then 'none'
    when p_is_super_admin then 'full'
    when exists (
      select 1 from public.sales_opportunities o
      where o.id = p_opportunity_id
        and (
          public.sor_is_deal_team(o, p_employee_id)
          or public.sor_always_sees(o, p_employee_id)
        )
    ) then 'full'
    -- #545: the Final Acquire list or the Evaluation list, on an SOR that has a Costing Matrix.
    -- Independent of stage, mention and Stage Participants. Null = not worked out yet: work it out here,
    -- only when this arm is reached (as before).
    when coalesce(p_costing_lister, public.costing_on_list('final_acquire') or public.costing_on_list('evaluation'))
      and exists (select 1 from public.costing_matrices m where m.opportunity_id = p_opportunity_id)
    then 'participant'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = p_employee_id
        and p.closed_at is null
    ) then 'participant'
    -- #883: the Buyer and the SOR's Purchasing Incharge, while a Purchase Request has an open line.
    -- _purchase_request_buyer_access needs a Purchase Request on this SOR; skip the call when there is none.
    when exists (select 1 from public.purchase_requests r where r.opportunity_id = p_opportunity_id)
      and public._purchase_request_buyer_access(p_opportunity_id, p_employee_id) then 'participant'
    -- An open Mention Window, or the header grant on an SOR that still has no visit.
    when exists (
      select 1 from public.sor_mention_viewers m
      left join public.sor_stage_visits v on v.id = m.stage_visit_id
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = p_employee_id
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
        and p.employee_id = p_employee_id
    ) then 'locked'
    -- A Mention Window the SOR has since left, or a header grant it outgrew.
    when exists (
      select 1 from public.sor_mention_viewers m
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = p_employee_id
    ) then 'locked'
    when exists (
      select 1 from public.purchase_request_members m
      join public.purchase_requests r on r.id = m.request_id
      where r.opportunity_id = p_opportunity_id
        and m.employee_id = p_employee_id
    ) then 'locked'
    else 'none'
  end
$function$;

create or replace function public._sor_visible_visit_ids_as(
  p_opportunity_id uuid,
  p_employee_id uuid,
  p_is_super_admin boolean
)
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select v.id
  from public.sor_stage_visits v
  where v.opportunity_id = p_opportunity_id
    and v.undone_at is null
    and p_is_super_admin

  union

  select v.id
  from public.sor_stage_visits v
  join public.sales_opportunities o on o.id = v.opportunity_id
  where v.opportunity_id = p_opportunity_id
    and v.undone_at is null
    and not p_is_super_admin
    and (
      public.sor_is_deal_team(o, p_employee_id)
      or public.sor_always_sees(o, p_employee_id)
    )
    -- sor_is_stage_shut_out starts with "this stage has a flow_stage_access row"; skip the call when it has none.
    and (
      not exists (select 1 from public.flow_stage_access fsa where fsa.stage_id = v.flow_stage_id)
      or not public.sor_is_stage_shut_out(o, p_employee_id, v.flow_stage_id)
    )

  union

  select v.id
  from public.sor_stage_participants p
  join public.sor_stage_visits opened on opened.id = p.opened_visit_id
  join public.sor_stage_visits v on v.opportunity_id = p.opportunity_id
  where p.opportunity_id = p_opportunity_id
    and p.employee_id = p_employee_id
    and not p_is_super_admin
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
    and not p_is_super_admin
    and exists (select 1 from public.purchase_requests r where r.opportunity_id = p_opportunity_id)
    and public._purchase_request_buyer_access(p_opportunity_id, p_employee_id)

  union

  -- Mention Windows: exactly the visit each Mention was made on, open or since
  -- left (a left one is the locked view's read-only look).
  select v.id
  from public.sor_mention_viewers m
  join public.sor_stage_visits v on v.id = m.stage_visit_id
  where m.opportunity_id = p_opportunity_id
    and m.employee_id = p_employee_id
    and not p_is_super_admin
    and v.undone_at is null
    -- TIGHTEN(mention): a Restricted Stage stays shut to a Mention. Uncomment:
    -- and not exists (
    --   select 1 from public.sales_opportunities o
    --   where o.id = v.opportunity_id
    --     and public.sor_is_stage_shut_out(o, p_employee_id, v.flow_stage_id)
    -- )
$function$;

revoke all on function public._sor_access_level_as(uuid, uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public._sor_visible_visit_ids_as(uuid, uuid, boolean) from public, anon, authenticated;

-- The public rules: same names, same arguments, same answers. The caller is looked up once per call.
create or replace function public.sor_access_level(p_opportunity_id uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public._sor_access_level_as(p_opportunity_id, public.get_employee_id(), public.is_super_admin(), null)
$function$;

create or replace function public.sor_visible_visit_ids(p_opportunity_id uuid)
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select id
  from (select public.get_employee_id() as employee_id, public.is_super_admin() as is_super_admin) me
  cross join lateral public._sor_visible_visit_ids_as(p_opportunity_id, me.employee_id, me.is_super_admin) as v(id)
$function$;

-- The multi-SOR read (#1042): the caller once per query, then the same two rules per asked SOR.
create or replace function public.sor_logs_for_sors(p_opportunity_ids uuid[])
 returns setof public.sales_opportunity_logs
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as materialized (
    select
      public.get_employee_id() as employee_id,
      public.is_super_admin() as is_super_admin,
      public.costing_on_list('final_acquire') or public.costing_on_list('evaluation') as costing_lister
  ),
  asked as materialized (
    select distinct x as id from unnest(p_opportunity_ids) as x
  ),
  visible_visits as materialized (
    select v.id
    from me, asked
    cross join lateral public._sor_visible_visit_ids_as(asked.id, me.employee_id, me.is_super_admin) as v(id)
    where not coalesce(me.is_super_admin, false)
  ),
  readable_sors as materialized (
    select asked.id
    from me, asked
    where not coalesce(me.is_super_admin, false)
      and public._sor_access_level_as(asked.id, me.employee_id, me.is_super_admin, me.costing_lister)
          = any (array['full', 'participant'])
  )
  select l.*
  from public.sales_opportunity_logs l
  where l.opportunity_id = any (p_opportunity_ids)
    and (
      (select is_super_admin from me)
      or (l.stage_visit_id is not null
          and l.stage_visit_id in (select id from visible_visits))
      or (l.stage_visit_id is null
          and l.opportunity_id in (select id from readable_sors))
    )
$function$;

-- Kept for anything that still calls them (#1042); same answer, caller looked up once per query.
create or replace function public.sor_readable_visit_ids()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select vis.id
  from (select public.get_employee_id() as employee_id, public.is_super_admin() as is_super_admin) me
  cross join public.sales_opportunities o
  cross join lateral public._sor_visible_visit_ids_as(o.id, me.employee_id, me.is_super_admin) as vis(id)
$function$;

create or replace function public.sor_readable_log_sor_ids()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select o.id
  from (
    select
      public.get_employee_id() as employee_id,
      public.is_super_admin() as is_super_admin,
      public.costing_on_list('final_acquire') or public.costing_on_list('evaluation') as costing_lister
  ) me
  cross join public.sales_opportunities o
  where public._sor_access_level_as(o.id, me.employee_id, me.is_super_admin, me.costing_lister)
        = any (array['full', 'participant'])
$function$;
