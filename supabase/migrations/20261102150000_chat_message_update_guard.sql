-- #658 review: the UPDATE policies on task_activity / committee_task_activity are USING(true)
-- WITH CHECK(true), so any signed-in person could rewrite or "unsend" anyone's chat message.
--
-- Where things live: reactions are metadata.reactions on the COMMENT row, written only by the
-- SECURITY DEFINER rpc toggle_chat_reaction; an unsend is the SECURITY DEFINER rpc
-- unsend_chat_message, which replaces metadata with {removed, removedAt} (so reactions go with
-- it). The app's only direct UPDATE is the activity-log upsert on non-COMMENT rows.
--
-- So: a direct client write may not touch a COMMENT row at all, and nothing may change a message
-- once it is removed (a late reaction can't bring metadata back). RPCs run as the function owner,
-- so current_user tells them apart from a client (this trigger is SECURITY INVOKER).

create or replace function public.chat_message_update_guard() returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if coalesce(old.metadata ->> 'removed', 'false') = 'true' then
    if new.content is distinct from old.content or new.metadata is distinct from old.metadata then
      raise exception 'This message was removed' using errcode = '42501';
    end if;
    return new;
  end if;

  if current_user in ('authenticated', 'anon') and (old.type = 'COMMENT' or new.type = 'COMMENT') then
    raise exception 'Chat messages can only be changed through reactions or unsend' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_activity_update_guard on public.task_activity;
create trigger trg_task_activity_update_guard before update on public.task_activity
  for each row execute function public.chat_message_update_guard();

drop trigger if exists trg_committee_task_activity_update_guard on public.committee_task_activity;
create trigger trg_committee_task_activity_update_guard before update on public.committee_task_activity
  for each row execute function public.chat_message_update_guard();

-- One unsend body for both tables; the table name comes from an allow-list.
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
  if v_author is distinct from auth.uid() then
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
