-- #1001 (spec #1000, tracker A1): the chat list and the Group Task list time out for staff.
--
-- Cause, found on the local stack with EXPLAIN ANALYZE as dani@local:
--   * committee_tasks_read and committee_tasks_read_on_hold called get_employee_id() and is_super_admin() bare,
--     so Postgres ran them (and the SOR checks) once per row instead of once per query.
--   * the member check reads committee_task_members, whose own rule runs committee_task_visible() per member
--     row, and every call looks the caller up again. A plain "select * from committee_tasks" ran past 20s.
--   * get_user_active_chats grouped the whole of committee_task_activity to find each task's latest message,
--     and looked up the latest task_activity comment with no index to serve it.
--
-- The rules keep their exact meaning. Only the shape changes: the caller lookups sit in (select ...) so they
-- run once, and the cheap checks (super admin, evaluator, member) come before the SOR checks.
-- committee_task_activity's read rule is left alone on purpose: that is #1002.
--
-- SAFE TO RUN AT ANY TIME. Idempotent (policies are dropped and recreated, indexes are IF NOT EXISTS).

-- 0. committee_task_visible ------------------------------------------------------------------------------
-- The committee_task_members read rule calls this once per member row, and it looked the caller up again
-- for every member row it scanned (about 100 ms a call on local data, so the list never finished).
-- Same rule, same answer; the caller lookups now run once per call.

create or replace function public.committee_task_visible(p_task_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.committee_tasks ct
    where ct.id = p_task_id
      and (
        ct.created_by = (select public.get_employee_id())
        or ct.evaluator_id = (select public.get_employee_id())
        or (select public.is_super_admin())
        or exists (
          select 1 from public.committee_task_members ctm
          where ctm.committee_task_id = ct.id
            and ctm.employee_id = (select public.get_employee_id())
        )
        or (
          ct.status = 'ON_HOLD'
          and exists (
            select 1
              from public.employees h
              join public.employees c on c.id = ct.created_by
             where h.id = (select public.get_employee_id())
               and h.is_head
               and not coalesce(h.is_deleted, false)
               and h.department is not null
               and h.department = c.department
          )
        )
      )
  )
$function$;

-- 1. committee_tasks read rules --------------------------------------------------------------------------

drop policy if exists committee_tasks_read on public.committee_tasks;
create policy committee_tasks_read on public.committee_tasks
  for select to authenticated
  using (
    (select public.is_super_admin())
    or evaluator_id = (select public.get_employee_id())
    or exists (
      select 1 from public.committee_task_members ctm
      where ctm.committee_task_id = committee_tasks.id
        and ctm.employee_id = (select public.get_employee_id())
    )
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

drop policy if exists committee_tasks_read_on_hold on public.committee_tasks;
create policy committee_tasks_read_on_hold on public.committee_tasks
  for select to authenticated
  using (
    status = 'ON_HOLD'
    and (
      created_by = (select public.get_employee_id())
      or exists (
        select 1
          from public.employees h
          join public.employees c on c.id = committee_tasks.created_by
         where h.id = (select public.get_employee_id())
           and h.is_head
           and not coalesce(h.is_deleted, false)
           and h.department is not null
           and h.department = c.department
      )
    )
  );

-- 2. indexes ---------------------------------------------------------------------------------------------

create index if not exists committee_task_activity_task_created_idx
  on public.committee_task_activity (task_id, created_at desc);
create index if not exists task_activity_task_type_created_idx
  on public.task_activity (task_id, type, created_at desc);
create index if not exists task_activity_author_idx
  on public.task_activity (author_id);

-- 3. get_user_active_chats -------------------------------------------------------------------------------
-- Same columns, same order, same SECURITY INVOKER. Each half first picks the person's own tasks, then reads
-- the latest message for those only (a lateral lookup on the new indexes, no GROUP BY over the whole table).

create or replace function public.get_user_active_chats(p_user_id uuid, p_limit integer default 30)
 returns table(entity_id text, entity_type text, title text, subtitle text, status text, latest_message text,
               latest_author text, latest_created_at timestamp with time zone, last_read_at timestamp with time zone,
               is_unread boolean, is_deleted boolean, is_archived boolean)
 language plpgsql
as $function$
begin
    return query
    with my_tasks as (
        select t.id from public.tasks t
        where t.logged_by = p_user_id or t.reported_to = p_user_id
        union
        select ta.task_id from public.task_activity ta where ta.author_id = p_user_id
    ),
    task_chats as (
        select
            t.id::text as entity_id,
            'TASK'::text as entity_type,
            coalesce(t.project_title, left(t.task_description, 40)) as title,
            (select emp.name from public.employees emp where emp.id = t.logged_by) as subtitle,
            t.status as status,
            ta.content as latest_message,
            (select emp.name from public.employees emp where emp.id = ta.author_id) as latest_author,
            ta.created_at as latest_created_at,
            (t.status = 'DELETED') as is_deleted
        from my_tasks m
        join public.tasks t on t.id = m.id
        cross join lateral (
            select x.content, x.author_id, x.created_at
            from public.task_activity x
            where x.task_id = t.id and x.type = 'COMMENT'
            order by x.created_at desc
            limit 1
        ) ta
    ),
    my_committee_tasks as (
        select ct.id from public.committee_tasks ct where ct.created_by = p_user_id
        union
        select ctm.committee_task_id from public.committee_task_members ctm where ctm.employee_id = p_user_id
    ),
    committee_chats as (
        select
            ct.id::text as entity_id,
            'COMMITTEE_TASK'::text as entity_type,
            ct.title as title,
            'Committee Task'::text as subtitle,
            ct.status as status,
            cta.content as latest_message,
            coalesce(e.name, 'System') as latest_author,
            cta.created_at as latest_created_at,
            false as is_deleted
        from my_committee_tasks m
        join public.committee_tasks ct on ct.id = m.id
        cross join lateral (
            select x.content, x.author_id, x.created_at
            from public.committee_task_activity x
            where x.task_id = ct.id
            order by x.created_at desc
            limit 1
        ) cta
        left join public.employees e on e.id = cta.author_id
    ),
    combined_chats as (
        select * from task_chats
        union all
        select * from committee_chats
    )
    select
        c.entity_id,
        c.entity_type,
        c.title,
        c.subtitle,
        c.status,
        c.latest_message,
        c.latest_author,
        c.latest_created_at,
        r.last_read_at,
        (r.last_read_at is null or c.latest_created_at > r.last_read_at) as is_unread,
        c.is_deleted,
        (a.archived_at is not null) as is_archived
    from combined_chats c
    left join public.chat_read_receipts r
        on c.entity_id = r.entity_id
        and c.entity_type = r.entity_type
        and r.user_id = p_user_id
    left join public.chat_user_archives a
        on c.entity_id = a.entity_id
        and c.entity_type = a.entity_type
        and a.user_id = p_user_id
    order by c.latest_created_at desc
    limit p_limit;
end;
$function$;
