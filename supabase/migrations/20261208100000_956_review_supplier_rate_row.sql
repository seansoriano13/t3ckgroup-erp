-- Review fixes for spec #956 (Canvass per request).
--
-- A purchaser who may not read money adds a foreign-currency supplier with no rate. Two things
-- stood in the way of a money reader filling that rate in later:
--   1. canvass_add_supplier wrote the supplier's price row only for a money reader, so a supplier
--      added by a non-money purchaser had no row, and the later rate "update" touched nothing.
--      The row is now always made (its rate null unless the caller may read, and so write, one).
--   2. canvass_save_quote wrote the quote's price row for everyone, but the price table's row
--      policy refuses a non-money caller, so every save by a non-money purchaser failed. The
--      price row is now written only for a caller who may read money.
-- Suppliers already saved without a row get an empty one. A null rate is already allowed by the
-- table's check, so a supplier with "No rate" is a valid state.

create or replace function public.canvass_add_supplier(p_request_id uuid, p_supplier jsonb, p_price jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canvass  public.request_canvasses;
  v_supplier public.request_canvass_suppliers;
  v_rate     numeric;
begin
  p_supplier := coalesce(p_supplier, '{}'::jsonb);
  p_price := coalesce(p_price, '{}'::jsonb);

  if public.get_employee_id() is null then
    raise exception 'canvass_add_supplier: sign in first' using errcode = '42501';
  end if;
  if not (public.canvass_can_write() and public.canvass_request_can_read(p_request_id)) then
    raise exception 'canvass_add_supplier: not allowed' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('canvass_request:' || p_request_id::text));

  select * into v_canvass from public.request_canvasses where request_id = p_request_id;
  if not found then
    insert into public.request_canvasses (request_id, number)
    values (p_request_id, 'pending')
    returning * into v_canvass;
  end if;

  insert into public.request_canvass_suppliers (
    canvass_id, supplier_name, odoo_supplier_id, currency, valid_until, lead_time, quality_note,
    sort_order, created_by
  ) values (
    v_canvass.id,
    nullif(btrim(coalesce(p_supplier ->> 'supplier_name', '')), ''),
    nullif(p_supplier ->> 'odoo_supplier_id', '')::integer,
    coalesce(nullif(p_supplier ->> 'currency', ''), 'PHP'),
    nullif(p_supplier ->> 'valid_until', '')::date,
    p_supplier ->> 'lead_time',
    p_supplier ->> 'quality_note',
    (select count(*)::integer from public.request_canvass_suppliers where canvass_id = v_canvass.id),
    public.get_employee_id()
  )
  returning * into v_supplier;

  -- The rate is money: its value is written only for a caller who may read it. The row is always
  -- made, so a money reader who comes later has a row to fill.
  if public.canvass_can_read_money(v_canvass.id) then
    v_rate := nullif(p_price ->> 'comparison_rate', '')::numeric;
  end if;
  insert into public.request_canvass_supplier_prices (supplier_id, comparison_rate)
  values (v_supplier.id, v_rate);

  return jsonb_build_object(
    'canvass_id', v_canvass.id,
    'number', v_canvass.number,
    'supplier', to_jsonb(v_supplier)
  );
end
$$;

grant execute on function public.canvass_add_supplier(uuid, jsonb, jsonb) to authenticated;

-- Suppliers saved before this fix by a non-money purchaser have no price row.
insert into public.request_canvass_supplier_prices (supplier_id, comparison_rate)
select s.id, null
  from public.request_canvass_suppliers s
 where not exists (select 1 from public.request_canvass_supplier_prices p where p.supplier_id = s.id);

create or replace function public.canvass_save_quote(p_supplier_id uuid, p_item_id uuid, p_quote jsonb, p_price jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_canvass uuid;
  v_quote   public.request_canvass_quotes;
begin
  p_quote := coalesce(p_quote, '{}'::jsonb);
  p_price := coalesce(p_price, '{}'::jsonb);

  select s.canvass_id into v_canvass from public.request_canvass_suppliers s where s.id = p_supplier_id;
  if v_canvass is null then
    raise exception 'canvass_save_quote: that supplier is not on a Canvass you can see' using errcode = 'P0002';
  end if;

  insert into public.request_canvass_quotes (
    canvass_id, supplier_id, item_id, brand, description, source_link, brochure, remarks, created_by
  ) values (
    v_canvass, p_supplier_id, p_item_id,
    p_quote ->> 'brand',
    p_quote ->> 'description',
    p_quote ->> 'source_link',
    case when jsonb_typeof(p_quote -> 'brochure') = 'array' then p_quote -> 'brochure' else '[]'::jsonb end,
    p_quote ->> 'remarks',
    public.get_employee_id()
  )
  on conflict (supplier_id, item_id) do update set
    brand       = case when p_quote ? 'brand' then excluded.brand else request_canvass_quotes.brand end,
    description = case when p_quote ? 'description' then excluded.description else request_canvass_quotes.description end,
    source_link = case when p_quote ? 'source_link' then excluded.source_link else request_canvass_quotes.source_link end,
    brochure    = case when p_quote ? 'brochure' then excluded.brochure else request_canvass_quotes.brochure end,
    remarks     = case when p_quote ? 'remarks' then excluded.remarks else request_canvass_quotes.remarks end
  returning * into v_quote;

  -- The price row is money: the table refuses a caller who may not read it, so only a money
  -- reader writes it.
  if public.canvass_can_read_money(v_canvass) then
    insert into public.request_canvass_quote_prices (quote_id, unit_price)
    values (v_quote.id, nullif(p_price ->> 'unit_price', '')::numeric)
    on conflict (quote_id) do update set
      unit_price = case when p_price ? 'unit_price' then excluded.unit_price else request_canvass_quote_prices.unit_price end;
  end if;

  return to_jsonb(v_quote);
end
$$;

grant execute on function public.canvass_save_quote(uuid, uuid, jsonb, jsonb) to authenticated;
