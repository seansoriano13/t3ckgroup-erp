-- ==============================================================================
-- #690 (spec #675): the Purchasing Dashboard's groups use the new status words.
--
-- Redefines `purchasing_dashboard_rows()` (20261021110000, status words renamed by #676).
-- The item groups now read the stored line status, one word for one thing:
--   not_checked       Requested Items at Not checked
--   to_purchase       Requested Items at To purchase (the old matrix "priced, no PO" branch is gone:
--                     the product line is the truth now)
--   still_canvassing  Requested Items at Still canvassing, plus any Component Canvass with no winner
--   on_order          Requested Items at Purchased (shown as "Purchased (not received)"); a line
--                     leaves it once Odoo says Received. Rows carry a delivery note.
-- Unchanged: to_price (Components with no Acquire, matrix waiting on a Bid Decision) and to_check
-- (Transmittals moving through their checks).
-- Groups are derived here and never stored. New column: delivery_note, so the return type changes
-- and the function is dropped and recreated (same grants).
--
-- SAFE TO RUN AT ANY TIME: one read-only function.
-- ==============================================================================

drop function if exists public.purchasing_dashboard_rows();

create function public.purchasing_dashboard_rows()
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
  request_id uuid,
  delivery_note text
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
             or exists (select 1 from public.purchase_request_items pi where pi.component_id = c.id and pi.status in ('purchased', 'received'))) as is_ordered
      from public.costing_components c
      join public.costing_tender_lines t on t.id = c.tender_line_id
      join matrices m on m.id = t.matrix_id
      left join public.costing_component_costs cc on cc.component_id = c.id
  ),
  -- A Canvass on a Component alone (no product line) with no winner. A Canvass on a line is
  -- counted through the line's own status (Still canvassing).
  canvasses as (
    select cv.id, cv.number, cv.created_at, comp_sor.opportunity_id,
           comp_sor.purchasing_incharge_id as canvasser_id
      from public.sor_canvasses cv
      join comps comp_sor on comp_sor.id = cv.component_id
     where cv.requested_item_id is null
       and not exists (select 1 from public.sor_canvass_offers o where o.canvass_id = cv.id and o.is_winner)
       and not comp_sor.is_ordered
  ),
  has_canvass as (
    select i.id as item_id
      from items i
     where exists (select 1 from public.sor_canvasses cv where cv.requested_item_id = i.id or (i.component_id is not null and cv.component_id = i.component_id))
  ),
  r as (
  -- Not checked: nobody has looked yet. One row per Purchase Request.
  select i.opportunity_id, 'not_checked'::text as grp, 'purchase_request'::text as target_kind, i.request_id as target_id,
         max(i.request_title) as target_label, count(*)::int as item_count, 0 as no_canvass_count,
         max(i.buyer_id::text)::uuid as buyer_id, max(i.canvasser_id::text)::uuid as canvasser_id, min(i.created_at) as since, i.request_id as request_id,
         null::text as delivery_note
    from items i
   where i.status = 'not_checked'
   group by i.opportunity_id, i.request_id
  union all
  -- Still canvassing: lines whose Canvass is open, one row per Purchase Request
  select i.opportunity_id, 'still_canvassing', 'purchase_request', i.request_id,
         max(i.request_title), count(*)::int, 0,
         max(i.buyer_id::text)::uuid, max(i.canvasser_id::text)::uuid, min(coalesce(i.status_changed_at, i.created_at)), i.request_id,
         null::text
    from items i
   where i.status = 'still_canvassing'
   group by i.opportunity_id, i.request_id
  union all
  -- Still canvassing: a Component Canvass with no winner and no line
  select c.opportunity_id, 'still_canvassing', 'canvass', c.id, c.number, 1, 0, null, c.canvasser_id, c.created_at, null,
         null::text
    from canvasses c
  union all
  -- To price: unpriced Components, plus the matrix when it still needs a decision
  select m.opportunity_id, 'to_price', 'costing_matrix', m.opportunity_id, null,
         ((select count(*) from comps c where c.matrix_id = m.id and c.acquire_unit is null)
           + case when m.verdict is null or m.verdict = 'revise' then 1 else 0 end)::int,
         0, null, m.purchasing_incharge_id, m.created_at, null,
         null::text
    from matrices m
   where coalesce(m.verdict, '') <> 'no_go'
     and ((m.verdict is null or m.verdict = 'revise')
          or exists (select 1 from comps c where c.matrix_id = m.id and c.acquire_unit is null))
  union all
  -- To purchase: lines that need buying and have no confirmed P0 yet. One row per Purchase Request.
  select i.opportunity_id, 'to_purchase', 'purchase_request', i.request_id,
         max(i.request_title), count(*)::int, 0,
         max(i.buyer_id::text)::uuid, max(i.canvasser_id::text)::uuid, min(coalesce(i.status_changed_at, i.created_at)), i.request_id,
         null::text
    from items i
   where i.status = 'to_purchase'
   group by i.opportunity_id, i.request_id
  union all
  -- Purchased (not received): confirmed on a P0, not all here yet. One row per IPAS when the
  -- P0 has one, else per Purchase Request. The delivery note says how much arrived, or when.
  select i.opportunity_id, 'on_order',
         case when i.ipas_id is not null then 'ipas' else 'purchase_request' end,
         coalesce(i.ipas_id, i.request_id),
         coalesce((select ip.number from public.ipas ip where ip.id = i.ipas_id), max(i.request_title)),
         count(*)::int,
         count(*) filter (where i.id not in (select item_id from has_canvass))::int,
         max(i.buyer_id::text)::uuid, max(i.canvasser_id::text)::uuid, min(coalesce(i.status_changed_at, i.created_at)),
         max(i.request_id::text)::uuid,
         case
           when count(*) = 1 then
             case
               when coalesce(max(i.po_received), 0) > 0 and coalesce(max(i.po_received), 0) < coalesce(max(i.po_ordered), 0)
                 then trim_scale(max(i.po_received))::text || ' of ' || trim_scale(max(i.po_ordered))::text || ' received'
               when max(i.po_eta) is not null then 'Not received yet · ETA ' || to_char(max(i.po_eta), 'Mon FMDD')
               else 'Not received yet · no ETA set'
             end
           else concat_ws(' · ',
             case when count(*) filter (where coalesce(i.po_received, 0) = 0) > 0
                  then (count(*) filter (where coalesce(i.po_received, 0) = 0))::text || ' not received yet' end,
             case when count(*) filter (where coalesce(i.po_received, 0) > 0) > 0
                  then (count(*) filter (where coalesce(i.po_received, 0) > 0))::text || ' part received' end,
             case when min(i.po_eta) filter (where coalesce(i.po_received, 0) = 0) is not null
                  then 'ETA ' || to_char(min(i.po_eta) filter (where coalesce(i.po_received, 0) = 0), 'Mon FMDD') end)
         end
    from items i
   where i.status = 'purchased'
   group by i.opportunity_id, i.ipas_id, coalesce(i.ipas_id, i.request_id)
  union all
  -- To check: submitted Transmittals moving through their checks
  select ts.opportunity_id, 'to_check', 'transmittal', t.id, t.number,
         greatest(1, (select count(*) from public.transmittal_lines l where l.transmittal_id = t.id and l.opportunity_id = ts.opportunity_id))::int,
         0, null, null, coalesce(t.submitted_at, t.created_at), null,
         null::text
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
         max(i.request_id::text)::uuid,
         null::text
    from items i
   where i.status = 'received' and i.ipas_id is not null
     and not exists (
       select 1 from public.transmittal_ipas ti join public.transmittals t on t.id = ti.transmittal_id
        where ti.ipas_id = i.ipas_id and t.state <> 'cancelled')
   group by i.opportunity_id, i.ipas_id
  )
  -- The SOR's name is filled once here rather than in each branch above.
  select r.opportunity_id, s.sales_reference, coalesce(s.project_title, case when r.opportunity_id is null then 'Direct request' end), r.grp, r.target_kind, r.target_id, r.target_label,
         r.item_count, r.no_canvass_count, r.buyer_id, r.canvasser_id, r.since, r.request_id, r.delivery_note
    from r left join sors s on s.id = r.opportunity_id
   where r.item_count > 0
$function$;

revoke all on function public.purchasing_dashboard_rows() from public, anon;
grant execute on function public.purchasing_dashboard_rows() to authenticated;
