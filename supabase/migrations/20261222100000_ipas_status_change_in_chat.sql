-- ==============================================================================
-- 20261222100000_ipas_status_change_in_chat.sql
--
-- The IPAS Status becomes one dropdown on the record (ADR 0054, amended
-- 2026-11-22): no step list, no day asked. Every change of the status is
-- posted in the IPAS's own Chat instead, so the thread is the status's audit.
--
-- WHAT POSTS
--   One trigger after any update of public.ipas whose status changes, however
--   it changed: the dropdown (ipas_set_status), Filing (Done), Reopen, a source
--   change to Local, or a cancel (status cleared). The line is written by the
--   database with metadata.event = 'status_changed' ({event, from, to}); the
--   insert policy already keeps people from typing an event themselves. The
--   author is whoever made the change (null when nobody is signed in: the app
--   shows "System").
--
-- WHO HEARS
--   Nobody: a status line is a record, not a message. _ipas_message_notify now
--   returns early on an event line, and a person who only has event lines on a
--   thread does not count as having "posted before".
--
-- SAFE TO RUN AT ANY TIME: new function and trigger, one function replaced
-- (same body plus the two event checks). Nothing is backfilled. Idempotent.
-- ==============================================================================

create or replace function public._ipas_status_to_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  if new.status is null then
    v_text := 'Status cleared (was ' || public._ipas_status_label(old.status) || ').';
  elsif old.status is null then
    v_text := 'Status set to ' || public._ipas_status_label(new.status) || '.';
  else
    v_text := 'Status set to ' || public._ipas_status_label(new.status)
           || ' (was ' || public._ipas_status_label(old.status) || ').';
  end if;

  insert into public.ipas_messages (ipas_id, author_id, content, metadata)
  values (
    new.id,
    public.get_employee_id(),
    v_text,
    jsonb_build_object('event', 'status_changed', 'from', old.status, 'to', new.status)
  );

  return null;
end;
$$;

comment on function public._ipas_status_to_chat() is
  'ADR 0054 (amended 2026-11-22): posts every IPAS Status change in the IPAS''s Chat as a status_changed event line.';

revoke all on function public._ipas_status_to_chat() from public, anon, authenticated;

-- Not "update of status": the lifecycle trigger changes the status in a BEFORE
-- trigger on Filing / Reopen / cancel, which a column list would miss.
drop trigger if exists ipas_status_to_chat on public.ipas;
create trigger ipas_status_to_chat
after update on public.ipas
for each row
when (old.status is distinct from new.status)
execute function public._ipas_status_to_chat();

-- ------------------------------------------------------------------------------
-- Event lines notify nobody
-- ------------------------------------------------------------------------------

create or replace function public._ipas_message_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ipas public.ipas;
  v_label text;
  v_author text;
  v_mentioned uuid[] := '{}';
  v_others uuid[] := '{}';
begin
  -- A line the database posted (a status change) is a record, not a message.
  if new.metadata ? 'event' then
    return null;
  end if;

  select * into v_ipas from public.ipas where id = new.ipas_id;
  if v_ipas.id is null then
    return null;
  end if;
  v_label := concat_ws(' — ', v_ipas.number, nullif(v_ipas.odoo_copy->'supplier'->>'name', ''));
  select name into v_author from public.employees where id = new.author_id;

  if jsonb_typeof(new.metadata->'mentions') = 'array' then
    select coalesce(array_agg(distinct e.id), '{}') into v_mentioned
    from jsonb_array_elements(new.metadata->'mentions') x
    join public.employees e on e.id::text = x->>'id'
    where jsonb_typeof(x) = 'object'
      and e.id is distinct from new.author_id
      and public._ipas_employee_can_read(e.id);

    insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
    select r, new.author_id, 'IPAS_MENTION',
           coalesce(v_author, 'Someone') || ' mentioned you',
           left(v_label || ': ' || new.content, 280),
           v_ipas.id::text
    from unnest(v_mentioned) r;
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_others
  from (
    select v_ipas.created_by as x
    union
    select m.author_id from public.ipas_messages m
     where m.ipas_id = v_ipas.id and m.id <> new.id and not (m.metadata ? 'event')
  ) q
  where x is not null
    and x is distinct from new.author_id
    and not (x = any (v_mentioned))
    and public._ipas_employee_can_read(x);

  insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
  select r, new.author_id, 'IPAS_MESSAGE',
         'New message from ' || coalesce(v_author, 'someone'),
         left(v_label || ': ' || new.content, 280),
         v_ipas.id::text
  from unnest(v_others) r;

  return null;
end;
$$;

revoke all on function public._ipas_message_notify() from public, anon, authenticated;
