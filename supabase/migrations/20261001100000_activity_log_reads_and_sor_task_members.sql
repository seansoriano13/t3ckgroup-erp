-- Activity Log SOR/System/HR tabs empty on prod, and a Group Task member under
-- an SOR unable to open the task they were added to.
--
-- 1. system_audit_logs: prod's `Allow all read` / `hr_read_system_audit_logs`
--    were dropped by 20260930060000, leaving only a super-admin policy keyed on
--    `employees.id = auth.uid()`. Every other policy resolves identity by the
--    token's email (get_employee_id/is_super_admin/is_hr), and employee ids do
--    not always equal auth uids, so that policy denied real super admins too.
--    Re-state it on the email-based helpers and give HR read access to the HR
--    entity types back.
-- 2. committee_tasks_read: the SOR visibility gate also hid the task from its
--    own members. Being added as a member is itself the grant to read the task.

drop policy if exists "super_admin_all_system_audit_logs" on public.system_audit_logs;
create policy "super_admin_all_system_audit_logs" on public.system_audit_logs
  as permissive
  for all
  to authenticated
  using (coalesce(public.is_super_admin(), false))
  with check (coalesce(public.is_super_admin(), false));

drop policy if exists "hr_read_system_audit_logs" on public.system_audit_logs;
create policy "hr_read_system_audit_logs" on public.system_audit_logs
  as permissive
  for select
  to authenticated
  using (
    coalesce(public.is_hr(), false)
    and entity_type in ('EMPLOYEE','CATEGORY','OVERTIME','OFFSET_LEAVE','SIL_LEAVE','HR_SETTINGS')
  );

drop policy if exists "committee_tasks_read" on public.committee_tasks;
create policy "committee_tasks_read" on public.committee_tasks
  as permissive
  for select
  to authenticated
  using (
    public.is_super_admin()
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
