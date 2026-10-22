-- #656 review: the baseline "Allow update for authenticated users" policy let any signed-in
-- person edit any Group Task member row (status, grade, checklist). Limit UPDATE to the member's
-- own row, a Group Task manager (head / HR / Super Admin), or the task's creator (who rates and
-- manages the members of a Stage Action Group Task they made).

drop policy if exists "Allow update for authenticated users" on public."committee_task_members";
drop policy if exists "committee_task_members_update" on public."committee_task_members";
create policy "committee_task_members_update" on public."committee_task_members"
  as permissive
  for update
  to authenticated
  using (
    employee_id = public.get_employee_id()
    or public.can_manage_group_tasks()
    or exists (select 1 from public.committee_tasks ct
               where ct.id = committee_task_id and ct.created_by = public.get_employee_id())
  )
  with check (
    employee_id = public.get_employee_id()
    or public.can_manage_group_tasks()
    or exists (select 1 from public.committee_tasks ct
               where ct.id = committee_task_id and ct.created_by = public.get_employee_id())
  );
