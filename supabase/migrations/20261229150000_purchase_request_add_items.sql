-- Ask for several products at once, each typed or picked from Odoo (2026-11-27).
--
-- "Ask for a product" took one typed product per form. Now one form sends a list: each product is
-- either picked from Odoo (its Odoo id is kept, as Replace does, #687) or typed in the asker's own
-- words. All of them are saved, or none: one bad row refuses the whole list, naming the row.
--
-- Every product still gets its own Chat line (event item_added). A product picked from Odoo says
-- "from Odoo" instead of "a new product".

create or replace function public.purchase_request_add_items(p_request_id uuid, p_items jsonb)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_req public.purchase_requests := public._purchase_request_for_adding(p_request_id, 'purchase_request_add_items');
  v_count int;
  v_row jsonb;
  v_n int := 0;
  v_at text;
  v_name text;
  v_quantity numeric;
  v_purpose text;
  v_images jsonb;
  v_odoo int;
  v_item public.purchase_request_items;
  v_ids uuid[] := '{}';
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'purchase_request_add_items: add at least one product' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count > 50 then
    raise exception 'purchase_request_add_items: add at most 50 products at a time' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    v_at := case when v_count > 1 then format('product %s: ', v_n) else '' end;

    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'purchase_request_add_items: %each product must be an object', v_at using errcode = '22023';
    end if;

    v_name := nullif(btrim(v_row->>'name'), '');
    if v_name is null then
      raise exception 'purchase_request_add_items: %a product needs a name', v_at using errcode = '22023';
    end if;

    begin
      v_quantity := (v_row->>'quantity')::numeric;
    exception when others then
      v_quantity := null;
    end;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'purchase_request_add_items: %the quantity must be more than zero', v_at using errcode = '22023';
    end if;

    v_purpose := coalesce(nullif(v_row->>'purpose', ''), 'client');
    if v_purpose not in ('client', 'job') then
      raise exception 'purchase_request_add_items: %say whether it is for the client or material for the job', v_at using errcode = '22023';
    end if;

    v_images := coalesce(v_row->'images', '[]'::jsonb);
    if jsonb_typeof(v_images) <> 'array'
       or jsonb_array_length(v_images) > 5
       or exists (
         select 1 from jsonb_array_elements(v_images) img
         where jsonb_typeof(img) <> 'object' or nullif(img->>'url', '') is null
       ) then
      raise exception 'purchase_request_add_items: %images must be up to 5 uploaded files', v_at using errcode = '22023';
    end if;

    v_odoo := null;
    if nullif(v_row->>'odoo_product_id', '') is not null then
      begin
        v_odoo := (v_row->>'odoo_product_id')::int;
      exception when others then
        v_odoo := null;
      end;
      if v_odoo is null or v_odoo <= 0 then
        raise exception 'purchase_request_add_items: %the Odoo product is not valid', v_at using errcode = '22023';
      end if;
    end if;

    insert into public.purchase_request_items
      (request_id, source, odoo_product_id, name, unit, quantity, description, images, purpose, requested_by)
    values
      (v_req.id, 'new', v_odoo, v_name, nullif(btrim(v_row->>'unit'), ''), v_quantity,
       nullif(btrim(v_row->>'description'), ''), v_images, v_purpose, public.get_employee_id())
    returning * into v_item;

    perform public._purchase_request_item_added(v_item);
    v_ids := v_ids || v_item.id;
  end loop;

  return v_ids;
end;
$$;

revoke all on function public.purchase_request_add_items(uuid, jsonb) from public, anon;
grant execute on function public.purchase_request_add_items(uuid, jsonb) to authenticated;

-- The Chat line says where an added product came from; one picked from Odoo says so.
create or replace function public._purchase_request_item_added(p_item purchase_request_items)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_amount text := trim_scale(p_item.quantity)::text || coalesce(' ' || nullif(btrim(p_item.unit), ''), '');
begin
  insert into public.purchase_request_messages (request_id, author_id, content, metadata)
  values (
    p_item.request_id,
    p_item.requested_by,
    case
      when p_item.source = 'sor_line' then format('Requested %s × %s, from the SOR''s Product List.', p_item.name, v_amount)
      when p_item.source = 'component' then format('Requested %s × %s, from the S0 Evaluation.', p_item.name, v_amount)
      when p_item.odoo_product_id is not null then format('Requested %s × %s, from Odoo.', p_item.name, v_amount)
      else format('Requested a new product: %s × %s.', p_item.name, v_amount)
    end,
    jsonb_build_object('event', 'item_added', 'item_id', p_item.id, 'source', p_item.source)
  );

  update public.purchase_requests set updated_at = now() where id = p_item.request_id;
end;
$$;
