-- #961 (spec #955): the Odoo column of the S0 Evaluation is the Odoo selling price (SRP, `list_price`),
-- no longer Odoo's cost. The column stays `odoo_unit` (tiers and bands unchanged); only its meaning moves.
--
-- 1. costing_odoo_cost_targets: every Component with an Odoo product, so the SRP is pulled on every
--    open and Refresh (the cost fill below still writes only blank costs).
-- 2. costing_fill_odoo_costs(p_actor, p_opportunity_id, p_costs, p_srps): p_costs ({ "<product id>": cost })
--    still fills a blank Acquire (acquire_source = odoo, #701); p_srps ({ "<product id>": list_price })
--    sets odoo_unit as is. A product with no figure leaves the stored value alone (never zero).
-- 3. Stored odoo_unit values on lines linked to a product were Odoo costs: cleared, pulled again as SRP.
--    Values on lines with no product were typed by hand and are kept.

create or replace function public.costing_odoo_cost_targets(p_actor uuid, p_opportunity_id uuid)
returns table (component_id uuid, odoo_product_id integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.costing_actor_can_fill(p_opportunity_id, p_actor) then
    raise exception 'costing_fill: only Sales or Purchasing can fill the matrix from Odoo' using errcode = '42501';
  end if;
  return query
  select c.id, c.odoo_product_id
  from public.costing_components c
  join public.costing_tender_lines l on l.id = c.tender_line_id
  join public.costing_matrices m on m.id = l.matrix_id
  where m.opportunity_id = p_opportunity_id
    and c.odoo_product_id is not null;
end;
$$;

revoke all on function public.costing_odoo_cost_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.costing_odoo_cost_targets(uuid, uuid) to service_role;

drop function if exists public.costing_fill_odoo_costs(uuid, uuid, jsonb);

create or replace function public.costing_fill_odoo_costs(p_actor uuid, p_opportunity_id uuid, p_costs jsonb, p_srps jsonb default '{}'::jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_target record;
  v_cost   numeric;
  v_srp    numeric;
  v_filled integer := 0;
begin
  if not public.costing_actor_can_fill(p_opportunity_id, p_actor) then
    raise exception 'costing_fill: only Sales or Purchasing can fill the matrix from Odoo' using errcode = '42501';
  end if;
  perform set_config('costing.fill_source', 'odoo', true);
  for v_target in select * from public.costing_odoo_cost_targets(p_actor, p_opportunity_id) loop
    v_cost := nullif(coalesce(p_costs, '{}'::jsonb) ->> v_target.odoo_product_id::text, '')::numeric;
    v_srp  := nullif(coalesce(p_srps, '{}'::jsonb) ->> v_target.odoo_product_id::text, '')::numeric;
    if v_cost is not null and v_cost <= 0 then v_cost := null; end if;
    if v_srp is not null and v_srp <= 0 then v_srp := null; end if;
    if v_cost is null and v_srp is null then
      continue;
    end if;
    v_cost := round(v_cost, 2);
    v_srp  := round(v_srp, 2);
    insert into public.costing_component_costs (component_id, odoo_unit, acquire_unit)
    values (v_target.component_id, v_srp, v_cost)
    on conflict (component_id) do update
      set odoo_unit = coalesce(excluded.odoo_unit, public.costing_component_costs.odoo_unit),
          acquire_unit = coalesce(public.costing_component_costs.acquire_unit, excluded.acquire_unit);
    v_filled := v_filled + 1;
  end loop;
  perform set_config('costing.fill_source', '', true);
  return v_filled;
end;
$function$;

revoke all on function public.costing_fill_odoo_costs(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.costing_fill_odoo_costs(uuid, uuid, jsonb, jsonb) to service_role;

update public.costing_component_costs cc
   set odoo_unit = null
  from public.costing_components c
 where c.id = cc.component_id
   and c.odoo_product_id is not null
   and cc.odoo_unit is not null;
