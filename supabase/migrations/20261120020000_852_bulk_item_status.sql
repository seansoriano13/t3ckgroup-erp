-- #852 (spec #844, decision 7): change many product lines' status at once, one Undo for the batch.
--
-- 1. purchase_request_bulk_set_item_status runs the single-line RPC for every ticked line in one
--    transaction, so the merging from #851 gives each recipient one notification. Cancelled and
--    Cannot source take one shared reason, posted to the request history for each line.
-- 2. purchase_request_bulk_undo_item_status undoes every line of the batch.
-- 3. purchase_request_undo_item_status (body from 20261024110000) now also takes its change out of a
--    merged notification ("3 products changed: ..."), the gap #851 left: the row loses that
--    line's part; at one part it reads as a single change again; at none it is withdrawn.

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
  v_seg text;
  v_prefix text;
  v_m record;
  v_count int;
  v_details text;
  v_pos int;
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

  -- #852: a change that #851 merged into a "N products changed: ..." notification. Take this line's
  -- part out of it (an unread row), or tell a recipient who already read it.
  v_seg := coalesce(v_item.name, 'A product') || ' → ' || coalesce(public._purchase_request_item_status_label(v_to), v_to, '?');
  v_prefix := v_label || ': ';
  for v_m in
    select n.id, n.recipient_id, coalesce(n.is_read, false) as is_read, n.message
    from public.notifications n
    where n.type = 'PURCHASE_REQUEST_ITEM_STATUS'
      and n.reference_id = v_item.request_id::text
      and n.sender_id = v_actor
      and left(n.message, length(v_prefix)) = v_prefix
      and substr(n.message, length(v_prefix) + 1) ~ '^[0-9]+ products changed: '
      and position(v_seg in n.message) > 0
    for update
  loop
    if v_m.is_read then
      v_read := array_append(coalesce(v_read, '{}'::uuid[]), v_m.recipient_id);
      continue;
    end if;
    v_count := (substring(substr(v_m.message, length(v_prefix) + 1) from '^([0-9]+) products changed: '))::int;
    v_details := regexp_replace(substr(v_m.message, length(v_prefix) + 1), '^[0-9]+ products changed: ', '');
    v_pos := position(', ' || v_seg in v_details);
    if v_pos > 0 then
      v_details := overlay(v_details placing '' from v_pos for length(', ' || v_seg));
    elsif left(v_details, length(v_seg) + 2) = v_seg || ', ' then
      v_details := substr(v_details, length(v_seg) + 3);
    elsif v_details = v_seg then
      v_details := null;
    else
      continue;
    end if;
    if v_count <= 1 or v_details is null then
      delete from public.notifications where id = v_m.id;
    else
      update public.notifications
         set message = left(v_prefix || case when v_count - 1 = 1 then v_details
                                             else (v_count - 1) || ' products changed: ' || v_details end, 280),
             title = case when v_count - 1 = 1 then 'Requested Item updated' else title end
       where id = v_m.id;
    end if;
  end loop;

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
  '2026-10-20 feedback, #852: reverses one Requested Item status change, named by the item and its status_changed_at. Only whoever made it, within 15 seconds, while nothing has changed the item since, and while they may still make that change. Restores the status and the previous change''s who/when; undoing Ordered clears the PO number, its check and picked PO lines. Refused when a Canvass is open for an item leaving Canvassing. Posts an item_status_undone event; withdraws the change''s unread notification (or its part of a merged one) and tells readers it was undone.';

revoke all on function public.purchase_request_undo_item_status(uuid, timestamptz) from public, anon;
grant execute on function public.purchase_request_undo_item_status(uuid, timestamptz) to authenticated;

-- One call for the whole batch: every line moves in this transaction, so a refusal on any line
-- changes none, and #851 merges the notifications into one per recipient.
create or replace function public.purchase_request_bulk_set_item_status(
  p_item_ids uuid[],
  p_status text,
  p_reason text default null
) returns setof public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_id uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_item public.purchase_request_items;
begin
  if v_actor is null then
    raise exception 'purchase_request_bulk_set_item_status: not signed in' using errcode = '42501';
  end if;
  if p_item_ids is null or cardinality(p_item_ids) = 0 or cardinality(p_item_ids) > 100 then
    raise exception 'purchase_request_bulk_set_item_status: pick between 1 and 100 lines' using errcode = '22023';
  end if;
  if p_status not in ('available', 'to_purchase', 'still_canvassing', 'cancelled', 'cannot_source') then
    raise exception 'purchase_request_bulk_set_item_status: % can''t be set on many lines at once', p_status
      using errcode = '22023';
  end if;
  if p_status in ('cancelled', 'cannot_source') and v_reason is null then
    raise exception 'purchase_request_bulk_set_item_status: give a reason' using errcode = '22023';
  end if;

  -- Lock in one order so two batches can't wait on each other.
  for v_id in select distinct x from unnest(p_item_ids) x order by x loop
    if p_status = 'available' then
      v_item := public.purchase_request_set_item_status(
        v_id, p_status, case when v_reason is null then '{}'::jsonb else jsonb_build_object('reason', v_reason) end);
    else
      v_item := public.purchase_request_set_item_status(v_id, p_status, '{}'::jsonb);
    end if;

    if p_status in ('cancelled', 'cannot_source') then
      perform public._purchase_request_post_event(
        v_item.request_id, v_actor,
        format('%s: %s. Reason: %s', v_item.name, public._purchase_request_item_status_label(p_status), v_reason),
        jsonb_build_object('event', 'item_status_reason', 'item_id', v_item.id, 'reason', v_reason)
      );
    end if;
    return next v_item;
  end loop;
end;
$$;

revoke all on function public.purchase_request_bulk_set_item_status(uuid[], text, text) from public, anon;
grant execute on function public.purchase_request_bulk_set_item_status(uuid[], text, text) to authenticated;

-- p_changes: [{ "item_id": uuid, "changed_at": timestamptz }, ...], the lines as the batch returned them.
create or replace function public.purchase_request_bulk_undo_item_status(p_changes jsonb)
returns setof public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_change jsonb;
begin
  if public.get_employee_id() is null then
    raise exception 'purchase_request_bulk_undo_item_status: not signed in' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'purchase_request_bulk_undo_item_status: nothing to undo' using errcode = '22023';
  end if;
  for v_change in select x from jsonb_array_elements(p_changes) x loop
    return next public.purchase_request_undo_item_status(
      (v_change->>'item_id')::uuid, (v_change->>'changed_at')::timestamptz);
  end loop;
end;
$$;

revoke all on function public.purchase_request_bulk_undo_item_status(jsonb) from public, anon;
grant execute on function public.purchase_request_bulk_undo_item_status(jsonb) to authenticated;
