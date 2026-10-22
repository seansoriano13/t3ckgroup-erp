-- Issue #657 (spec #646) -- convert a task into a Group Task.
--
-- The task BECOMES the Group Task: title, description, attachments, checklist and the chat/activity
-- history carry over, the owner is the first member, the caller picks more. The old task row stays
-- (hidden, status DELETED) with converted_to_group_task_id pointing at the new Group Task, so old
-- links resolve; notifications that pointed at it are repointed.
--
-- One security-definer RPC does it all and refuses anyone who may not manage Group Tasks (#656),
-- Stage Action tasks, and tasks that are submitted, approved or cancelled.

alter table public.tasks
  add column if not exists converted_to_group_task_id uuid references public.committee_tasks (id) on delete set null;

create or replace function public.convert_task_to_group_task(p_task_id uuid, p_member_ids uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.get_employee_id();
  v_task public.tasks%rowtype;
  v_group_id uuid;
  v_title text;
  v_owner_dept text;
  v_my_dept text;
  v_member uuid;
begin
  if v_me is null or not public.can_manage_group_tasks() then
    raise exception 'Only department heads, HR and Super Admins can convert a task into a Group Task.'
      using errcode = '42501';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;

  if v_task.converted_to_group_task_id is not null then
    raise exception 'This task was already converted into a Group Task.' using errcode = '22023';
  end if;
  if v_task.stage_action_id is not null then
    raise exception 'A task made by an SOR Stage Action can''t be converted.' using errcode = '22023';
  end if;
  if v_task.status in ('AWAITING APPROVAL', 'COMPLETED', 'DELETED', 'CANCELLED', 'ON_HOLD')
     or coalesce(v_task.hr_verified, false) then
    raise exception 'Only an open task can be converted; this one is submitted, approved, cancelled or on hold.'
      using errcode = '22023';
  end if;

  -- Reach: Super Admins and HR convert any task; a head only tasks they own, receive or that
  -- belong to their department.
  if not (public.is_super_admin() or exists (select 1 from public.employees where id = v_me and is_hr)) then
    select department into v_my_dept from public.employees where id = v_me;
    select department into v_owner_dept from public.employees where id = v_task.logged_by;
    if v_task.logged_by is distinct from v_me
       and v_task.reported_to is distinct from v_me
       and v_my_dept is distinct from v_owner_dept then
      raise exception 'You can only convert tasks you own, receive or that are in your department.'
        using errcode = '42501';
    end if;
  end if;

  v_title := coalesce(nullif(btrim(v_task.project_title), ''), left(btrim(coalesce(v_task.task_description, '')), 80));
  if v_title = '' then v_title := 'Converted task'; end if;

  insert into public.committee_tasks (title, description, created_by, due_date, status, opportunity_id)
  values (v_title, v_task.task_description, v_me, v_task.end_at, 'ACTIVE', v_task.opportunity_id)
  returning id into v_group_id;

  -- Owner first (carries the checklist and attachments), then the chosen members.
  if v_task.logged_by is not null then
    insert into public.committee_task_members (committee_task_id, employee_id, task_description, checklist, attachments)
    values (v_group_id, v_task.logged_by, coalesce(v_task.task_description, ''), v_task.checklist,
            to_jsonb(coalesce(v_task.attachment_urls, '{}'::text[])));
  end if;
  foreach v_member in array coalesce(p_member_ids, '{}') loop
    if v_member is distinct from v_task.logged_by
       and not exists (select 1 from public.committee_task_members
                        where committee_task_id = v_group_id and employee_id = v_member) then
      insert into public.committee_task_members (committee_task_id, employee_id, task_description)
      values (v_group_id, v_member, '');
    end if;
  end loop;

  -- Chat/activity history: same ids, so replies and reactions that name a message still resolve.
  insert into public.committee_task_activity (id, task_id, author_id, type, content, metadata, created_at)
  select a.id, v_group_id, a.author_id, a.type, a.content, a.metadata, a.created_at
  from public.task_activity a
  where a.task_id = p_task_id;

  -- Unread state follows the thread.
  insert into public.chat_read_receipts (user_id, entity_type, entity_id, last_read_at)
  select r.user_id, 'GROUP_TASK', v_group_id::text, r.last_read_at
  from public.chat_read_receipts r
  where r.entity_type = 'TASK' and r.entity_id = p_task_id::text
  on conflict do nothing;

  -- The old task steps aside; old links read converted_to_group_task_id.
  update public.tasks
  set status = 'DELETED', converted_to_group_task_id = v_group_id
  where id = p_task_id;

  -- Notifications that pointed at the old task now lead to the Group Task.
  update public.notifications n
  set reference_id = v_group_id::text,
      type = case n.type
        when 'TASK_MENTION' then 'GROUP_TASK_MENTION'
        when 'TASK_REACTION' then 'GROUP_TASK_REACTION'
        when 'TASK_COMMENT' then 'GROUP_TASK_COMMENT'
        else 'GROUP_ASSIGNED'
      end
  where n.reference_id = p_task_id::text
    and n.type like '%TASK%'
    and n.type not like 'GROUP\_%';

  insert into public.committee_task_logs (committee_task_id, action, actor_id, details)
  values (v_group_id, 'CREATED', v_me, jsonb_build_object('title', v_title, 'converted_from_task_id', p_task_id));

  insert into public.system_audit_logs (author_id, entity_type, entity_id, content, type, metadata)
  values (v_me, 'GROUP_TASK', v_group_id::text,
          'Converted task into Group Task "' || v_title || '"', 'TASK_CONVERTED',
          jsonb_build_object('task_id', p_task_id, 'group_task_id', v_group_id,
                             'owner_id', v_task.logged_by, 'member_ids', to_jsonb(coalesce(p_member_ids, '{}'))));

  -- Tell the people added (not the caller).
  insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
  select m.employee_id, v_me, 'GROUP_ASSIGNED', 'Added to a Group Task',
         'You were added to the Group Task "' || v_title || '".', v_group_id::text
  from public.committee_task_members m
  where m.committee_task_id = v_group_id and m.employee_id <> v_me;

  return v_group_id;
end;
$$;

revoke all on function public.convert_task_to_group_task(uuid, uuid[]) from public, anon;
grant execute on function public.convert_task_to_group_task(uuid, uuid[]) to authenticated;
