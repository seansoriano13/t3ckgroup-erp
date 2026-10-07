-- ==============================================================================
-- 20261007120500_purchase_request_add_items.sql
--
-- Issue #305 (part of #209) — Requested Items: picked from an SOR line, or
-- described as a new product.
--
-- WHO ADDS
-- A member on the `sales` side of the request, or its Buyer (#209 Access).
-- `purchase_request_can_add_items` is the one place that rule lives; both add
-- RPCs and the line picker check it.
--
-- FROM AN SOR LINE
-- `purchase_request_add_item_from_line` copies the line's Odoo product, name,
-- quantity and unit into the item, and the same three into
-- `sor_line_snapshot`. The copy is read on the server, so a caller can't
-- hand in a snapshot the SOR never said. Later SOR edits never touch the item:
-- `sor_replace_items` deletes and re-inserts every line on each save, so the
-- item keeps no reference to a line row at all.
--
-- "SOR LINE NOW SAYS N"
-- `purchase_request_item_lines` finds each line-sourced item's line on the
-- SOR as it stands now — by Odoo product, or by name for a line that had none
-- when picked; a line still saying the picked quantity wins a tie, then the
-- first on the list — and returns its quantity and unit, or nothing when the
-- line is gone. It answers per item and never lists the rest of the Product
-- List, because a request member may have no access to the SOR itself.
-- The client compares it with the snapshot.
--
-- STOCK
-- Not stored on the item. The view reads the SOR's stock snapshot
-- (`sor_stock_snapshots`, #202: readable by any signed-in employee) by the
-- item's Odoo product, with its `fetched_at`.
--
-- THE PICKER
-- `purchase_request_pickable_lines` lists the SOR's current Product List
-- (no prices) to whoever may add items, since the Buyer may hold no window
-- into the SOR.
--
-- POSTS IN THE REQUEST
-- Every added item starts at Requested and posts an `item_added` event
-- message. Only an RPC may post an event (20261005140000's insert policy).
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: new
-- functions only, nothing existing altered or replaced. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Who may add items
-- ------------------------------------------------------------------------------

create or replace function public.purchase_request_can_add_items(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from purchase_requests r
    where r.id = p_request_id
      and get_employee_id() is not null
      and (
        r.buyer_id = get_employee_id()
        or exists (
          select 1 from purchase_request_members m
          where m.request_id = r.id
            and m.employee_id = get_employee_id()
            and m.side = 'sales'
        )
      )
  );
$$;

comment on function public.purchase_request_can_add_items(uuid) is
  '#305: whether the caller may add Requested Items to this request — a sales-side member or the Buyer.';

-- ------------------------------------------------------------------------------
-- Internals
-- ------------------------------------------------------------------------------

-- Refuses a caller who may not add items to the request; returns the request.
create or replace function public._purchase_request_for_adding(p_request_id uuid, p_fn text)
returns public.purchase_requests
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_req public.purchase_requests;
begin
  if public.get_employee_id() is null then
    raise exception '%: not signed in', p_fn using errcode = '42501';
  end if;
  select * into v_req from public.purchase_requests where id = p_request_id;
  if v_req.id is null then
    raise exception '%: request % not found', p_fn, p_request_id using errcode = 'P0002';
  end if;
  if not public.purchase_request_can_add_items(p_request_id) then
    raise exception '%: only the request''s sales side or its Buyer may add items', p_fn using errcode = '42501';
  end if;
  return v_req;
end;
$$;

revoke all on function public._purchase_request_for_adding(uuid, text) from public, anon, authenticated;

-- Posts the `item_added` event for a new item and touches the request.
create or replace function public._purchase_request_item_added(p_item public.purchase_request_items)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount text := trim_scale(p_item.quantity)::text || coalesce(' ' || nullif(btrim(p_item.unit), ''), '');
begin
  insert into public.purchase_request_messages (request_id, author_id, content, metadata)
  values (
    p_item.request_id,
    p_item.requested_by,
    case p_item.source
      when 'sor_line' then format('Requested %s × %s, from the SOR''s Product List.', p_item.name, v_amount)
      else format('Requested a new product: %s × %s.', p_item.name, v_amount)
    end,
    jsonb_build_object('event', 'item_added', 'item_id', p_item.id, 'source', p_item.source)
  );

  update public.purchase_requests set updated_at = now() where id = p_item.request_id;
end;
$$;

revoke all on function public._purchase_request_item_added(public.purchase_request_items) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Adding items
-- ------------------------------------------------------------------------------

create or replace function public.purchase_request_add_item_from_line(p_request_id uuid, p_line_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.purchase_requests := public._purchase_request_for_adding(p_request_id, 'purchase_request_add_item_from_line');
  v_line public.sales_opportunity_items;
  v_name text;
  v_unit text;
  v_item public.purchase_request_items;
begin
  select * into v_line from public.sales_opportunity_items where id = p_line_id;
  if v_line.id is null or v_line.opportunity_id is distinct from v_req.opportunity_id then
    raise exception 'purchase_request_add_item_from_line: that line is no longer on this SOR''s Product List'
      using errcode = 'P0002';
  end if;
  if coalesce(v_line.quantity, 0) <= 0 then
    raise exception 'purchase_request_add_item_from_line: that line has no quantity' using errcode = '22023';
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

  perform public._purchase_request_item_added(v_item);
  return v_item.id;
end;
$$;

comment on function public.purchase_request_add_item_from_line(uuid, uuid) is
  '#305: adds a Requested Item copied from one of the SOR''s Product List lines (Odoo product, name, quantity, unit, and the snapshot), at Requested, and posts it in the request.';

create or replace function public.purchase_request_add_new_item(
  p_request_id uuid,
  p_name text,
  p_quantity numeric,
  p_unit text default null,
  p_description text default null,
  p_images jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.purchase_requests := public._purchase_request_for_adding(p_request_id, 'purchase_request_add_new_item');
  v_images jsonb := coalesce(p_images, '[]'::jsonb);
  v_item public.purchase_request_items;
begin
  if nullif(btrim(p_name), '') is null then
    raise exception 'purchase_request_add_new_item: a new product needs a name' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'purchase_request_add_new_item: the quantity must be more than zero' using errcode = '22023';
  end if;
  if jsonb_typeof(v_images) <> 'array'
     or jsonb_array_length(v_images) > 5
     or exists (
       select 1 from jsonb_array_elements(v_images) img
       where jsonb_typeof(img) <> 'object' or nullif(img->>'url', '') is null
     ) then
    raise exception 'purchase_request_add_new_item: images must be up to 5 uploaded files' using errcode = '22023';
  end if;

  insert into public.purchase_request_items
    (request_id, source, name, unit, quantity, description, images, requested_by)
  values
    (v_req.id, 'new', btrim(p_name), nullif(btrim(p_unit), ''), p_quantity,
     nullif(btrim(p_description), ''), v_images, public.get_employee_id())
  returning * into v_item;

  perform public._purchase_request_item_added(v_item);
  return v_item.id;
end;
$$;

comment on function public.purchase_request_add_new_item(uuid, text, numeric, text, text, jsonb) is
  '#305: adds a Requested Item for a product not in Odoo (name, quantity, unit, description, images), at Requested, and posts it in the request.';

-- ------------------------------------------------------------------------------
-- Reading the SOR's lines
-- ------------------------------------------------------------------------------

-- The SOR's Product List as it stands, for the picker. No prices.
create or replace function public.purchase_request_pickable_lines(p_request_id uuid)
returns table (
  id uuid,
  product_name text,
  quantity numeric,
  unit text,
  odoo_product_id integer,
  sort_order integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_req public.purchase_requests := public._purchase_request_for_adding(p_request_id, 'purchase_request_pickable_lines');
begin
  return query
    select l.id, l.product_name, l.quantity, l.unit, l.odoo_product_id, l.sort_order
    from public.sales_opportunity_items l
    where l.opportunity_id = v_req.opportunity_id
    order by l.sort_order, l.created_at;
end;
$$;

-- For each line-sourced item the caller can read, the line it was picked
-- from as the SOR says it now, or line_found false when it is gone.
create or replace function public.purchase_request_item_lines(p_request_id uuid)
returns table (
  item_id uuid,
  line_found boolean,
  line_quantity numeric,
  line_unit text
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, l.id is not null, l.quantity, nullif(btrim(l.unit), '')
  from purchase_request_items i
  join purchase_requests r on r.id = i.request_id
  left join lateral (
    select sl.id, sl.quantity, sl.unit
    from sales_opportunity_items sl
    where sl.opportunity_id = r.opportunity_id
      and case
        when i.odoo_product_id is not null then sl.odoo_product_id = i.odoo_product_id
        else lower(btrim(sl.product_name)) = lower(btrim(i.sor_line_snapshot->>'name'))
      end
    order by (sl.quantity = (i.sor_line_snapshot->>'quantity')::numeric) desc, sl.sort_order, sl.created_at
    limit 1
  ) l on true
  where i.request_id = p_request_id
    and i.source = 'sor_line'
    and can_read_purchase_request(p_request_id);
$$;

-- ------------------------------------------------------------------------------
-- Grants: signed-in callers only
-- ------------------------------------------------------------------------------

revoke all on function public.purchase_request_can_add_items(uuid) from public, anon;
revoke all on function public.purchase_request_add_item_from_line(uuid, uuid) from public, anon;
revoke all on function public.purchase_request_add_new_item(uuid, text, numeric, text, text, jsonb) from public, anon;
revoke all on function public.purchase_request_pickable_lines(uuid) from public, anon;
revoke all on function public.purchase_request_item_lines(uuid) from public, anon;

grant execute on function public.purchase_request_can_add_items(uuid) to authenticated;
grant execute on function public.purchase_request_add_item_from_line(uuid, uuid) to authenticated;
grant execute on function public.purchase_request_add_new_item(uuid, text, numeric, text, text, jsonb) to authenticated;
grant execute on function public.purchase_request_pickable_lines(uuid) to authenticated;
grant execute on function public.purchase_request_item_lines(uuid) to authenticated;
