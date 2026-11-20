-- Hotfix follow-up to 20261221100000: adding or reassigning a Group Task member failed with
-- "infinite recursion detected in policy for relation committee_task_members".
--
-- Cause: the member insert and update rules read committee_tasks, whose read rule read
-- committee_task_members again. Postgres allows that loop only while the inner rule has no sub-query.
-- The old member read rule was a plain function call, so it passed; the new one,
-- "committee_task_id in (select visible_committee_task_ids())", has a sub-query, so Postgres stopped it.
--
-- Fix: committee_tasks_read no longer reads the committee_task_members table. Its "is a member" check asks
-- my_committee_task_ids() instead, a SECURITY DEFINER function that lists the caller's own Group Tasks
-- once per query. Same answer as before (the member rows it read were always the caller's own), and
-- nothing in the committee_tasks rules touches committee_task_members any more, so the loop is gone.
-- Every other part of committee_tasks_read is copied unchanged from #1001.
--
-- SAFE TO RUN AT ANY TIME. Idempotent (function replaced, policy dropped and recreated).

create or replace function public.my_committee_task_ids()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select ctm.committee_task_id
    from public.committee_task_members ctm
   where ctm.employee_id = public.get_employee_id()
$function$;

revoke all on function public.my_committee_task_ids() from public, anon;
grant execute on function public.my_committee_task_ids() to authenticated, service_role;

drop policy if exists committee_tasks_read on public.committee_tasks;
create policy committee_tasks_read on public.committee_tasks
  for select to authenticated
  using (
    (select public.is_super_admin())
    or evaluator_id = (select public.get_employee_id())
    or id in (select public.my_committee_task_ids())
    or (
      created_by = (select public.get_employee_id())
      and (
        opportunity_id is null
        or (stage_visit_id is not null
            and stage_visit_id in (select public.sor_visible_visit_ids(committee_tasks.opportunity_id)))
        or (stage_visit_id is null
            and public.sor_access_level(opportunity_id) = any (array['full'::text, 'participant'::text]))
      )
    )
  );
