-- #582 (spec #561): a Purchase Request made from Canvasses copies each winner's price onto its
-- Requested Item.
--
--   purchase_request_item_prices         (new) the money half of a Requested Item: unit_price as quoted,
--                                        its currency, and the comparison rate on a foreign Offer.
--                                        Kept apart from purchase_request_items because every member of
--                                        a request reads that table, and not every member may see prices.
--                                        Read policy: canvass_subject_can_read_money(null, item_id), the
--                                        same gate as the Offer prices (a reader of the request with
--                                        Purchasing access, Finance access or Super Admin). No write
--                                        policy: only canvass_create_purchase_request writes it.
--   canvass_create_purchase_request      also fills that row from the winning Offer.
--
-- SAFE TO RUN AT ANY TIME: idempotent.

create table if not exists public.purchase_request_item_prices (
  item_id         uuid primary key references public.purchase_request_items (id) on delete cascade,
  unit_price      numeric(14,2) not null,
  currency        text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  comparison_rate numeric(14,6) check (comparison_rate is null or comparison_rate > 0),
  updated_at      timestamptz not null default now()
);

comment on table public.purchase_request_item_prices is
  '#582: the price a Requested Item was bought at, copied from the winning Offer when a request is made from Canvasses. unit_price is in the stated currency (as quoted). Money, so a row policy hides it from members without Purchasing, Finance or Super Admin access.';

alter table public.purchase_request_item_prices enable row level security;

drop policy if exists purchase_request_item_prices_read on public.purchase_request_item_prices;
create policy purchase_request_item_prices_read on public.purchase_request_item_prices
  for select to authenticated
  using (public.canvass_subject_can_read_money(null, item_id));

revoke all on public.purchase_request_item_prices from public, anon;
grant select on public.purchase_request_item_prices to authenticated;

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
  v_price   public.sor_canvass_offer_prices;
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
    -- The winner's price goes on the item, in the money table only Purchasing, Finance and
    -- Super Admin can read (#582). A winner with no price writes nothing.
    select * into v_price from public.sor_canvass_offer_prices where offer_id = v_winner.id;
    if found and v_price.unit_price is not null then
      insert into public.purchase_request_item_prices (item_id, unit_price, currency, comparison_rate)
      values (v_item, v_price.unit_price, v_winner.currency, v_price.comparison_rate)
      on conflict (item_id) do update
        set unit_price = excluded.unit_price, currency = excluded.currency,
            comparison_rate = excluded.comparison_rate, updated_at = now();
    end if;

    update public.sor_canvasses set requested_item_id = v_item where id = v_id;
    v_made := v_made || jsonb_build_array(jsonb_build_object('canvass_id', v_id, 'item_id', v_item));
  end loop;

  return jsonb_build_object('request_id', v_req, 'items', v_made, 'unsigned_canvass_ids', v_unsigned);
end;
$$;

revoke all on function public.canvass_create_purchase_request(text, jsonb) from public, anon;
grant execute on function public.canvass_create_purchase_request(text, jsonb) to authenticated;
