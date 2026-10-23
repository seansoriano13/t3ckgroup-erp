-- allow-out-of-order: prod ships this before staging's 20261006+ migrations; none of them redefine committee_task_visible or committee_tasks_read.
-- A Group Task's evaluator reads it the way a member does.
--
-- 20261005125100 let the evaluator read the task through the SOR visibility
-- gate, the same way its creator does. That left two gaps for an evaluator who
-- is not a member:
--   * committee_task_members_read goes through committee_task_visible(), which
--     knew only the creator, Super Admins and members, so the evaluator saw the
--     task with no members to rate.
--   * Like a member, the evaluator is named on the task, and being named is
--     itself the grant (20261001100000): no Stage window has to be open.

create or replace function public.committee_task_visible(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.committee_tasks ct
    where ct.id = p_task_id
      and (
        ct.created_by = public.get_employee_id()
        or ct.evaluator_id = public.get_employee_id()
        or public.is_super_admin()
        or exists (
          select 1 from public.committee_task_members ctm
          where ctm.committee_task_id = ct.id
            and ctm.employee_id = public.get_employee_id()
        )
      )
  )
$$;

drop policy if exists "committee_tasks_read" on public.committee_tasks;
create policy "committee_tasks_read" on public.committee_tasks
  as permissive
  for select
  to authenticated
  using (
    public.is_super_admin()
    or evaluator_id = public.get_employee_id()
    or exists (
      select 1 from public.committee_task_members ctm
      where ctm.committee_task_id = committee_tasks.id
        and ctm.employee_id = public.get_employee_id()
    )
    or (
      created_by = public.get_employee_id()
      and (
        opportunity_id is null
        or (
          stage_visit_id is not null
          and stage_visit_id in (select public.sor_visible_visit_ids(committee_tasks.opportunity_id))
        )
        or (
          stage_visit_id is null
          and public.sor_access_level(committee_tasks.opportunity_id) in ('full', 'participant')
        )
      )
    )
  );
