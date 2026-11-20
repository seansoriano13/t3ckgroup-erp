-- Hotfix: the Group Tasks list says "Group tasks could not be loaded." on production.
--
-- Cause, measured on production with EXPLAIN ANALYZE as the employee with the most Group Tasks:
--   the committee_task_members read rule called committee_task_visible(committee_task_id) once per member
--   row. Production has about 2,500 member rows, and each call costs about 2.3 ms, so the member part of the
--   list alone took about 4 s and the whole list 5-6 s for busy employees. Under normal load that crosses the
--   8 s statement timeout for authenticated users, PostgREST cancels the query (57014), and the page shows
--   the error. Staging has about a quarter of the rows, so it stayed fast there. #1001 made each call
--   cheaper but left one call per row.
--
-- Fix: the same rule, worked out once per query. visible_committee_task_ids() returns every Group Task the
-- caller may see (exactly committee_task_visible's conditions), and the member rule becomes
-- "committee_task_id in (that set)", which Postgres runs once as a hashed lookup.
-- committee_task_visible() stays for its other callers.
--
-- SAFE TO RUN AT ANY TIME. Idempotent (function replaced, policy dropped and recreated).

create or replace function public.visible_committee_task_ids()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select public.get_employee_id() as id, coalesce(public.is_super_admin(), false) as super_admin
  )
  select ct.id
    from public.committee_tasks ct, me
   where me.super_admin
      or ct.created_by = me.id
      or ct.evaluator_id = me.id
      or exists (
        select 1 from public.committee_task_members ctm
         where ctm.committee_task_id = ct.id
           and ctm.employee_id = me.id
      )
      or (
        ct.status = 'ON_HOLD'
        and exists (
          select 1
            from public.employees h
            join public.employees c on c.id = ct.created_by
           where h.id = me.id
             and h.is_head
             and not coalesce(h.is_deleted, false)
             and h.department is not null
             and h.department = c.department
        )
      )
$function$;

revoke all on function public.visible_committee_task_ids() from public, anon;
grant execute on function public.visible_committee_task_ids() to authenticated, service_role;

drop policy if exists committee_task_members_read on public.committee_task_members;
create policy committee_task_members_read on public.committee_task_members
  for select to authenticated
  using (committee_task_id in (select public.visible_committee_task_ids()));
