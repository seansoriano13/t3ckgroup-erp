-- ==============================================================================
-- #322: the Purchasing Dashboard, where every project's buying stands
--
-- `purchasing_dashboard_rows()` returns one row per record that owns a piece of
-- outstanding buying, tagged with the group it is in:
--
--   to_source  Requested Items at Requested or To order (one row per Purchase
--              Request), and each Canvass with no winning Offer
--   to_price   Components with no Acquire, plus the matrix itself when it has
--              no live Bid Decision or its live one is Revise (one row per
--              matrix). A No Go matrix has nothing left to price or order.
--   to_order   Components priced on a matrix with a live Go, with no PO yet
--              (no PO/RFQ number and nothing Ordered or Received against them)
--   on_order   Requested Items Ordered and not yet Received (one row per
--              Purchase Request)
--   to_check   Transmittals naming the SOR that are submitted and not closed
--
-- The groups are DERIVED here and stored nowhere (ADR 0023). One SOR returns
-- rows in as many groups as apply. Only SORs that are not deleted and not
-- scratch are counted; Direct requests (no SOR) are left out.
--
-- Readers: Purchasing access, Finance access, Super Admins. Anyone else gets no
-- rows. Counts and ids only: no money column is returned, so no Closed Book
-- tier (#319) is needed to read it.
--
-- `request_id` is the Purchase Request a row opens (also for a Canvass on a
-- Requested Item); `buyer_id`, `canvasser_id`, `since` and `no_canvass_count` feed the filters.
-- The Canvasser is derived as CONTEXT.md defines it: the Component's
-- Purchasing Incharge (else the matrix's), else the Purchase Request's Buyer.
-- `since` is when the outstanding work began: the item's request or status
-- change, the Canvass or matrix opening, or the Go decision for To order.
--
-- SAFE TO RUN AT ANY TIME: one new function; nothing existing is redefined.
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
           coalesce(c.purchasing_incharge_id, cm.purchasing_incharge_id, r.buyer_id) as canvasser_id
      from public.purchase_request_items i
      join public.purchase_requests r on r.id = i.request_id
      join sors s on s.id = r.opportunity_id
      left join public.costing_components c on c.id = i.component_id
      left join public.costing_tender_lines ct on ct.id = c.tender_line_id
      left join public.costing_matrices cm on cm.id = ct.matrix_id
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
  -- On order: Ordered, not yet Received, one row per Purchase Request
  select i.opportunity_id, 'on_order', 'purchase_request', i.request_id,
         max(i.request_title), count(*)::int,
         count(*) filter (where i.id not in (select item_id from has_canvass))::int,
         max(i.buyer_id::text)::uuid, max(i.canvasser_id::text)::uuid, min(coalesce(i.status_changed_at, i.created_at)), i.request_id
    from items i
   where i.status = 'ordered'
   group by i.opportunity_id, i.request_id
  union all
  -- To check: submitted Transmittals moving through their checks
  select ts.opportunity_id, 'to_check', 'transmittal', t.id, t.number,
         greatest(1, (select count(*) from public.transmittal_lines l where l.transmittal_id = t.id and l.opportunity_id = ts.opportunity_id))::int,
         0, null, null, coalesce(t.submitted_at, t.created_at), null
    from public.transmittals t
    join public.transmittal_sors ts on ts.transmittal_id = t.id
    join sors s on s.id = ts.opportunity_id
   where t.state in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection', 'awaiting_check')
  )
  -- The SOR's name is filled once here rather than in each branch above.
  select r.opportunity_id, s.sales_reference, s.project_title, r.grp, r.target_kind, r.target_id, r.target_label,
         r.item_count, r.no_canvass_count, r.buyer_id, r.canvasser_id, r.since, r.request_id
    from r join sors s on s.id = r.opportunity_id
   where r.item_count > 0
$function$;

revoke all on function public.purchasing_dashboard_rows() from public, anon;
grant execute on function public.purchasing_dashboard_rows() to authenticated;

