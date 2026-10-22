-- #656 (spec #646): only department heads, HR and Super Admins create and
-- manage Group Tasks. Group Tasks that a Stage Action creates on an SOR are
-- exempt, whoever moved the SOR (they carry stage_action_id).
-- Mirrored in the frontend by canManageGroupTasks() in src/utils/permissions.js.

CREATE OR REPLACE FUNCTION public.can_manage_group_tasks()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select coalesce(
    (select e.is_head or e.is_hr or e.is_super_admin
       from public.employees e
      where e.id = public.get_employee_id()),
    false
  )
$function$;

GRANT EXECUTE ON FUNCTION public.can_manage_group_tasks() TO authenticated;

-- A Stage Action Group Task: stage_action_id names a real action on a real SOR.
CREATE OR REPLACE FUNCTION public.group_task_is_stage_action(p_stage_action_id uuid, p_opportunity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select p_stage_action_id is not null
     and p_opportunity_id is not null
     and exists (select 1 from public.flow_stage_actions a where a.id = p_stage_action_id)
$function$;

GRANT EXECUTE ON FUNCTION public.group_task_is_stage_action(uuid, uuid) TO authenticated;

drop policy if exists "committee_tasks_insert" on public."committee_tasks";
create policy "committee_tasks_insert" on public."committee_tasks"
  as permissive
  for insert
  to authenticated
  with check (
    created_by = public.get_employee_id()
    and (
      public.can_manage_group_tasks()
      or public.group_task_is_stage_action(stage_action_id, opportunity_id)
    )
  );

-- Members are added by the task's creator at creation (and later by a manager).
drop policy if exists "committee_task_members_insert" on public."committee_task_members";
create policy "committee_task_members_insert" on public."committee_task_members"
  as permissive
  for insert
  to authenticated
  with check (
    public.is_super_admin()
    or exists (
      select 1 from public.committee_tasks ct
      where ct.id = committee_task_id
        and ct.created_by = public.get_employee_id()
        and (
          public.can_manage_group_tasks()
          or public.group_task_is_stage_action(ct.stage_action_id, ct.opportunity_id)
        )
    )
  );
