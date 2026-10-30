-- ==============================================================================
-- Item road: which Requested Items buy for which Component, in one place.
--
-- Until now a Requested Item counted for a Component only when it named it
-- (purchase_request_items.component_id, set when Purchasing adds items "from the
-- S0 Evaluation"). Items opened from the SOR's own lines (source 'sor_line', the
-- usual way, e.g. SOR-250's twelve) name no Component, so the S0 Evaluation never
-- saw them bought, ordered or paid, though they buy exactly the same S0 line.
--
-- _costing_item_components(opportunity) is now the one answer, and the three reads
-- that asked "pri.component_id = c.id" ask it instead:
--   1. an item that names a Component counts for it (unchanged);
--   2. an item that names none, on a Purchase Request of the same SOR, counts for
--      the Component of the Tender Line that points at the same SOR line, when that
--      Tender Line has exactly one Component. With two or more it is left out:
--      which part it buys is a person's call, not a guess.
--
-- Redefined, same signatures and same rows otherwise:
--   costing_component_purchases, costing_component_requests, costing_landed_costs.
-- Nothing is written to any table.
--
-- SAFE TO RUN AT ANY TIME: one new internal function and three replaced reads.
-- Idempotent.
-- ==============================================================================

create or replace function public._costing_item_components(p_opportunity_id uuid)
returns table (item_id uuid, component_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  with comps as (
    select c.id, c.tender_line_id, t.sor_item_id
    from public.costing_components c
    join public.costing_tender_lines t on t.id = c.tender_line_id
    join public.costing_matrices m on m.id = t.matrix_id
    where m.opportunity_id = p_opportunity_id
  ),
  sole as (
    select min(comps.id::text)::uuid as component_id, comps.sor_item_id
    from comps
    where comps.sor_item_id is not null
    group by comps.tender_line_id, comps.sor_item_id
    having count(*) = 1
  )
  select pri.id, pri.component_id
  from public.purchase_request_items pri
  join comps on comps.id = pri.component_id
  union all
  select pri.id, sole.component_id
  from public.purchase_request_items pri
  join public.purchase_requests r on r.id = pri.request_id and r.opportunity_id = p_opportunity_id
  join sole on sole.sor_item_id = pri.sor_item_id
  where pri.component_id is null
$$;

comment on function public._costing_item_components(uuid) is
  'Item road: each Requested Item that buys for a Component of the SOR''s S0 Evaluation. One that names a Component counts for it; one that names none, on a request of the same SOR, counts for the sole Component of the Tender Line on the same SOR line. Internal; callers gate.';

revoke all on function public._costing_item_components(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 1. costing_component_purchases
-- ------------------------------------------------------------------------------
create or replace function public.costing_component_purchases(p_opportunity_id uuid)
returns table (component_id uuid, po_rfq_no text, ordered_quantity numeric, requests jsonb, ipas jsonb)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with comps as (
    select c.id, nullif(btrim(c.po_rfq_no), '') as po_rfq_no
    from public.costing_components c
    join public.costing_tender_lines t on t.id = c.tender_line_id
    join public.costing_matrices m on m.id = t.matrix_id
    where m.opportunity_id = p_opportunity_id
      and public.costing_can_read(p_opportunity_id)
  ),
  linked as (
    select ic.component_id, pri.id, pri.request_id, pri.name, pri.po_number, pri.status, pri.quantity, pri.odoo_po_line_ids, pri.created_at
    from public._costing_item_components(p_opportunity_id) ic
    join public.purchase_request_items pri on pri.id = ic.item_id
  )
  select
    comps.id,
    comps.po_rfq_no,
    (select coalesce(sum(l.quantity), 0) from linked l
      where l.component_id = comps.id and l.status in ('purchased', 'received')),
    coalesce((
      select jsonb_agg(jsonb_build_object('item_id', l.id, 'request_id', l.request_id, 'name', l.name, 'po_number', nullif(btrim(l.po_number), ''), 'status', l.status, 'odoo_po_line_ids', coalesce(to_jsonb(l.odoo_po_line_ids), '[]'::jsonb))
        order by l.created_at)
      from linked l
      where l.component_id = comps.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('po_number', po.po_number, 'ipas_id', ip.id, 'number', ip.number, 'state', ip.state)
        order by po.po_number)
      from (
        select distinct p.po_number from (
          select nullif(btrim(l.po_number), '') as po_number
          from linked l
          where l.component_id = comps.id and l.status <> 'cancelled'
          union select comps.po_rfq_no
        ) p
        where p.po_number is not null
      ) po
      left join public.ipas ip on ip.id = public._lc_ipas_for_po(po.po_number)
    ), '[]'::jsonb)
  from comps
$function$;

-- ------------------------------------------------------------------------------
-- 2. costing_component_requests
-- ------------------------------------------------------------------------------
create or replace function public.costing_component_requests(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_matrix uuid;
begin
  if not public.costing_can_read(p_opportunity_id) then
    return null;
  end if;
  select id into v_matrix from public.costing_matrices where opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('id', i.id, 'component_id', ic.component_id, 'status', i.status, 'request_id', i.request_id)
        order by i.created_at, i.id
      ),
      '[]'::jsonb
    )
    from public._costing_item_components(p_opportunity_id) ic
    join public.purchase_request_items i on i.id = ic.item_id
  );
