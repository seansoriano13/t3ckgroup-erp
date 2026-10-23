-- The Costing Matrix fills itself from the SOR's products (Costing Desk, 2026-10-22).
--
-- 1. costing_fill_from_sor(opp): every SOR product not yet in the matrix becomes a Tender Line
--    (as "Pick from an SOR line" makes one: name, quantity, unit, Odoo product and the snapshot)
--    with one Component, the product itself. A line with one Component is "priced from its
--    product"; parts are only added when a line is broken down. Re-runnable: a product already in
--    the matrix (by sor_item_id) is left alone, so it doubles as "Refresh from the SOR".
--    Sales or Purchasing may run it on an SOR they read (Purchasing writes no Tender Line column
--    of its own, so the inserts run past the band trigger once the caller is checked).
-- 2. costing_odoo_cost_targets / costing_fill_odoo_costs: server only (the odoo-costing-costs
--    edge function, service role). The function reads each product's cost in Odoo itself and
--    writes it into a Component's blank Odoo unit cost and blank Acquire; nothing the browser
--    sends becomes a cost, and a cost someone typed or a Canvass filled is never overwritten.

-- Who may fill an SOR's matrix, judged for a named employee (the edge function has no JWT).
create or replace function public.costing_actor_can_fill(p_opportunity_id uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees e
    join public.sales_opportunities o on o.id = p_opportunity_id
    where e.id = p_actor
      and not coalesce(e.is_deleted, false)
      and (
        coalesce(e.is_super_admin, false)
        or public._employee_has_purchasing_access(e.id)
        or public.sor_is_deal_team(o, e.id)
        or exists (select 1 from public.costing_signer_lists l where l.list_key = 'final_acquire' and l.employee_id = e.id)
      )
  )
$$;

revoke all on function public.costing_actor_can_fill(uuid, uuid) from public, anon, authenticated;

create or replace function public.costing_fill_from_sor(p_opportunity_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := public.get_employee_id();
  v_matrix uuid;
  v_pos    integer;
  v_line   uuid;
  v_unit   text;
  v_added  integer := 0;
  v_item   record;
begin
  if v_actor is null then
    raise exception 'costing_fill: sign in first' using errcode = '42501';
  end if;
  select m.id into v_matrix from public.costing_matrices m where m.opportunity_id = p_opportunity_id;
  if v_matrix is null then
    raise exception 'costing_fill: this SOR has no Costing Matrix yet' using errcode = '22023';
  end if;
  if not (public.costing_can_read(p_opportunity_id)
          and (public.costing_in_band(p_opportunity_id, 'sales') or public.costing_in_band(p_opportunity_id, 'purchasing'))) then
    raise exception 'costing_fill: only Sales or Purchasing can fill the matrix from the SOR' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('costing_fill:' || v_matrix::text));
  perform set_config('costing.bypass', 'on', true);

  select coalesce(max(l.position), 0) into v_pos from public.costing_tender_lines l where l.matrix_id = v_matrix;

  for v_item in
    select i.*
    from public.sales_opportunity_items i
    where i.opportunity_id = p_opportunity_id
      and not exists (
        select 1 from public.costing_tender_lines l where l.matrix_id = v_matrix and l.sor_item_id = i.id
      )
    order by i.sort_order, i.created_at, i.id
  loop
    v_pos := v_pos + 1;
    v_unit := nullif(btrim(coalesce(v_item.unit, '')), '');
    insert into public.costing_tender_lines (
      matrix_id, position, source, sor_item_id, odoo_product_id, tender_specification, unit, quantity, sor_line_snapshot, created_by
    ) values (
      v_matrix, v_pos, 'sor_line', v_item.id, v_item.odoo_product_id, v_item.product_name, v_unit,
      case when v_item.quantity > 0 then v_item.quantity else 1 end,
      jsonb_build_object('name', v_item.product_name, 'quantity', v_item.quantity, 'unit', v_unit),
      v_actor
    )
    returning id into v_line;

    -- A Component's quantity is for the whole line (its totals are unit x quantity), so the product
    -- carries the line's quantity.
    insert into public.costing_components (tender_line_id, position, name, quantity, unit, odoo_product_id)
    values (v_line, 1, v_item.product_name, case when v_item.quantity > 0 then v_item.quantity else 1 end, v_unit, v_item.odoo_product_id);

    v_added := v_added + 1;
  end loop;

  perform set_config('costing.bypass', '', true);
  return v_added;
end;
$$;

comment on function public.costing_fill_from_sor(uuid) is
  'Costing Desk: adds a Tender Line and one Component (the product) for every SOR product not yet in the matrix; returns how many. Sales or Purchasing on an SOR they read. Re-runnable.';

revoke all on function public.costing_fill_from_sor(uuid) from public, anon;
grant execute on function public.costing_fill_from_sor(uuid) to authenticated;

-- The Components of an SOR's matrix that have an Odoo product and a blank Odoo unit cost or Acquire.
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
  left join public.costing_component_costs cc on cc.component_id = c.id
  where m.opportunity_id = p_opportunity_id
    and c.odoo_product_id is not null
    and (cc.component_id is null or cc.odoo_unit is null or cc.acquire_unit is null);
end;
$$;

revoke all on function public.costing_odoo_cost_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.costing_odoo_cost_targets(uuid, uuid) to service_role;

-- Writes Odoo's cost (p_costs: { "<odoo product id>": cost }) into blank Odoo unit costs and blank
-- Acquires of the SOR's Components. Only a positive cost is written; returns how many Components
-- got a figure.
create or replace function public.costing_fill_odoo_costs(p_actor uuid, p_opportunity_id uuid, p_costs jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_cost   numeric;
  v_filled integer := 0;
begin
  if not public.costing_actor_can_fill(p_opportunity_id, p_actor) then
    raise exception 'costing_fill: only Sales or Purchasing can fill the matrix from Odoo' using errcode = '42501';
  end if;
  for v_target in select * from public.costing_odoo_cost_targets(p_actor, p_opportunity_id) loop
    v_cost := nullif(p_costs ->> v_target.odoo_product_id::text, '')::numeric;
    if v_cost is null or v_cost <= 0 then
      continue;
    end if;
    v_cost := round(v_cost, 2);
    insert into public.costing_component_costs (component_id, odoo_unit, acquire_unit)
    values (v_target.component_id, v_cost, v_cost)
    on conflict (component_id) do update
      set odoo_unit = coalesce(public.costing_component_costs.odoo_unit, excluded.odoo_unit),
          acquire_unit = coalesce(public.costing_component_costs.acquire_unit, excluded.acquire_unit);
    v_filled := v_filled + 1;
  end loop;
  return v_filled;
end;
$$;

revoke all on function public.costing_fill_odoo_costs(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.costing_fill_odoo_costs(uuid, uuid, jsonb) to service_role;
