-- #656 follow-up: non-managers (not head / HR / Super Admin) can't edit a Group
-- Task's details, cancel it by hand, or delete a task or its members.
-- Stage Action Group Tasks and the workflow's status changes stay allowed.
-- Uses public.can_manage_group_tasks() from 20261102110000.

CREATE OR REPLACE FUNCTION public.committee_tasks_guard_manage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  -- No end-user session (service role, migrations): not our concern.
  if auth.uid() is null then
    return new;
  end if;

  if public.can_manage_group_tasks()
     or public.group_task_is_stage_action(new.stage_action_id, new.opportunity_id) then
    return new;
  end if;

  if new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.due_date is distinct from old.due_date
     or new.start_date is distinct from old.start_date
     or new.lead_time is distinct from old.lead_time
     or new.committee_role is distinct from old.committee_role
     or new.template_id is distinct from old.template_id
     or new.opportunity_id is distinct from old.opportunity_id
     or new.created_by is distinct from old.created_by then
    raise exception 'Only department heads, HR and Super Admins can edit Group Task details'
      using errcode = '42501';
  end if;

  -- A manual cancel only sets status. System cancels (stage revert / hold
  -- flows) also write cancel_reason, so they pass.
  if new.status = 'CANCELLED' and old.status is distinct from 'CANCELLED'
     and new.cancel_reason is not distinct from old.cancel_reason then
    raise exception 'Only department heads, HR and Super Admins can cancel a Group Task'
      using errcode = '42501';
  end if;

  return new;
end
$function$;

drop trigger if exists trg_committee_tasks_guard_manage on public.committee_tasks;
create trigger trg_committee_tasks_guard_manage
  before update on public.committee_tasks
  for each row execute function public.committee_tasks_guard_manage();

-- DELETE: managers only. (committee_tasks had no delete policy before.)
drop policy if exists "committee_tasks_delete" on public."committee_tasks";
create policy "committee_tasks_delete" on public."committee_tasks"
  as permissive
  for delete
  to authenticated
  using (public.can_manage_group_tasks());

drop policy if exists "committee_task_members_delete" on public."committee_task_members";
create policy "committee_task_members_delete" on public."committee_task_members"
  as permissive
  for delete
  to authenticated
  using (public.can_manage_group_tasks());
