-- ==============================================================================
-- #322 follow-up: the Purchasing Dashboard's four known gaps
--
-- Redefines `purchasing_dashboard_rows()` (20261021100000); same columns.
--   * On order: one row per IPAS when the item's PO has one (target_kind
--     'ipas'), so it opens the IPAS; per Purchase Request otherwise.
--   * To check: also Received items on an IPAS that no uncancelled Transmittal
--     names yet. Received items with no IPAS stay out (nothing links them to a
--     Transmittal, and older ones predate Transmittals).
--   * Direct requests (no SOR) are counted: opportunity_id is null and
--     project_title reads 'Direct request'.
-- The ageing rules (#262) are applied in the page, from Order Monitoring.
--
-- SAFE TO RUN AT ANY TIME: create or replace of one function, same signature.
-- ==============================================================================

create or replace function public.purchasing_dashboard_rows()
returns table (
  opportunity_id uuid,
  sales_reference text,
  project_title text,
  grp text,
  target_kind text,
  target_id uuid,
  target_label text,
  item_count integer,
  no_canvass_count integer,
  buyer_id uuid,
  canvasser_id uuid,
  since timestamptz,
  request_id uuid
)
language sql
stable
security definer
set search_path = public
as $function$
  with gate as (
    select (
      coalesce(public.has_purchasing_access(), false)
      or coalesce(public.has_finance_access(), false)
      or coalesce(public.is_super_admin(), false)
    ) as ok
  ),
  sors as (
    select o.id, o.sales_reference, o.project_title
      from public.sales_opportunities o, gate
     where gate.ok and not o.is_deleted and not o.is_scratch
  ),
  items as (
    select i.*, r.opportunity_id, r.buyer_id, r.title as request_title,
           coalesce(c.purchasing_incharge_id, cm.purchasing_incharge_id, r.buyer_id) as canvasser_id,
           case when nullif(btrim(i.po_number), '') is not null then public._lc_ipas_for_po(i.po_number) end as ipas_id
      from public.purchase_request_items i
      join public.purchase_requests r on r.id = i.request_id
      cross join gate
      left join public.costing_components c on c.id = i.component_id
      left join public.costing_tender_lines ct on ct.id = c.tender_line_id
      left join public.costing_matrices cm on cm.id = ct.matrix_id
     where gate.ok
       and (r.opportunity_id is null or r.opportunity_id in (select id from sors))
  ),
  matrices as (
    select m.id, m.opportunity_id, m.created_at, m.purchasing_incharge_id, d.verdict, d.decided_at
      from public.costing_matrices m
      join sors s on s.id = m.opportunity_id
      left join lateral (
        select bd.verdict, bd.decided_at from public.costing_bid_decisions bd
         where bd.matrix_id = m.id and bd.cleared_at is null
         order by bd.decided_at desc limit 1
      ) d on true
  ),
  comps as (
    select c.id, c.name, c.created_at, nullif(btrim(c.po_rfq_no), '') as po_rfq_no,
           coalesce(c.purchasing_incharge_id, m.purchasing_incharge_id) as purchasing_incharge_id,
           m.id as matrix_id, m.opportunity_id, m.verdict, m.decided_at,
           cc.acquire_unit,
           (nullif(btrim(c.po_rfq_no), '') is not null
             or exists (select 1 from public.purchase_request_items pi where pi.component_id = c.id and pi.status in ('ordered', 'received'))) as is_ordered
      from public.costing_components c
      join public.costing_tender_lines t on t.id = c.tender_line_id
      join matrices m on m.id = t.matrix_id
      left join public.costing_component_costs cc on cc.component_id = c.id
  ),
  canvasses as (
    select cv.id, cv.number, cv.created_at,
           coalesce(comp_sor.opportunity_id, item_sor.opportunity_id) as opportunity_id,
           coalesce(comp_sor.purchasing_incharge_id, item_sor.buyer_id) as canvasser_id,
           item_sor.buyer_id, item_sor.request_id
      from public.sor_canvasses cv
      left join comps comp_sor on comp_sor.id = cv.component_id
      left join items item_sor on item_sor.id = cv.requested_item_id
     where (comp_sor.id is not null or item_sor.id is not null)
       and not exists (select 1 from public.sor_canvass_offers o where o.canvass_id = cv.id and o.is_winner)
       -- Buying already done without a winner (ordered anyway) is not left to source.
       and not coalesce(comp_sor.is_ordered, false)
       and coalesce(item_sor.status, '') not in ('ordered', 'received', 'from_stock', 'substituted', 'cannot_source', 'cancelled')
  ),
  has_canvass as (
    select i.id as item_id
      from items i
     where exists (select 1 from public.sor_canvasses cv where cv.requested_item_id = i.id or (i.component_id is not null and cv.component_id = i.component_id))
  ),
  r as (
  -- To source: Requested Items, one row per Purchase Request
  select i.opportunity_id, 'to_source'::text as grp, 'purchase_request'::text as target_kind, i.request_id as target_id,
         max(i.request_title) as target_label, count(*)::int as item_count, 0 as no_canvass_count,
         max(i.buyer_id::text)::uuid as buyer_id, max(i.canvasser_id::text)::uuid as canvasser_id, min(i.created_at) as since, i.request_id as request_id
    from items i
   where i.status in ('requested', 'to_order')
   group by i.opportunity_id, i.request_id
  union all
  -- To source: Canvasses with no winner
  select c.opportunity_id, 'to_source', 'canvass', c.id, c.number, 1, 0, c.buyer_id, c.canvasser_id, c.created_at, c.request_id
    from canvasses c
  union all
  -- To price: unpriced Components, plus the matrix when it still needs a decision
  select m.opportunity_id, 'to_price', 'costing_matrix', m.opportunity_id, null,
         ((select count(*) from comps c where c.matrix_id = m.id and c.acquire_unit is null)
           + case when m.verdict is null or m.verdict = 'revise' then 1 else 0 end)::int,
         0, null, m.purchasing_incharge_id, m.created_at, null
    from matrices m
   where coalesce(m.verdict, '') <> 'no_go'
     and ((m.verdict is null or m.verdict = 'revise')
          or exists (select 1 from comps c where c.matrix_id = m.id and c.acquire_unit is null))
  union all
  -- To order: priced, decided Go, no PO yet
  select c.opportunity_id, 'to_order', 'costing_matrix', c.opportunity_id, null,
         count(*)::int, 0, null, max(c.purchasing_incharge_id::text)::uuid, min(c.decided_at), null
    from comps c
   where c.verdict = 'go' and c.acquire_unit is not null and not c.is_ordered
   group by c.opportunity_id
  union all
  -- On order: Ordered, not yet Received. One row per IPAS when the PO has one,
  -- else per Purchase Request.
  select i.opportunity_id, 'on_order',
         case when i.ipas_id is not null then 'ipas' else 'purchase_request' end,
         coalesce(i.ipas_id, i.request_id),
         coalesce((select ip.number from public.ipas ip where ip.id = i.ipas_id), max(i.request_title)),
         count(*)::int,
         count(*) filter (where i.id not in (select item_id from has_canvass))::int,
         max(i.buyer_id::text)::uuid, max(i.canvasser_id::text)::uuid, min(coalesce(i.status_changed_at, i.created_at)),
         max(i.request_id::text)::uuid
    from items i
   where i.status = 'ordered'
   group by i.opportunity_id, i.ipas_id, coalesce(i.ipas_id, i.request_id)
  union all
  -- To check: submitted Transmittals moving through their checks
  select ts.opportunity_id, 'to_check', 'transmittal', t.id, t.number,
         greatest(1, (select count(*) from public.transmittal_lines l where l.transmittal_id = t.id and l.opportunity_id = ts.opportunity_id))::int,
         0, null, null, coalesce(t.submitted_at, t.created_at), null
    from public.transmittals t
    join public.transmittal_sors ts on ts.transmittal_id = t.id
    join sors s on s.id = ts.opportunity_id
   where t.state in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection', 'awaiting_check')
  union all
  -- To check: Received on an IPAS that no Transmittal names yet. Items with no
  -- IPAS are left out: nothing links them to a Transmittal, and older ones were
  -- received before Transmittals existed.
  select i.opportunity_id, 'to_check', 'ipas', i.ipas_id,
         (select ip.number from public.ipas ip where ip.id = i.ipas_id),
         count(*)::int, 0,
         max(i.buyer_id::text)::uuid, max(i.canvasser_id::text)::uuid, min(coalesce(i.status_changed_at, i.created_at)),
         max(i.request_id::text)::uuid
    from items i
   where i.status = 'received' and i.ipas_id is not null
     and not exists (
       select 1 from public.transmittal_ipas ti join public.transmittals t on t.id = ti.transmittal_id
        where ti.ipas_id = i.ipas_id and t.state <> 'cancelled')
   group by i.opportunity_id, i.ipas_id
  )
  -- The SOR's name is filled once here rather than in each branch above.
  select r.opportunity_id, s.sales_reference, coalesce(s.project_title, case when r.opportunity_id is null then 'Direct request' end), r.grp, r.target_kind, r.target_id, r.target_label,
         r.item_count, r.no_canvass_count, r.buyer_id, r.canvasser_id, r.since, r.request_id
    from r left join sors s on s.id = r.opportunity_id
   where r.item_count > 0
$function$;

revoke all on function public.purchasing_dashboard_rows() from public, anon;
grant execute on function public.purchasing_dashboard_rows() to authenticated;

