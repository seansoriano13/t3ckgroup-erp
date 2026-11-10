-- 2026-10-20 purchasing feedback (#561) review fixes.
--
--   canvass_clear_winner                 an un-pick always writes its own Canvass history row
--                                        (kind 'cleared', reason 'The winner was un-picked'), signed or not.
--   canvass_create_purchase_request      also returns unsigned_canvass_ids, so the page warns from the
--                                        server's word. No price goes onto the item: purchase_request_items
--                                        has no price column and its members may not see prices.
--   purchase_request_undo_item_status    the server grace is 15 seconds (the screen offers 10).
--
-- SAFE TO RUN AT ANY TIME: idempotent.

create or replace function public.canvass_clear_winner(p_canvass_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleared integer;
  v_signed  timestamptz;
  v_reason  constant text := 'The winner was un-picked';
begin
  if public.get_employee_id() is null then
    raise exception 'canvass_clear_winner: sign in first' using errcode = '42501';
  end if;

  -- The same lock canvass_apply_winner takes, so a pick and an un-pick never interleave.
  perform pg_advisory_xact_lock(hashtext('canvass_winner:' || p_canvass_id::text));

  select signed_off_at into v_signed from public.sor_canvasses where id = p_canvass_id;
  if not found then
    raise exception 'canvass_clear_winner: not found' using errcode = 'P0002';
  end if;
  if not (public.canvass_can_write() and public.canvass_can_read(p_canvass_id)) then
    raise exception 'canvass_clear_winner: not allowed' using errcode = '42501';
  end if;

  if not exists (select 1 from public.sor_canvass_offers where canvass_id = p_canvass_id and is_winner) then
    return jsonb_build_object('canvass_id', p_canvass_id, 'cleared', false);
  end if;

  -- A signed Canvass is unsigned first, with this reason, which writes the history row; the
  -- winner trigger then finds it unsigned. An unsigned one gets the same row written here.
  if v_signed is not null then
    perform public.canvass_clear_signoff(p_canvass_id, v_reason);
  else
    insert into public.sor_canvass_signoff_events (canvass_id, kind, actor_id, reason, offer_count)
    values (
      p_canvass_id, 'cleared', public.get_employee_id(), v_reason,
      (select count(*) from public.sor_canvass_offers where canvass_id = p_canvass_id)
    );
  end if;

  -- The Costing Matrix keeps what the winner filled, marked, until canvass_apply_winner replaces it.
  update public.sor_canvass_offers set is_winner = false
   where canvass_id = p_canvass_id and is_winner;
  get diagnostics v_cleared = row_count;

  return jsonb_build_object('canvass_id', p_canvass_id, 'cleared', v_cleared > 0);
end;
$$;

revoke all on function public.canvass_clear_winner(uuid) from public, anon;
grant execute on function public.canvass_clear_winner(uuid) to authenticated;

create or replace function public.canvass_create_purchase_request(p_title text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := public.get_employee_id();
  v_entry   jsonb;
  v_id      uuid;
  v_seen    uuid[] := '{}';
  v_canvass public.sor_canvasses;
  v_winner  public.sor_canvass_offers;
  v_name    text;
  v_desc    text;
  v_qty     numeric;
  v_unit    text;
  v_req     uuid;
  v_item    uuid;
  v_made    jsonb := '[]'::jsonb;
  v_unsigned jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'canvass_create_purchase_request: sign in first' using errcode = '42501';
  end if;
  if not public.canvass_can_write() then
    raise exception 'canvass_create_purchase_request: only Purchasing creates a Purchase Request from Canvasses'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'canvass_create_purchase_request: pick at least one Canvass' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'canvass_create_purchase_request: at most 50 Canvasses at once' using errcode = '22023';
  end if;

  -- Check every Canvass first, locking it so nobody else turns it into a request meanwhile.
  for v_entry in select * from jsonb_array_elements(p_items)
  loop
    v_id := nullif(v_entry ->> 'canvass_id', '')::uuid;
    select * into v_canvass from public.sor_canvasses where id = v_id for update;
    if not found then
      raise exception 'canvass_create_purchase_request: a picked Canvass was not found' using errcode = 'P0002';
    end if;
    if v_id = any (v_seen) then
      raise exception 'canvass_create_purchase_request: % is picked twice', v_canvass.number using errcode = '22023';
    end if;
    v_seen := v_seen || v_id;
    if v_canvass.signed_off_at is null then
      v_unsigned := v_unsigned || to_jsonb(v_id);
    end if;
    if v_canvass.component_id is not null or v_canvass.requested_item_id is not null then
      raise exception 'canvass_create_purchase_request: % already belongs to a Component or a Requested Item', v_canvass.number
        using errcode = '55000';
    end if;
    if not exists (select 1 from public.sor_canvass_offers o where o.canvass_id = v_id and o.is_winner) then
      raise exception 'canvass_create_purchase_request: % has no winner yet', v_canvass.number using errcode = '22023';
    end if;
  end loop;

  for v_entry in select * from jsonb_array_elements(p_items)
  loop
    v_id := (v_entry ->> 'canvass_id')::uuid;
    select * into v_canvass from public.sor_canvasses where id = v_id;
    select * into v_winner from public.sor_canvass_offers where canvass_id = v_id and is_winner;

    v_name := coalesce(
      nullif(btrim(coalesce(v_canvass.product_name, '')), ''),
      nullif(btrim(coalesce(v_winner.brand, '')), ''),
      v_canvass.number
    );
    v_desc := nullif(concat_ws(E'\n',
      nullif(concat_ws(' · ',
        nullif(btrim(coalesce(v_winner.supplier_name, '')), ''),
        nullif(btrim(coalesce(v_winner.brand, '')), '')
      ), ''),
      nullif(btrim(coalesce(v_winner.description, '')), ''),
      'From Canvass ' || v_canvass.number
    ), '');
    v_qty := coalesce(nullif(v_entry ->> 'quantity', '')::numeric, 1);
    v_unit := nullif(btrim(coalesce(v_entry ->> 'unit', '')), '');

    if v_req is null then
      v_req := public.purchase_request_open(
        p_title,
        jsonb_build_array(jsonb_build_object('name', v_name, 'quantity', v_qty, 'unit', v_unit, 'description', v_desc))
      );
      select i.id into v_item from public.purchase_request_items i where i.request_id = v_req;
    else
      v_item := public.purchase_request_add_new_item(v_req, v_name, v_qty, v_unit, v_desc, '[]'::jsonb);
    end if;

    -- The Canvass re-points at the item it became, keeping its number, Offers and reason.
    update public.sor_canvasses set requested_item_id = v_item where id = v_id;
    v_made := v_made || jsonb_build_array(jsonb_build_object('canvass_id', v_id, 'item_id', v_item));
  end loop;

  return jsonb_build_object('request_id', v_req, 'items', v_made, 'unsigned_canvass_ids', v_unsigned);
end;
$$;

revoke all on function public.canvass_create_purchase_request(text, jsonb) from public, anon;
grant execute on function public.canvass_create_purchase_request(text, jsonb) to authenticated;

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
  '2026-10-20 feedback: reverses one Requested Item status change, named by the item and its status_changed_at. Only whoever made it, within 15 seconds, while nothing has changed the item since, and while they may still make that change. Restores the status and the previous change''s who/when; undoing Ordered clears the PO number, its check and picked PO lines. Refused when a Canvass is open for an item leaving Canvassing. Posts an item_status_undone event; withdraws the change''s unread notifications and tells readers it was undone.';

revoke all on function public.purchase_request_undo_item_status(uuid, timestamptz) from public, anon;
grant execute on function public.purchase_request_undo_item_status(uuid, timestamptz) to authenticated;
