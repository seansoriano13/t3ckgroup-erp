-- Add Canvasses that already exist to a Purchase Request that already exists.
--
-- canvass_create_purchase_request always makes a new request. Purchasing often canvasses a product
-- first and then wants it in a request that is already open, either as a new Requested Item or on
-- an item the request already has (an employee asked for a stapler; Purchasing canvassed staplers).
--
--   canvass_add_to_purchase_request(request, items)   items: [{ canvass_id, quantity?, unit?, item_id? }]
--
-- Each Canvass must have no subject yet and a winner. With no item_id it becomes a new Requested
-- Item (name and description from the winner, like canvass_create_purchase_request); with an item_id
-- it is attached to that item of this request, which must still be open (Requested, To order or
-- Canvassing) and must not have a Canvass already, its own or its Component's. Either way the
-- winner's price goes onto the item and the Canvass re-points at it, which locks the Canvass
-- (20261101100000). Whoever may add items to the request may do this, and only with Purchasing access.
--
-- SAFE TO RUN AT ANY TIME: idempotent.

create or replace function public.canvass_add_to_purchase_request(p_request_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req      public.purchase_requests;
  v_entry    jsonb;
  v_id       uuid;
  v_item_id  uuid;
  v_seen     uuid[] := '{}';
  v_seen_items uuid[] := '{}';
  v_canvass  public.sor_canvasses;
  v_winner   public.sor_canvass_offers;
  v_price    public.sor_canvass_offer_prices;
  v_item     public.purchase_request_items;
  v_name     text;
  v_desc     text;
  v_qty      numeric;
  v_unit     text;
  v_made     jsonb := '[]'::jsonb;
  v_unsigned jsonb := '[]'::jsonb;
begin
  v_req := public._purchase_request_for_adding(p_request_id, 'canvass_add_to_purchase_request');
  if not public.canvass_can_write() then
    raise exception 'canvass_add_to_purchase_request: only Purchasing adds Canvasses to a Purchase Request'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'canvass_add_to_purchase_request: pick at least one Canvass' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'canvass_add_to_purchase_request: at most 50 Canvasses at once' using errcode = '22023';
  end if;

  -- Check every entry first, locking each Canvass so nobody else turns it into a request meanwhile.
  for v_entry in select * from jsonb_array_elements(p_items)
  loop
    v_id := nullif(v_entry ->> 'canvass_id', '')::uuid;
    v_item_id := nullif(v_entry ->> 'item_id', '')::uuid;

    -- The same lock a winner pick takes, so the winner can't change between this check and the copy.
    perform pg_advisory_xact_lock(hashtext('canvass_winner:' || coalesce(v_id::text, '')));
    select * into v_canvass from public.sor_canvasses where id = v_id for update;
    if not found then
      raise exception 'canvass_add_to_purchase_request: a picked Canvass was not found' using errcode = 'P0002';
    end if;
    if v_id = any (v_seen) then
      raise exception 'canvass_add_to_purchase_request: % is picked twice', v_canvass.number using errcode = '22023';
    end if;
    v_seen := v_seen || v_id;
    if v_canvass.component_id is not null or v_canvass.requested_item_id is not null then
      raise exception 'canvass_add_to_purchase_request: % already belongs to a Component or a Requested Item', v_canvass.number
        using errcode = '55000';
    end if;
    if not exists (select 1 from public.sor_canvass_offers o where o.canvass_id = v_id and o.is_winner) then
      raise exception 'canvass_add_to_purchase_request: % has no winner yet', v_canvass.number using errcode = '22023';
    end if;
    if v_canvass.signed_off_at is null then
      v_unsigned := v_unsigned || to_jsonb(v_id);
    end if;

    if v_item_id is not null then
      select * into v_item from public.purchase_request_items where id = v_item_id for update;
      if not found or v_item.request_id <> p_request_id then
        raise exception 'canvass_add_to_purchase_request: % is not an item of this request', v_item_id using errcode = 'P0002';
      end if;
      -- Past Canvassing the buying is done: the Canvass would lock at once and overwrite the item's price.
      if v_item.status not in ('requested', 'to_order', 'canvassing') then
        raise exception 'canvass_add_to_purchase_request: % is already past canvassing, so a Canvass can''t be attached to it', v_item.name
          using errcode = '55000';
      end if;
      if v_item_id = any (v_seen_items) then
        raise exception 'canvass_add_to_purchase_request: two Canvasses were picked for %', v_item.name using errcode = '22023';
      end if;
      v_seen_items := v_seen_items || v_item_id;
      if exists (
        select 1 from public.sor_canvasses c
         where c.requested_item_id = v_item_id
            or (v_item.component_id is not null and c.component_id = v_item.component_id)
      ) then
        raise exception 'canvass_add_to_purchase_request: % already has a Canvass', v_item.name using errcode = '55000';
      end if;
    end if;
  end loop;

  for v_entry in select * from jsonb_array_elements(p_items)
  loop
    v_id := (v_entry ->> 'canvass_id')::uuid;
    v_item_id := nullif(v_entry ->> 'item_id', '')::uuid;
    select * into v_canvass from public.sor_canvasses where id = v_id;
    select * into v_winner from public.sor_canvass_offers where canvass_id = v_id and is_winner;

    if v_item_id is null then
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
      v_item_id := public.purchase_request_add_new_item(p_request_id, v_name, v_qty, v_unit, v_desc, '[]'::jsonb);
    end if;

    -- The winner's price goes on the item, in the money table only Purchasing, Finance and
    -- Super Admin can read (#582). A winner with no price writes nothing.
    select * into v_price from public.sor_canvass_offer_prices where offer_id = v_winner.id;
    if found and v_price.unit_price is not null then
      insert into public.purchase_request_item_prices (item_id, unit_price, currency, comparison_rate)
      values (v_item_id, v_price.unit_price, v_winner.currency, v_price.comparison_rate)
      on conflict (item_id) do update
        set unit_price = excluded.unit_price, currency = excluded.currency,
            comparison_rate = excluded.comparison_rate, updated_at = now();
    end if;

    -- The Canvass re-points at the item, keeping its number, Offers and reason; this locks it.
    update public.sor_canvasses set requested_item_id = v_item_id where id = v_id;
    v_made := v_made || jsonb_build_array(jsonb_build_object('canvass_id', v_id, 'item_id', v_item_id));
  end loop;

  return jsonb_build_object('request_id', p_request_id, 'items', v_made, 'unsigned_canvass_ids', v_unsigned);
end;
$$;

revoke all on function public.canvass_add_to_purchase_request(uuid, jsonb) from public, anon;
grant execute on function public.canvass_add_to_purchase_request(uuid, jsonb) to authenticated;
