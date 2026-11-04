-- 851 follow-up (spec #844, gap 3 of the 2026-11-04 to-do): merged status
-- notifications keep their changes as data, not as text read back.
--
-- #851 rebuilt "N products changed: ..." by parsing the stored message, and #852's
-- undo took a change back out the same way. A product name containing ": ", ", "
-- or " → ", or a message cut at 280 characters, garbled the merge or made the undo
-- miss its part. notifications.parts now holds each change as
-- {"content": "Fire suit: Requested → Purchased", "detail": "Fire suit → Purchased"};
-- the message is built from it and nothing parses the message any more.
--
-- A status notification written before this migration has no parts, so the next
-- change starts a new row instead of merging into it (at most a 10-minute overlap).

alter table public.notifications add column if not exists parts jsonb;

create or replace function public._purchase_request_status_parts_message(p_prefix text, p_parts jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select left(p_prefix || case
           when jsonb_array_length(p_parts) = 1 then p_parts->0->>'content'
           else jsonb_array_length(p_parts) || ' products changed: '
                || (select string_agg(x->>'detail', ', ' order by i) from jsonb_array_elements(p_parts) with ordinality as t(x, i))
         end, 280)
$$;

revoke all on function public._purchase_request_status_parts_message(text, jsonb) from public, anon, authenticated;

create or replace function public._purchase_request_notify_status_merge(
  p_request_id uuid,
  p_recipients uuid[],
  p_sender uuid,
  p_title text,
  p_label text,
  p_content text,   -- the single change, "Fire suit: Requested -> Purchased"
  p_detail text     -- the same change, short: "Fire suit -> Purchased"
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_old public.notifications;
  v_prefix text := p_label || ': ';
  v_part jsonb := jsonb_build_object('content', p_content, 'detail', p_detail);
  v_parts jsonb;
begin
  for r in
    select distinct e.id
    from unnest(coalesce(p_recipients, '{}'::uuid[])) as x(id)
    join public.employees e on e.id = x.id
    where not coalesce(e.is_deleted, false)
      and e.id is distinct from p_sender
      and exists (
        select 1 from public.purchase_request_members m
        where m.request_id = p_request_id and m.employee_id = e.id
      )
  loop
    v_old := null;
    select * into v_old
    from public.notifications n
    where n.recipient_id = r.id
      and n.type = 'PURCHASE_REQUEST_ITEM_STATUS'
      and n.reference_id = p_request_id::text
      and n.parts is not null
      and not coalesce(n.is_read, false)
      and n.created_at > now() - interval '10 minutes'
    order by n.created_at desc
    limit 1
    for update;

    if v_old.id is null then
      v_parts := jsonb_build_array(v_part);
      insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id, parts)
      values (r.id, p_sender, 'PURCHASE_REQUEST_ITEM_STATUS', p_title,
              public._purchase_request_status_parts_message(v_prefix, v_parts), p_request_id::text, v_parts);
    else
      v_parts := v_old.parts || jsonb_build_array(v_part);
      update public.notifications
         set title = 'Requested Items updated',
             message = public._purchase_request_status_parts_message(v_prefix, v_parts),
             parts = v_parts,
             sender_id = p_sender,
             is_read = false,
             created_at = now()
       where id = v_old.id;
    end if;
  end loop;
end;
$$;

revoke all on function public._purchase_request_notify_status_merge(uuid, uuid[], uuid, text, text, text, text)
  from public, anon, authenticated;

-- Body as in 20261120020000, but the change's notifications are found and
-- trimmed through notifications.parts.
create or replace function public.purchase_request_undo_item_status(
  p_item_id uuid,
  p_changed_at timestamptz
) returns public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_item public.purchase_request_items;
  v_event public.purchase_request_messages;
  v_from text;
  v_to text;
  v_side text;
  v_prev_by uuid;
  v_prev_at timestamptz;
  v_label text;
  v_content text;
  v_read uuid[];
  v_prefix text;
  v_m record;
  v_pos int;
  v_parts jsonb;
begin
  if v_actor is null then
    raise exception 'purchase_request_undo_item_status: not signed in' using errcode = '42501';
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'purchase_request_undo_item_status: item % not found', p_item_id using errcode = 'P0002';
  end if;

  if p_changed_at is null or v_item.status_changed_at is distinct from p_changed_at then
    raise exception 'purchase_request_undo_item_status: % has changed since, so there is nothing to undo', v_item.name
      using errcode = '22023';
  end if;
  if v_item.status_changed_by is distinct from v_actor then
    raise exception 'purchase_request_undo_item_status: only whoever made the change can undo it' using errcode = '42501';
  end if;
  if now() - v_item.status_changed_at > interval '15 seconds' then
    raise exception 'purchase_request_undo_item_status: it''s too late to undo that change' using errcode = '22023';
  end if;

  select * into v_event
  from public.purchase_request_messages m
  where m.request_id = v_item.request_id
    and m.metadata->>'event' = 'item_status_changed'
    and m.metadata->>'item_id' = v_item.id::text
    and (m.metadata->>'changed_at')::timestamptz = v_item.status_changed_at
  order by m.created_at desc
  limit 1;
  if v_event.id is null then
    raise exception 'purchase_request_undo_item_status: % has no change to undo', v_item.name using errcode = '22023';
  end if;

  v_from := v_event.metadata->>'from';
  v_to := v_event.metadata->>'to';
  if v_to is distinct from v_item.status then
    raise exception 'purchase_request_undo_item_status: % has changed since, so there is nothing to undo', v_item.name
      using errcode = '22023';
  end if;

  -- Only someone who may still make the change may take it back.
  v_side := public.purchase_request_actor_side(v_item.request_id);
  if v_side is null or not public._purchase_request_item_transition_ok(v_from, v_to, v_side) then
    raise exception 'purchase_request_undo_item_status: you can no longer change this item' using errcode = '42501';
  end if;

  if v_to = 'still_canvassing' and exists (
    select 1 from public.sor_canvasses c
    where c.requested_item_id = v_item.id
       or (v_item.component_id is not null and c.component_id = v_item.component_id)
  ) then
    raise exception 'purchase_request_undo_item_status: % has a Canvass, so it stays Still canvassing', v_item.name
      using errcode = '22023';
  end if;

  -- Who moved the item to the status it goes back to, and when: the latest
  -- change into it that wasn't itself undone.
  select (m.metadata->>'changed_by')::uuid, (m.metadata->>'changed_at')::timestamptz
    into v_prev_by, v_prev_at
  from public.purchase_request_messages m
  where m.request_id = v_item.request_id
    and m.metadata->>'event' = 'item_status_changed'
    and m.metadata->>'item_id' = v_item.id::text
    and m.metadata->>'to' = v_from
    and m.created_at <= v_event.created_at
    and m.id <> v_event.id
    and not exists (
      select 1 from public.purchase_request_messages u
      where u.request_id = m.request_id
        and u.metadata->>'event' = 'item_status_undone'
        and u.metadata->>'item_id' = m.metadata->>'item_id'
        and u.metadata->>'undone_changed_at' = m.metadata->>'changed_at'
    )
  order by m.created_at desc
  limit 1;

  update public.purchase_request_items
     set status = v_from,
         status_changed_by = v_prev_by,
         status_changed_at = v_prev_at,
         po_number = case when v_to = 'purchased' then null else po_number end,
         po_verification = case when v_to = 'purchased' then 'UNVERIFIED' else po_verification end,
         odoo_po_line_ids = case when v_to = 'purchased' then '{}'::int4[] else odoo_po_line_ids end
   where id = v_item.id
  returning * into v_item;

  v_content := format('%s: %s → %s (undone).', v_item.name,
    public._purchase_request_item_status_label(v_to),
    public._purchase_request_item_status_label(v_from));

  perform public._purchase_request_post_event(
    v_item.request_id,
    v_actor,
    v_content,
    jsonb_build_object(
      'event', 'item_status_undone',
      'item_id', v_item.id,
      'from', v_to,
      'to', v_from,
      'undone_changed_at', v_event.metadata->'changed_at',
      'changed_by', v_actor
    )
  );

  -- The change's notifications: take its part out of each unread one (withdrawing
  -- a row left with none), and tell whoever already read theirs.
  v_label := public._purchase_request_label(v_item.request_id);
  v_prefix := v_label || ': ';
  v_read := '{}';
  for v_m in
    select n.id, n.recipient_id, coalesce(n.is_read, false) as is_read, n.parts
    from public.notifications n
    where n.type = 'PURCHASE_REQUEST_ITEM_STATUS'
      and n.reference_id = v_item.request_id::text
      and n.parts is not null
      and exists (select 1 from jsonb_array_elements(n.parts) x where x->>'content' = v_event.content)
    for update
  loop
    if v_m.is_read then
      v_read := array_append(v_read, v_m.recipient_id);
      continue;
    end if;
    select t.i into v_pos
    from jsonb_array_elements(v_m.parts) with ordinality as t(x, i)
    where t.x->>'content' = v_event.content
    order by t.i desc
    limit 1;
    v_parts := v_m.parts - (v_pos - 1)::int;
    if jsonb_array_length(v_parts) = 0 then
      delete from public.notifications where id = v_m.id;
    else
      update public.notifications
         set parts = v_parts,
             message = public._purchase_request_status_parts_message(v_prefix, v_parts),
             title = case when jsonb_array_length(v_parts) = 1 then 'Requested Item updated' else title end
       where id = v_m.id;
    end if;
  end loop;

  -- A notification written before notifications.parts: its single-change message, as before.
  with sent as (
    select n.id, n.recipient_id, coalesce(n.is_read, false) as is_read
    from public.notifications n
    where n.type = 'PURCHASE_REQUEST_ITEM_STATUS'
      and n.reference_id = v_item.request_id::text
      and n.sender_id = v_actor
      and n.parts is null
      and n.message = left(v_prefix || v_event.content, 280)
  ),
  withdrawn as (
    delete from public.notifications n
    using sent
    where n.id = sent.id and not sent.is_read
    returning n.id
  )
  select v_read || coalesce(array_agg(distinct sent.recipient_id) filter (where sent.is_read), '{}')
    into v_read
  from sent;

  perform public._purchase_request_notify(
    v_item.request_id, v_read, v_actor,
    'PURCHASE_REQUEST_ITEM_STATUS',
    'Requested Item change undone',
    v_label || ': ' || v_content
  );

  return v_item;
end;
$$;

revoke all on function public.purchase_request_undo_item_status(uuid, timestamptz) from public, anon;
grant execute on function public.purchase_request_undo_item_status(uuid, timestamptz) to authenticated;
