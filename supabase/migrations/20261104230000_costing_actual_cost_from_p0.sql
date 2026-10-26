-- 20261104230000_costing_actual_cost_from_p0.sql
-- #686 (spec #675): the Costing Matrix shows Expected and Actual cost.
--
--   Expected = the Component's Acquire (a Canvass winner's price fills it, #278).
--   Actual   = the unit price on the P0 line attached to the Component's product line.
--
-- The P0's price is money, so it is NOT stored on the Requested Item (every requester reads
-- those). It lives on costing_component_costs, a money table, registered like Acquire: read by
-- the Cost and Closed Book tiers, written by the Purchasing band.
--
-- costing_set_p0_price (service role only) is called by the odoo-po-verify edge function after a
-- P0 is attached, with the price the function read in Odoo. It acts as the signed-in Purchasing
-- member so the band triggers apply. A line with no Component stores nothing.
--
-- Additive; idempotent.

alter table public.costing_component_costs
  add column if not exists p0_unit_price numeric;

comment on column public.costing_component_costs.p0_unit_price is
  '#686: the unit price on the P0 line attached to this Component''s product line (the Actual cost). Written only by costing_set_p0_price; the matrix shows it beside Acquire (the Expected cost) and it wins.';

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_component_costs', 'p0_unit_price', '{cost,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_component_costs', 'p0_unit_price', '{purchasing}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

create or replace function public.costing_set_p0_price(
  p_actor_email text,
  p_item_id uuid,
  p_price numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_component uuid;
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

  update public.costing_component_costs
     set p0_unit_price = p_price
   where component_id = v_component;
end;
$$;

comment on function public.costing_set_p0_price(text, uuid, numeric) is
  '#686: server-only (service role). Records the attached P0 line''s unit price as the Actual cost of the Component the product line is linked to, as the signed-in Purchasing member.';

revoke all on function public.costing_set_p0_price(text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.costing_set_p0_price(text, uuid, numeric) to service_role;
