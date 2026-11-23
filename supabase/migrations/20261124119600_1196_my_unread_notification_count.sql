-- #1196 (spec #1187): the bell's number comes from the server.
-- Counts the caller's unread notifications with the drawer's rules: a chat's
-- messages (same record type + record id) are one row, unread when any is unread.

create or replace function public.my_unread_notification_count()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  with mine as (
    select n.type, n.reference_id, n.is_read,
      case
        when n.reference_id is null then null
        when n.type in ('GROUP_TASK_COMMENT', 'GROUP_TASK_REACTION', 'GROUP_TASK_MENTION', 'COMMITTEE_TASK_COMMENT')
          then 'GROUP_TASK:' || n.reference_id::text
        when n.type = 'TASK_MENTION' then 'TASK:' || n.reference_id::text
        else null
      end as chat_key
    from public.notifications n
    where n.recipient_id = public.get_employee_id()
  )
  select (
    (select count(*) from mine where chat_key is null and not coalesce(is_read, false))
    + (select count(distinct chat_key) from mine where chat_key is not null and not coalesce(is_read, false))
  )::integer;
$$;

grant execute on function public.my_unread_notification_count() to authenticated;
