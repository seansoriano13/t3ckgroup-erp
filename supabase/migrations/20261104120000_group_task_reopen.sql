-- Group Tasks: reopen a task that is ON_HOLD.
--
-- A Stage Action's group task goes ON_HOLD when its SOR leaves the Stage. When
-- the flow canvas changes so the task should run on into a later Stage, the SOR
-- that already moved on does not reopen it. The creator, a Super Admin or a Head
-- of the creator's department reopens it by hand instead.
--
-- Same as a Resume: the task returns to the status it held before, and its due
-- date moves out by the time it was held. It stays linked to the Stage visit it
-- came from, so it is not held again by a later move.

create or replace function public.group_task_reopen(p_group_task_id uuid)
returns public.committee_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_task public.committee_tasks;
  v_allowed boolean;
  v_status text;
  v_held_for interval;
begin
  select * into v_task from public.committee_tasks where id = p_group_task_id for update;
  if v_task.id is null then
    raise exception 'Reopen: that group task could not be found.' using errcode = 'P0002';
  end if;

  if v_task.status is distinct from 'ON_HOLD' then
    raise exception 'Reopen: only a group task on hold can be reopened.' using errcode = 'P0001';
  end if;

  v_allowed := public.is_super_admin()
    or (v_actor is not null and v_task.created_by = v_actor)
    or (
      v_actor is not null
      and exists (
        select 1
          from public.employees h
          join public.employees c on c.id = v_task.created_by
         where h.id = v_actor
           and h.is_head
           and not coalesce(h.is_deleted, false)
           and h.department is not null
           and h.department = c.department
      )
    );
  if not v_allowed then
    raise exception 'Reopen: only the creator, a Super Admin or a Head of the creator''s department can reopen this group task.'
      using errcode = '42501';
  end if;

  v_status := coalesce(v_task.held_prev_status, 'ACTIVE');
  v_held_for := case when v_task.held_at is null then interval '0' else now() - v_task.held_at end;

  update public.committee_tasks
     set status = v_status,
         due_date = case when due_date is null then null else due_date + v_held_for end,
         held_at = null,
         held_from_visit_id = null,
         held_prev_status = null
   where id = p_group_task_id
   returning * into v_task;

  insert into public.committee_task_logs (committee_task_id, action, details, actor_id)
  values (p_group_task_id, 'REOPENED', jsonb_build_object('status', v_status), v_actor);

  insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
  select distinct m.employee_id, v_actor, 'GROUP_TASK_REOPENED',
         'Group task reopened',
         format('"%s" was on hold and is open again.', v_task.title),
         p_group_task_id::text
    from public.committee_task_members m
   where m.committee_task_id = p_group_task_id
     and m.employee_id is distinct from v_actor;

  return v_task;
end;
$$;

revoke all on function public.group_task_reopen(uuid) from public, anon;
grant execute on function public.group_task_reopen(uuid) to authenticated;
