-- 20261105040000_costing_actual_cost_in_pesos.sql
-- #686 fix (spec #675, ADR 0045): a foreign P0's Actual cost is turned into pesos.
--
-- costing_set_p0_price stored Odoo's price_unit as it stood, in the P0's own currency, and the
-- matrix compared it with Acquire, which is in pesos: a USD 388 P0 read "Actual ₱388.00 (−98.4%)"
-- beside a ₱24,641.49 Canvass winner, and the totals took the 388 as pesos.
--
-- The rate is the Canvass winner's comparison rate, the same one that turned the winning Offer
-- into Acquire, so Expected and Actual differ only by price and never by exchange rate. The rate
-- actually paid is Landed Cost's (IPAS), not this. The Reference Rate is not used.
--
--   p0_unit_price         the Actual cost in PHP, as before. Null for a foreign P0 with no
--                         Canvass winner in its currency: there is no rate, so nothing is compared
--                         and the totals keep Acquire.
--   p0_quoted_unit_price  the P0 line's price as Odoo has it, in p0_currency.
--   p0_currency           the P0's currency ('PHP', 'USD', ...).
--
-- The old three-argument function is replaced by one that also takes the currency.
--
-- Additive; idempotent.

alter table public.costing_component_costs
  add column if not exists p0_quoted_unit_price numeric;
alter table public.costing_component_costs
  add column if not exists p0_currency text;

comment on column public.costing_component_costs.p0_unit_price is
  '#686: the Actual cost in PHP: the attached P0 line''s unit price, times the Canvass winner''s comparison rate when the P0 is foreign. Null for a foreign P0 with no winner in its currency. Written only by costing_set_p0_price; the matrix shows it beside Acquire (the Expected cost) and it wins.';
comment on column public.costing_component_costs.p0_quoted_unit_price is
  '#686: the attached P0 line''s unit price as Odoo has it, in p0_currency. Written only by costing_set_p0_price.';
comment on column public.costing_component_costs.p0_currency is
  '#686: the attached P0''s currency in Odoo. Written only by costing_set_p0_price.';

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_component_costs', 'p0_quoted_unit_price', '{cost,closed_book}'),
  ('costing_component_costs', 'p0_currency', '{cost,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_component_costs', 'p0_quoted_unit_price', '{purchasing}'),
  ('costing_component_costs', 'p0_currency', '{purchasing}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

drop function if exists public.costing_set_p0_price(text, uuid, numeric);

create or replace function public.costing_set_p0_price(
  p_actor_email text,
  p_item_id uuid,
  p_price numeric,
  p_currency text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_component uuid;
  v_currency text := nullif(upper(btrim(p_currency)), '');
  v_rate numeric;
begin
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'costing_set_p0_price: not signed in' using errcode = '42501';
  end if;
  if p_price is not null and p_price < 0 then
    raise exception 'costing_set_p0_price: a price cannot be negative' using errcode = '22023';
  end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('email', p_actor_email, 'role', 'authenticated')::text, true);
  v_actor := public.get_employee_id();
  if v_actor is null then
    raise exception 'costing_set_p0_price: not signed in' using errcode = '42501';
  end if;

  select component_id into v_component from public.purchase_request_items where id = p_item_id;
  if v_component is null then
    return;
  end if;
  if coalesce(public.purchase_request_actor_side((select request_id from public.purchase_request_items where id = p_item_id)), '') <> 'purchasing' then
    raise exception 'costing_set_p0_price: only Purchasing sets the actual cost' using errcode = '42501';
  end if;

  -- A foreign P0 is turned into pesos at the Canvass winner's rate, when the winner is in the same currency.
  if v_currency is distinct from 'PHP' then
    select p.comparison_rate into v_rate
      from public.sor_canvasses c
      join public.sor_canvass_offers o on o.canvass_id = c.id and o.is_winner
      join public.sor_canvass_offer_prices p on p.offer_id = o.id
     where c.component_id = v_component and o.currency = v_currency;
  end if;

  update public.costing_component_costs
     set p0_unit_price = case
           when p_price is null then null
           when v_currency = 'PHP' then p_price
           when v_rate is not null then round(p_price * v_rate, 2)
         end,
         p0_quoted_unit_price = p_price,
         p0_currency = v_currency
   where component_id = v_component;
end;
$$;

comment on function public.costing_set_p0_price(text, uuid, numeric, text) is
  '#686: server-only (service role). Records the attached P0 line''s unit price as the Actual cost of the Component the product line is linked to, as the signed-in Purchasing member: in pesos as quoted for a PHP P0, at the Canvass winner''s comparison rate for a foreign one, and not in pesos at all when no winner is in that currency.';

revoke all on function public.costing_set_p0_price(text, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.costing_set_p0_price(text, uuid, numeric, text) to service_role;