end;
$function$;

-- ------------------------------------------------------------------------------
-- 3. costing_landed_costs
-- ------------------------------------------------------------------------------
create or replace function public.costing_landed_costs(p_opportunity_id uuid)
returns table (component_id uuid, total_php numeric, unit_php numeric, mark text, blank_reason text, ordered_quantity numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with comps as (
    select c.id, c.quantity
    from public.costing_components c
    join public.costing_tender_lines t on t.id = c.tender_line_id
    join public.costing_matrices m on m.id = t.matrix_id
    where m.opportunity_id = p_opportunity_id
      and public.costing_can_read_cost(p_opportunity_id)
  ),
  -- Purchased and Received claim; Cancelled, Cancelled and Cannot source claim nothing.
  live as (
    select pri.id, pri.quantity, pri.po_number, coalesce(pri.odoo_po_line_ids, '{}') as picked
    from public.purchase_request_items pri
    where pri.status in ('purchased', 'received')
  ),
  items as (
    select live.*, ic.component_id, public._lc_ipas_for_po(live.po_number) as ipas_id
    from live
    join public._costing_item_components(p_opportunity_id) ic on ic.item_id = live.id
    join comps on comps.id = ic.component_id
  ),
  claims as (
    select items.id as item_id, items.component_id, items.quantity, items.ipas_id, pick.lid
    from items
    cross join lateral (select distinct u.lid from unnest(items.picked) as u(lid)) as pick
    where items.ipas_id is not null
  ),
  lc as (
    select s.ipas_id, l.odoo_line_id, l.total_php, l.mark
    from (select distinct claims.ipas_id from claims) s
    cross join lateral public.ipas_line_landed_costs(s.ipas_id) l
  ),
  -- Every live Requested Item, on any SOR, that picked the same line.
  claimants as (
    select k.ipas_id, k.lid, count(*) as n, sum(live.quantity) as q
    from (select distinct claims.ipas_id, claims.lid from claims) k
    join public.ipas ip on ip.id = k.ipas_id
    join live on btrim(live.po_number) = ip.po_number and k.lid = any (live.picked)
    group by k.ipas_id, k.lid
  ),
  shares as (
    select
      claims.component_id,
      lc.odoo_line_id is null as missing,
      lc.mark,
      case when coalesce(cm.n, 1) <= 1 then lc.total_php
           else lc.total_php * claims.quantity / nullif(cm.q, 0) end as share
    from claims
    left join lc on lc.ipas_id = claims.ipas_id and lc.odoo_line_id = claims.lid
    left join claimants cm on cm.ipas_id = claims.ipas_id and cm.lid = claims.lid
  ),
  per as (
    select
      comps.id,
      comps.quantity,
      (select count(*) from items where items.component_id = comps.id) as n_items,
      (select coalesce(sum(items.quantity), 0) from items where items.component_id = comps.id) as ordered,
      exists (
        select 1 from items
        where items.component_id = comps.id and (items.ipas_id is null or cardinality(items.picked) = 0)
      ) as not_picked,
      exists (select 1 from shares where shares.component_id = comps.id and shares.missing) as removed,
      exists (select 1 from shares where shares.component_id = comps.id and shares.mark = 'unavailable') as unavailable,
      (select sum(shares.share) from shares where shares.component_id = comps.id) as total,
      (select coalesce(bool_and(shares.mark = 'final'), false) from shares where shares.component_id = comps.id) as final
    from comps
  )
  select
    per.id,
    case when r.reason is null then round(per.total, 2) end,
    case when r.reason is null then round(per.total / nullif(per.quantity, 0), 2) end,
    case when r.reason is null then case when per.final then 'final' else 'provisional' end end,
    r.reason,
    per.ordered
  from per
  cross join lateral (
    select case
      when per.n_items = 0 then 'not_ordered'
      when per.not_picked then 'po_line_not_picked'
      when per.removed then 'line_removed'
      when per.unavailable or per.total is null then 'landed_cost_unavailable'
    end as reason
  ) r
$function$;
