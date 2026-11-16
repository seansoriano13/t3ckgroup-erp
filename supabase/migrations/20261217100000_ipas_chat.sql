-- ==============================================================================
-- 20261217100000_ipas_chat.sql
--
-- The IPAS gets its own Chat, the same shape as the Purchase Request chat (#307).
--
-- THE CHAT
--   `ipas_messages`: one row per message. Append-only (no update or delete
--   policy). Mentions ride in `metadata.mentions` ([{id, name}]) and files in
--   `metadata.attachments`, as in the other chats.
--
-- WHO READS AND POSTS
--   Everyone who can read the IPAS (`ipas_can_read()`: Purchasing access,
--   Finance access, a Super Admin, or anyone on an IPAS sign-off list). There
--   are no members: whoever can open the IPAS can talk on it. A filed or
--   cancelled IPAS keeps its chat open.
--
-- WHO HEARS (one trigger on every message, `_ipas_message_notify`)
--   a mention         the person mentioned (IPAS_MENTION), if they can read IPAS.
--   a message         whoever raised the IPAS and everyone who posted on its
--                     chat before (IPAS_MESSAGE), minus those just mentioned.
--   Nobody hears about their own message; deleted employees never hear.
--   reference_id is the IPAS id, so the click opens /purchasing/ipas/<id>.
--
-- LIVE UPDATES
--   A row-id broadcast on `ipas_messages-changes` (id + ipas_id, never
--   content), for `useTableRealtime`.
--
-- SAFE TO RUN AT ANY TIME: a new table, new functions and triggers; nothing
-- existing is changed. Idempotent.
-- ==============================================================================

create table if not exists public.ipas_messages (
  id         uuid primary key default gen_random_uuid(),
  ipas_id    uuid not null references public.ipas (id) on delete cascade,
  author_id  uuid references public.employees (id),
  content    text not null,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.ipas_messages is
  'The IPAS''s own Chat. Append-only: no update or delete policy. Anyone who can read the IPAS reads and posts.';

create index if not exists ipas_messages_ipas_id_idx
  on public.ipas_messages (ipas_id, created_at);

alter table public.ipas_messages enable row level security;

drop policy if exists ipas_messages_read on public.ipas_messages;
create policy ipas_messages_read on public.ipas_messages
  for select to authenticated
  using (public.ipas_can_read());

drop policy if exists ipas_messages_insert on public.ipas_messages;
create policy ipas_messages_insert on public.ipas_messages
  for insert to authenticated
  with check (
    author_id = public.get_employee_id()
    and not (metadata ? 'event')
    and public.ipas_can_read()
  );

grant select, insert on public.ipas_messages to authenticated;

-- ------------------------------------------------------------------------------
-- Notifying
-- ------------------------------------------------------------------------------

-- Whether one employee may read IPAS: the same rule as ipas_can_read(), for
-- someone other than the caller.
create or replace function public._ipas_employee_can_read(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = p_employee_id
      and not coalesce(e.is_deleted, false)
      and (
        coalesce(e.has_purchasing_flow, false)
        or coalesce(e.has_finance_flow, false)
        or coalesce(e.is_super_admin, false)
        or exists (
          select 1 from ipas_signer_lists l
           where l.employee_id = e.id
             and l.list_key not like 'transmittal\_%' escape '\'
        )
      )
  );
$$;

revoke all on function public._ipas_employee_can_read(uuid) from public, anon, authenticated;

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
    select m.author_id from public.ipas_messages m where m.ipas_id = v_ipas.id and m.id <> new.id
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

drop trigger if exists ipas_messages_notify on public.ipas_messages;
create trigger ipas_messages_notify
after insert on public.ipas_messages
for each row execute function public._ipas_message_notify();

-- ------------------------------------------------------------------------------
-- Live updates: a nudge, never content
-- ------------------------------------------------------------------------------

create or replace function public.ipas_messages_broadcast_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  begin
    perform realtime.send(
      jsonb_build_object('id', new.id, 'ipas_id', new.ipas_id),
      tg_op,
      'ipas_messages-changes',
      true -- private: gated by the realtime.messages policy, not public
    );
  exception when others then
    null;
  end;
  return null;
end;
$function$;

revoke all on function public.ipas_messages_broadcast_change() from public, anon, authenticated;

drop trigger if exists ipas_messages_broadcast_change_trigger on public.ipas_messages;
create trigger ipas_messages_broadcast_change_trigger
after insert on public.ipas_messages
for each row execute function public.ipas_messages_broadcast_change();
