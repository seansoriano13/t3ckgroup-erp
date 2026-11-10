-- Issue #652 (spec #646) -- cancelling a Stage Action task closes its access windows.
--
-- A window does not store which task opened it, but it does store what the task also stores:
-- the Stage Action (window.source_id = task.stage_action_id), the Stage Visit
-- (window.opened_visit_id = task.stage_visit_id), the SOR and the person. That is the link; no new
-- column. Personal tasks close the assignee's window (tasks.logged_by); Group Tasks close every
-- member's.
--
-- A trigger on the status change does the close, so no caller can forget it. The close function is
-- not callable by clients; the only way to reach it is a status update the tasks / committee_tasks
-- update policies already allowed, so the database refuses the close for anyone who could not
-- cancel the task.

create or replace function public.close_windows_for_cancelled_stage_task(
  p_opportunity_id uuid,
  p_action_id uuid,
  p_visit_id uuid,
  p_employee_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_opportunity_id is null or p_action_id is null or p_visit_id is null then
    return;
  end if;
  update public.sor_stage_participants
  set closed_at = now(), closed_reason = 'task_cancelled'
  where closed_at is null
    and source = 'action'
    and opportunity_id = p_opportunity_id
    and source_id = p_action_id
    and opened_visit_id = p_visit_id
    and employee_id = any (p_employee_ids)
    -- keep a window another live task from the same call-in still holds open
    and not exists (select 1 from public.tasks t2
      where t2.status <> 'DELETED' and t2.opportunity_id = p_opportunity_id
        and t2.stage_action_id = p_action_id and t2.stage_visit_id = p_visit_id
        and t2.logged_by = sor_stage_participants.employee_id)
    and not exists (select 1 from public.committee_tasks c2
      join public.committee_task_members m2 on m2.committee_task_id = c2.id
      where c2.status <> 'CANCELLED' and c2.opportunity_id = p_opportunity_id
        and c2.stage_action_id = p_action_id and c2.stage_visit_id = p_visit_id
        and m2.employee_id = sor_stage_participants.employee_id);
end;
$$;

revoke all on function public.close_windows_for_cancelled_stage_task(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;

create or replace function public.tasks_cancel_closes_windows() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'DELETED' and old.status is distinct from 'DELETED' then
    perform public.close_windows_for_cancelled_stage_task(
      new.opportunity_id, new.stage_action_id, new.stage_visit_id, array[new.logged_by]);
  end if;
  return new;
end;
$$;

create or replace function public.committee_tasks_cancel_closes_windows() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'CANCELLED' and old.status is distinct from 'CANCELLED' then
    perform public.close_windows_for_cancelled_stage_task(
      new.opportunity_id, new.stage_action_id, new.stage_visit_id,
      (select coalesce(array_agg(m.employee_id), '{}') from public.committee_task_members m
        where m.committee_task_id = new.id));
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_cancel_closes_windows on public.tasks;
create trigger tasks_cancel_closes_windows
  after update of status on public.tasks
  for each row execute function public.tasks_cancel_closes_windows();

drop trigger if exists committee_tasks_cancel_closes_windows on public.committee_tasks;
create trigger committee_tasks_cancel_closes_windows
  after update of status on public.committee_tasks
  for each row execute function public.committee_tasks_cancel_closes_windows();

-- Backfill: windows still open although their task is already cancelled.
update public.sor_stage_participants p
set closed_at = now(), closed_reason = 'task_cancelled'
where p.closed_at is null and p.source = 'action'
  and (
    exists (select 1 from public.tasks t
      where t.status = 'DELETED' and t.opportunity_id = p.opportunity_id
        and t.stage_action_id = p.source_id and t.stage_visit_id = p.opened_visit_id
        and t.logged_by = p.employee_id)
    or exists (select 1 from public.committee_tasks c
      join public.committee_task_members m on m.committee_task_id = c.id
      where c.status = 'CANCELLED' and c.opportunity_id = p.opportunity_id
        and c.stage_action_id = p.source_id and c.stage_visit_id = p.opened_visit_id
        and m.employee_id = p.employee_id)
  )
  -- keep a window another live task from the same call-in still holds open
  and not exists (select 1 from public.tasks t2
      where t2.status <> 'DELETED' and t2.opportunity_id = p.opportunity_id
        and t2.stage_action_id = p.source_id and t2.stage_visit_id = p.opened_visit_id
        and t2.logged_by = p.employee_id)
  and not exists (select 1 from public.committee_tasks c2
      join public.committee_task_members m2 on m2.committee_task_id = c2.id
      where c2.status <> 'CANCELLED' and c2.opportunity_id = p.opportunity_id
        and c2.stage_action_id = p.source_id and c2.stage_visit_id = p.opened_visit_id
        and m2.employee_id = p.employee_id);
