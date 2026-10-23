-- ==============================================================================
-- 20261027100000_purchase_request_add_items_batch.sql
--
-- "Add from the SOR" with several lines picked at once.
--
-- BEFORE
-- The picker called purchase_request_add_item_from_line once per picked line.
-- Each call posted its own `item_added` event, and each event notified the
-- Buyer. Picking three lines sent the Buyer three "Item requested" notifications.
--
-- NOW
-- `purchase_request_add_items_from_lines` adds every picked line in one call,
-- all or nothing, with the same checks and the same copy as the one-line RPC.
-- One line posts the same single-item message as before. Two or more post ONE
-- `items_added` event naming the count, so the Buyer gets ONE notification.
--
-- The notify trigger's function is redefined from 20261012100000 with one more
-- branch, `items_added`. Nothing else in it changes.
--
-- NOT CHANGED
-- The one-line RPC stays, for any caller that still uses it. The Costing Matrix
-- add (#273) still posts one event per Component.
--
-- SAFE TO RUN AT ANY TIME: a new function, and the notify trigger's function
-- redefined with one more branch. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Adding several lines
-- ------------------------------------------------------------------------------

create or replace function public.purchase_request_add_items_from_lines(p_request_id uuid, p_line_ids uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.purchase_requests := public._purchase_request_for_adding(p_request_id, 'purchase_request_add_items_from_lines');
  v_id uuid;
  v_line public.sales_opportunity_items;
  v_name text;
  v_unit text;
  v_item public.purchase_request_items;
  v_added uuid[] := '{}';
begin
  if p_line_ids is null or cardinality(p_line_ids) = 0 then
    raise exception 'purchase_request_add_items_from_lines: pick at least one line' using errcode = '22023';
  end if;

  foreach v_id in array p_line_ids loop
    select * into v_line from public.sales_opportunity_items where id = v_id;
    if v_line.id is null or v_line.opportunity_id is distinct from v_req.opportunity_id then
      raise exception 'purchase_request_add_items_from_lines: that line is no longer on this SOR''s Product List'
        using errcode = 'P0002';
    end if;
    if coalesce(v_line.quantity, 0) <= 0 then
      raise exception 'purchase_request_add_items_from_lines: that line has no quantity' using errcode = '22023';
    end if;

    v_name := btrim(v_line.product_name);
    v_unit := nullif(btrim(v_line.unit), '');

    insert into public.purchase_request_items
      (request_id, source, odoo_product_id, name, unit, quantity, sor_line_snapshot, requested_by)
    values
      (p_request_id, 'sor_line', v_line.odoo_product_id, v_name, v_unit, v_line.quantity,
       jsonb_build_object('name', v_name, 'quantity', v_line.quantity, 'unit', v_unit),
       public.get_employee_id())
    returning * into v_item;

    v_added := v_added || v_item.id;
  end loop;

  if cardinality(v_added) = 1 then
    -- One line: the same message the one-line RPC posts.
    perform public._purchase_request_item_added(v_item);
  else
    -- Several lines: one message for the whole batch, so the Buyer is told once.
    insert into public.purchase_request_messages (request_id, author_id, content, metadata)
    values (
      v_req.id,
      public.get_employee_id(),
      format('Requested %s items, from the SOR''s Product List.', cardinality(v_added)),
      jsonb_build_object('event', 'items_added', 'item_ids', to_jsonb(v_added), 'source', 'sor_line')
    );

    update public.purchase_requests set updated_at = now() where id = v_req.id;
  end if;

  return v_added;
end;
$$;

comment on function public.purchase_request_add_items_from_lines(uuid, uuid[]) is
  'Adds a Requested Item for each picked line of the SOR''s Product List, all or nothing, at Requested. One line posts the single-item message; several post one items_added message, so the Buyer is notified once.';

-- ------------------------------------------------------------------------------
-- The chat notify trigger: one notification for a batch
-- ------------------------------------------------------------------------------

-- 20261012100000's body, with one more branch: `items_added`.
create or replace function public._purchase_request_message_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.purchase_requests;
  v_event text := new.metadata->>'event';
  v_label text;
  v_author text;
  v_mentioned uuid[] := '{}';
  v_requesters uuid[];
  v_item public.purchase_request_items;
  v_buyer uuid;
begin
  select * into v_req from public.purchase_requests where id = new.request_id;
  if v_req.id is null then
    return null;
  end if;
  v_label := public._purchase_request_label(v_req.id);
  select name into v_author from public.employees where id = new.author_id;

  -- Mentions: only a member's own message carries them; only members count.
  if v_event is null and jsonb_typeof(new.metadata->'mentions') = 'array' then
    select coalesce(array_agg(distinct m.employee_id), '{}') into v_mentioned
    from jsonb_array_elements(new.metadata->'mentions') x
    join public.purchase_request_members m
      on m.request_id = v_req.id
     and m.employee_id::text = x->>'id'
    where jsonb_typeof(x) = 'object'
      and m.employee_id is distinct from new.author_id;

    perform public._purchase_request_notify(
      v_req.id, v_mentioned, new.author_id, 'PURCHASE_REQUEST_MENTION',
      coalesce(v_author, 'Someone') || ' mentioned you',
      v_label || ': ' || new.content
    );
  end if;

  if v_event = 'opened' then
    -- Once per request, however the event came to be posted again.
    if exists (
      select 1 from public.purchase_request_messages p
      where p.request_id = v_req.id and p.id <> new.id and p.metadata->>'event' = 'opened'
    ) then
      return null;
    end if;

    if v_req.buyer_id is null then
      perform public._purchase_request_notify(
        v_req.id,
        array(select e.id from public.employees e where public._employee_has_purchasing_access(e.id)),
        new.author_id, 'PURCHASE_REQUEST_OPENED',
        'New Purchase Request',
        v_label || ' needs a Buyer. Take it from Purchase Requests.',
        false
      );
    else
      perform public._purchase_request_notify(
        v_req.id, array[v_req.buyer_id], new.author_id, 'PURCHASE_REQUEST_BUYER',
        'You''re the Buyer',
        v_label || ': a Purchase Request opened with you as its Buyer.'
      );
    end if;

  elsif v_event = 'buyer_set' then
    v_buyer := nullif(new.metadata->>'buyer_id', '')::uuid;
    if v_buyer is not null then
      perform public._purchase_request_notify(
        v_req.id, array[v_buyer], new.author_id, 'PURCHASE_REQUEST_BUYER',
        'You''re the Buyer',
        v_label || ': ' || coalesce(v_author, 'Someone') || ' made you its Buyer.'
      );
    end if;

  elsif v_event = 'item_status_changed' then
    select * into v_item from public.purchase_request_items
    where id = nullif(new.metadata->>'item_id', '')::uuid;
    perform public._purchase_request_notify(
      v_req.id, array[v_req.buyer_id, v_item.requested_by], new.author_id,
      'PURCHASE_REQUEST_ITEM_STATUS',
      'Requested Item updated',
      v_label || ': ' || new.content
    );

  elsif v_event = 'item_added' then
    perform public._purchase_request_notify(
      v_req.id, array[v_req.buyer_id], new.author_id, 'PURCHASE_REQUEST_ITEM_ADDED',
      'Item requested',
      v_label || ': ' || new.content
    );

  elsif v_event = 'items_added' then
    -- A batch from the SOR picker: one notification for all of its items.
    perform public._purchase_request_notify(
      v_req.id, array[v_req.buyer_id], new.author_id, 'PURCHASE_REQUEST_ITEM_ADDED',
      'Items requested',
      v_label || ': ' || new.content
    );

  elsif v_event is null then
    -- The creator counts only before a Buyer, or as a Direct request's Requester.
    select array_agg(distinct x) into v_requesters
    from (
      select v_req.created_by as x
      where v_req.buyer_id is null or v_req.opportunity_id is null
      union
      select i.requested_by from public.purchase_request_items i where i.request_id = v_req.id
    ) q
    where x is not null;

    perform public._purchase_request_notify(
      v_req.id,
      array(
        select r from unnest(array[v_req.buyer_id] || coalesce(v_requesters, '{}'::uuid[])) r
        where r is not null and not (r = any (v_mentioned))
      ),
      new.author_id, 'PURCHASE_REQUEST_MESSAGE',
      'New message from ' || coalesce(v_author, 'someone'),
      v_label || ': ' || new.content
    );
  end if;

  return null;
end;
$$;

revoke all on function public._purchase_request_message_notify() from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Grants: signed-in callers only
-- ------------------------------------------------------------------------------

revoke all on function public.purchase_request_add_items_from_lines(uuid, uuid[]) from public, anon;
grant execute on function public.purchase_request_add_items_from_lines(uuid, uuid[]) to authenticated;
