-- ==============================================================================
-- 20261118020000_803_available_short_stock_reason.sql
--
-- #803 (spec #798): choosing Available on short stock asks for a reason.
--
-- When a deal member (or Purchasing) chooses Available, and the request's SOR has a
-- stock check that shows less free stock than the item needs, the choice needs a short
-- reason. Without one it is refused. With one it is accepted, the line is flagged
-- "Now x free of y" straight away (stock_short_free / stock_short_needed, as the stock
-- check trigger would flag it), and the reason goes into the request history.
--
-- Choosing Available is never refused for the stock itself: the reason is what is asked.
-- No stock check (a Direct request, a line with no Odoo product, a product that is not
-- type 'product') means Available needs no reason, as before.
--
-- HOW IT HOOKS IN. purchase_request_set_item_status (the signed-in entry point) becomes a
-- wrapper for Available only. Every other status goes through unchanged to
-- _purchase_request_set_item_status. For Available the wrapper checks the stock, then calls
-- _purchase_request_set_item_status with no details, so the transition rules, the side
-- checks and the status history stay where they are.
--
-- SAFE TO RUN AT ANY TIME. Idempotent: create-or-replace function. The grant on
-- purchase_request_set_item_status is kept by create-or-replace.
-- ==============================================================================

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

  select * into v_item from public.purchase_request_items where id = p_item_id;
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
  '#306/#312/#548/#803: moves a Requested Item along its status path. Checks the transition and the caller''s side (purchasing walks the path; the sales side may only cancel), records who and when, and posts the change in the request. Ordered alone takes details: an optional `po_number` (P + digits). A PO number or check is refused from a signed-in caller (42501); only purchase_request_item_apply_po_check (server, after asking Odoo) records one. Available takes an optional `reason`, which is required when the SOR''s latest stock check shows less free stock than the line needs; it is then kept on the line and posted in the request history.';
