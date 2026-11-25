-- Group chats of an archived or deleted SOR leave the chat list.
-- Archiving or deleting an SOR used to leave its Group Task chats in everyone's chat list. Now they are
-- hidden there while the SOR is archived or deleted, and come back on un-archive or restore.
-- Nothing on the Group Task changes: no status, member or message is touched, and the task still opens.
-- Add-only apart from re-creating get_user_active_chats with one extra filter (same columns, same order).

-- Runs as its owner so the check does not depend on whether the caller may read the SOR row
-- (a deleted SOR is hidden from most people by the read rules).
create or replace function public.sor_is_put_away(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.archived_at is not null or coalesce(o.is_deleted, false)
       from public.sales_opportunities o
      where o.id = p_opportunity_id),
    false)
$$;

comment on function public.sor_is_put_away(uuid) is
  'True when the SOR is archived (#1193) or deleted. Used to keep its Group Task chats out of the chat list.';

revoke all on function public.sor_is_put_away(uuid) from public, anon;
grant execute on function public.sor_is_put_away(uuid) to authenticated, service_role;

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
        -- Hidden while its SOR is archived or deleted.
        where ct.opportunity_id is null or not public.sor_is_put_away(ct.opportunity_id)
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
