-- #1097 (spec #1093, tracker A3): task activity follows reading the task.
--
-- task_activity had "Enable read access for all users" using (true)
-- (20260908101315, set open on purpose to match production). Any employee could read every task's comments,
-- HR notes and events, including tasks they cannot open. Same shape as committee_task_activity in #1002.
--
-- New read rule: a row is readable when
--   * the caller is a Super Admin (reads all; Task Logs tab), or
--   * the caller wrote the row (own replies stay readable), or
--   * the caller can read the parent task (tasks RLS applies inside the subquery, so the opportunity-linked
--     gate of 20260926000000 carries over) AND is on the task: logger, reporter, HR, or a head.
-- An employee with no part in a task gets no rows. Insert and update rules are not touched.
--
-- Cost: the Super Admin check and the author check are wrapped in (select ...) so they run once per query,
-- not once per row. Other callers do one primary-key lookup on tasks per row.
--
-- SAFE TO RUN AT ANY TIME. Idempotent.

drop policy if exists "Enable read access for all users" on public.task_activity;
drop policy if exists "Task activity follows the task read rule" on public.task_activity;

create policy "Task activity follows the task read rule" on public.task_activity
  as permissive
  for select
  to public
  using (
    (select public.is_super_admin())
    or author_id = (select public.get_employee_id())
    or exists (
      select 1 from public.tasks t
      where t.id = task_activity.task_id
        and (
          t.logged_by = (select public.get_employee_id())
          or t.reported_to = (select public.get_employee_id())
          or (select public.is_hr())
          or (select public.is_head())
        )
    )
  );
