-- Spec #798 review fixes (ticket #803): the Available choice, and the short-stock flag.
--
-- 1. purchase_request_set_item_status (Available branch) reads the item with `for update` before it
--    checks the stock and changes the status, so two choices at once cannot both pass the check. The
--    function comment said the reason "is then kept on the line"; it is not. The reason goes to the
--    request history only (item_short_stock_reason). Body from 20261118020000_803_available_short_stock_reason.sql.
--
-- 2. Undo (and an attach) could move a line out of Available and leave "Now x free of y" on it, because
--    only _purchase_request_item_move cleared stock_short_*. A trigger now clears both columns whenever
--    a line's status leaves Available, whatever path moved it.

create or replace function public.purchase_request_set_item_status(
  p_item_id uuid,
  p_status text,
  p_details jsonb default '{}'::jsonb
) returns public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_item public.purchase_request_items;
  v_product jsonb;
  v_free numeric;
  v_reason text;
  v_key text;
begin
  -- Every other status is unchanged.
  if p_status is distinct from 'available' then
    return public._purchase_request_set_item_status(p_item_id, p_status, p_details, false);
  end if;

  if v_actor is null then
    raise exception 'purchase_request_set_item_status: not signed in' using errcode = '42501';
  end if;
  if jsonb_typeof(v_details) <> 'object' then
    raise exception 'purchase_request_set_item_status: details must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(v_details) loop
    if v_key <> 'reason' then
      raise exception 'purchase_request_set_item_status: Available takes a reason, not %', v_key
        using errcode = '22023';
    end if;
  end loop;
  if v_details ? 'reason' and jsonb_typeof(v_details->'reason') not in ('string', 'null') then
    raise exception 'purchase_request_set_item_status: the reason must be text' using errcode = '22023';
  end if;
  v_reason := nullif(btrim(v_details->>'reason'), '');

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'purchase_request_set_item_status: item % not found', p_item_id using errcode = 'P0002';
  end if;

  -- The latest stock check on the request's SOR (one row per SOR, #202). The same test the
  -- stock check trigger (_flag_short_available_items) uses to flag a line.
  select s.data->'products'->(v_item.odoo_product_id::text)
    into v_product
    from public.purchase_requests r
    join public.sor_stock_snapshots s on s.opportunity_id = r.opportunity_id
   where r.id = v_item.request_id;

  if v_item.odoo_product_id is not null
     and v_product->>'type' = 'product'
     and coalesce((v_product->>'free')::numeric, 0) < v_item.quantity then
    v_free := coalesce((v_product->>'free')::numeric, 0);

    if v_reason is null then
      raise exception 'purchase_request_set_item_status: Now % free of %. Give a short reason to mark it Available',
        v_free, v_item.quantity
        using errcode = '22023';
    end if;

    v_item := public._purchase_request_set_item_status(p_item_id, 'available', '{}'::jsonb, false);

    update public.purchase_request_items
       set stock_short_free = v_free,
           stock_short_needed = v_item.quantity
     where id = v_item.id
    returning * into v_item;

    perform public._purchase_request_post_event(
      v_item.request_id,
      v_actor,
      format('%s: Available on short stock, now %s free of %s. Reason: %s',
        v_item.name, v_free, v_item.quantity, v_reason),
      jsonb_build_object(
        'event', 'item_short_stock_reason',
        'item_id', v_item.id,
        'reason', v_reason,
        'free', v_free,
        'needed', v_item.quantity
      )
    );

    return v_item;
  end if;

  -- No stock check, or enough stock: Available as before, no reason needed.
  return public._purchase_request_set_item_status(p_item_id, 'available', '{}'::jsonb, false);
end;
$$;

comment on function public.purchase_request_set_item_status(uuid, text, jsonb) is
  '#306/#312/#548/#803: moves a Requested Item along its status path. Checks the transition and the caller''s side (purchasing walks the path; the sales side may only cancel), records who and when, and posts the change in the request. Ordered alone takes details: an optional `po_number` (P + digits). A PO number or check is refused from a signed-in caller (42501); only purchase_request_item_apply_po_check (server, after asking Odoo) records one. Available takes an optional `reason`, which is required when the SOR''s latest stock check shows less free stock than the line needs; it goes into the request history only; the line keeps just the Now x free of y flag, which clears when the line leaves Available.';

-- Clear the "Now x free of y" flag when a line leaves Available.
create or replace function public._purchase_request_items_clear_short_stock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'available' and new.status is distinct from 'available' then
    new.stock_short_free := null;
    new.stock_short_needed := null;
  end if;
  return new;
end;
$$;

comment on function public._purchase_request_items_clear_short_stock() is
  '#803 review: a line that leaves Available no longer carries "Now x free of y" (stock_short_free / stock_short_needed), whichever path moved it (Undo, an attach, a status choice).';

revoke all on function public._purchase_request_items_clear_short_stock() from public, anon, authenticated;

drop trigger if exists purchase_request_items_clear_short_stock on public.purchase_request_items;
create trigger purchase_request_items_clear_short_stock
  before update of status on public.purchase_request_items
  for each row
  execute function public._purchase_request_items_clear_short_stock();
