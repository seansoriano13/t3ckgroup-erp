-- #1042 (spec #1031, tracker S1): reading sales_opportunity_logs for several SORs times out for Sales.
--
-- Cause: sor_log_read called is_super_admin(), sor_visible_visit_ids(opportunity_id) and
-- sor_access_level(opportunity_id) for every row (2,473 rows), and each call looks the caller up again.
--
-- Fix, same family as #1001: work out what the caller may read once per query, not once per row.
--   * sor_readable_visit_ids()  - every Stage Visit the caller may read, from sor_visible_visit_ids per SOR.
--   * sor_readable_log_sor_ids() - every SOR on which the caller has 'full' or 'participant' access.
-- Both take no argument tied to the row, so the policy turns them into one hashed sub-plan per query.
-- Both are built on the existing rule functions, so ADR 0021 (stage-scoped visibility, Restricted Stage
-- shut-out) is decided by exactly the same code as before. Same answer, different shape.
--
-- SAFE TO RUN AT ANY TIME. Idempotent.

create or replace function public.sor_readable_visit_ids()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select vis.id
  from public.sales_opportunities o
  cross join lateral public.sor_visible_visit_ids(o.id) as vis(id)
$function$;

create or replace function public.sor_readable_log_sor_ids()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select o.id
  from public.sales_opportunities o
  where public.sor_access_level(o.id) = any (array['full', 'participant'])
$function$;

revoke all on function public.sor_readable_visit_ids() from public, anon;
revoke all on function public.sor_readable_log_sor_ids() from public, anon;
grant execute on function public.sor_readable_visit_ids() to authenticated, service_role;
grant execute on function public.sor_readable_log_sor_ids() to authenticated, service_role;

drop policy if exists sor_log_read on public.sales_opportunity_logs;
create policy sor_log_read on public.sales_opportunity_logs
  for select to authenticated
  using (
    (select public.is_super_admin())
    or (stage_visit_id is not null
        and stage_visit_id in (select public.sor_readable_visit_ids()))
    or (stage_visit_id is null
        and opportunity_id in (select public.sor_readable_log_sor_ids()))
  );

-- The multi-SOR read. Even once per query, the two functions above work out the answer for every SOR the
-- caller can see (about 25 ms an SOR), which is too slow when a screen asks for 15. This function takes
-- the asked SOR ids first and applies the same rule to those only. Same rule, same answer as sor_log_read,
-- so a Restricted Stage still shuts the person out of its log rows (ADR 0021).
create or replace function public.sor_logs_for_sors(p_opportunity_ids uuid[])
 returns setof public.sales_opportunity_logs
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select l.*
  from public.sales_opportunity_logs l
  where l.opportunity_id = any (p_opportunity_ids)
    and (
      (select public.is_super_admin())
      or (l.stage_visit_id is not null
          and l.stage_visit_id in (
            select public.sor_visible_visit_ids(x) from unnest(p_opportunity_ids) as x))
      or (l.stage_visit_id is null
          and l.opportunity_id in (
            select x from unnest(p_opportunity_ids) as x
            where public.sor_access_level(x) = any (array['full', 'participant'])))
    )
$function$;

revoke all on function public.sor_logs_for_sors(uuid[]) from public, anon;
grant execute on function public.sor_logs_for_sors(uuid[]) to authenticated, service_role;
