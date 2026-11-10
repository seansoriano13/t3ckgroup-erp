-- 2026-10-20 purchasing feedback, batch 3: undo a Requested Item status change.
--
-- A status still moves forward only (_purchase_request_item_transition_ok is
-- untouched). This adds one narrow way back: whoever made a change may reverse
-- that one change, shortly after, while nothing has moved the item since. The
-- change is named by the item and its status_changed_at, which the status RPC
-- returns; its item_status_changed event in the request's chat says where the
-- item came from.
--
-- Undo puts back what the change set:
--   * status, and the who/when of the change before it (from that change's
--     event, or null when the item had none);
--   * Ordered: the PO number, its Odoo check and any picked PO lines, all set
--     while the item was Ordered;
--   * notifications: unread ones about the change are withdrawn; whoever has
--     already read one is told it was undone.
-- The chat keeps the change and adds an "undone" event after it.
--
-- Refused when a Canvass is open for an item being taken back off Canvassing:
-- the Canvass would point at a To order item.

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
  if now() - v_item.status_changed_at > interval '30 seconds' then
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

  if v_to = 'canvassing' and exists (
    select 1 from public.sor_canvasses c
    where c.requested_item_id = v_item.id
       or (v_item.component_id is not null and c.component_id = v_item.component_id)
  ) then
    raise exception 'purchase_request_undo_item_status: % has a Canvass, so it stays Canvassing', v_item.name
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
         po_number = case when v_to = 'ordered' then null else po_number end,
         po_verification = case when v_to = 'ordered' then 'UNVERIFIED' else po_verification end,
         odoo_po_line_ids = case when v_to = 'ordered' then '{}'::int4[] else odoo_po_line_ids end
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

  -- The change's notifications (_purchase_request_message_notify): withdraw the
  -- unread ones, tell whoever already read theirs.
  v_label := public._purchase_request_label(v_item.request_id);
  with sent as (
    select n.id, n.recipient_id, coalesce(n.is_read, false) as is_read
    from public.notifications n
    where n.type = 'PURCHASE_REQUEST_ITEM_STATUS'
      and n.reference_id = v_item.request_id::text
      and n.sender_id = v_actor
      and n.message = left(v_label || ': ' || v_event.content, 280)
  ),
  withdrawn as (
    delete from public.notifications n
    using sent
    where n.id = sent.id and not sent.is_read
    returning n.id
  )
  select coalesce(array_agg(distinct sent.recipient_id) filter (where sent.is_read), '{}')
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

comment on function public.purchase_request_undo_item_status(uuid, timestamptz) is
  '2026-10-20 feedback: reverses one Requested Item status change, named by the item and its status_changed_at. Only whoever made it, within 30 seconds, while nothing has changed the item since, and while they may still make that change. Restores the status and the previous change''s who/when; undoing Ordered clears the PO number, its check and picked PO lines. Refused when a Canvass is open for an item leaving Canvassing. Posts an item_status_undone event; withdraws the change''s unread notifications and tells readers it was undone.';

revoke all on function public.purchase_request_undo_item_status(uuid, timestamptz) from public, anon;
grant execute on function public.purchase_request_undo_item_status(uuid, timestamptz) to authenticated;
