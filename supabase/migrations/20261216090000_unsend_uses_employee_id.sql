-- Unsend failed with "You can only unsend your own messages" for the real sender.
-- A message's author_id is the employee id, and an employee id is not always the sign-in id
-- (get_employee_id() matches the two by email). unsend_chat_message compared author_id with
-- auth.uid(), so it only worked for people whose two ids happen to match.
-- Same function as before, but it compares with get_employee_id().

create or replace function public.unsend_chat_message(p_table text, p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_author uuid;
  v_created timestamptz;
  v_removed jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_table not in ('task_activity', 'committee_task_activity') then
    raise exception 'Invalid table %', p_table;
  end if;

  execute format('select author_id, created_at from public.%I where id = $1 and type = ''COMMENT''', p_table)
    into v_author, v_created using p_message_id;

  if v_created is null then
    raise exception 'Message not found';
  end if;
  if v_author is distinct from public.get_employee_id() then
    raise exception 'You can only unsend your own messages';
  end if;
  if now() - v_created > interval '15 minutes' then
    raise exception 'Messages can only be unsent within 15 minutes';
  end if;

  v_removed := jsonb_build_object('removed', true, 'removedAt', now());

  execute format('update public.%I set content = ''Message removed'', metadata = $2 where id = $1', p_table)
    using p_message_id, v_removed;

  execute format($q$update public.%I
    set metadata = jsonb_set(metadata, '{replyTo}',
      (metadata->'replyTo') || '{"content":"Message removed","removed":true}'::jsonb)
    where metadata->'replyTo'->>'id' = $1::text$q$, p_table)
    using p_message_id;

  return v_removed;
end;
$function$;

revoke all on function public.unsend_chat_message(text, uuid) from public;
grant execute on function public.unsend_chat_message(text, uuid) to authenticated;
