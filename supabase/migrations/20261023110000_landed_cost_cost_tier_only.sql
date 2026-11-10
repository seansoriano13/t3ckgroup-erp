-- #546 (spec #544): Landed Cost and the suppliers' Offer prices are cost. Only the closed_book and
-- cost tiers may read them; the price side (Deal Team, Always sees) is refused by the database.
--
--   costing_can_read_cost(opp)            (new)  closed_book, cost
--   costing_can_read_money(opp)           kept   closed_book, cost, price; no caller left (price-side check)
--   costing_landed_costs(opp)             moved  to costing_can_read_cost
--   ipas_summaries_for_sor(opp)           moved  Landed Cost total and mark use costing_can_read_cost
--   canvass_subject_can_read_money(c, r)  moved  Component branch uses costing_can_read_cost; the Offer
--                                                price row policies and the read function follow it
--
-- costing_tier itself is untouched. No schema change.

create or replace function public.costing_can_read_cost(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.costing_tier(p_opportunity_id) in ('closed_book', 'cost'), false)
$$;

comment on function public.costing_can_read_cost(uuid) is
  '#546: the caller''s Costing tier on the SOR is closed_book or cost. Landed Cost and Canvass Offer prices are cost; the price tier never reads them.';

revoke all on function public.costing_can_read_cost(uuid) from public, anon;
grant execute on function public.costing_can_read_cost(uuid) to authenticated;

create or replace function public.canvass_subject_can_read_money(p_component_id uuid, p_requested_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_component_id is not null then
      coalesce(public.costing_can_read_cost(public.canvass_component_opportunity(p_component_id)), false)
    when p_requested_item_id is not null then
      public.canvass_subject_can_read(null, p_requested_item_id)
      and (
        coalesce(public.has_purchasing_access(), false)
        or coalesce(public.has_finance_access(), false)
        or coalesce(public.is_super_admin(), false)
      )
    else false
  end
$$;

create or replace function public.costing_landed_costs(p_opportunity_id uuid)
returns table (
  component_id uuid,
  total_php numeric,
  unit_php numeric,
  mark text,
  blank_reason text,
  ordered_quantity numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with comps as (
    select c.id, c.quantity
    from public.costing_components c
    join public.costing_tender_lines t on t.id = c.tender_line_id
    join public.costing_matrices m on m.id = t.matrix_id
    where m.opportunity_id = p_opportunity_id
      and public.costing_can_read_cost(p_opportunity_id)
  ),
  -- Ordered and Received claim; Cancelled, Substituted and Cannot source claim nothing.
  live as (
    select pri.id, pri.component_id, pri.quantity, pri.po_number, coalesce(pri.odoo_po_line_ids, '{}') as picked
    from public.purchase_request_items pri
    where pri.status in ('ordered', 'received')
  ),
  items as (
    select live.*, public._lc_ipas_for_po(live.po_number) as ipas_id
    from live
    join comps on comps.id = live.component_id
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
$$;

comment on function public.costing_landed_costs(uuid) is
  '#283: each Component''s Landed Cost, summed from what its Ordered and Received Requested Items claim from their picked PO lines on the live IPAS (a shared line splits by quantity; a sole claimant takes the whole line). final only when every IPAS it draws from is final. Blank, never partial: blank_reason not_ordered | po_line_not_picked | line_removed | landed_cost_unavailable. Cost tiers only (closed_book, cost); no rows otherwise. Never grants the IPAS.';

revoke all on function public.costing_landed_costs(uuid) from public, anon;
grant execute on function public.costing_landed_costs(uuid) to authenticated;

drop function if exists public.ipas_summaries_for_sor(uuid);

create function public.ipas_summaries_for_sor(p_opportunity_id uuid)
returns table (
  ipas_id uuid,
  number text,
  po_number text,
  supplier text,
  purpose text,
  state text,
  buyer_track jsonb,
  computation_status text,
  signoffs jsonb,
  landed_cost_total_php numeric,
  landed_cost_mark text
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    i.id,
    i.number,
    i.po_number,
    nullif(btrim(i.odoo_copy #>> '{supplier,name}'), ''),
    i.purpose,
    i.state,
    case when i.source = 'import'
      then jsonb_build_array(
        jsonb_build_object('key', 'purchase_order', 'ticked', coalesce(o.po_state in ('purchase', 'done'), false), 'partial', false),
        jsonb_build_object('key', 'with_pop', 'ticked', pop.has_proof, 'partial', false),
        jsonb_build_object('key', 'import_clearance', 'ticked', i.import_clearance_on is not null, 'partial', false),
        jsonb_build_object('key', 'delivered', 'ticked', i.delivered_on is not null or tg.delivered, 'partial', false),
        jsonb_build_object('key', 'received_in_odoo', 'ticked', rs.received_state = 'received', 'partial', rs.received_state = 'partial'),
        jsonb_build_object('key', 'create_bill', 'ticked', o.bill_count > 0, 'partial', false),
        jsonb_build_object('key', 'actual_checking', 'ticked', i.actual_checking_by is not null or tg.checked, 'partial', false)
      )
      else jsonb_build_array(
        jsonb_build_object('key', 'purchase_order', 'ticked', coalesce(o.po_state in ('purchase', 'done'), false), 'partial', false),
        jsonb_build_object('key', 'with_pop', 'ticked', pop.has_proof, 'partial', false),
        jsonb_build_object('key', 'delivered', 'ticked', i.delivered_on is not null or tg.delivered, 'partial', false),
        jsonb_build_object('key', 'received_in_odoo', 'ticked', rs.received_state = 'received', 'partial', rs.received_state = 'partial'),
        jsonb_build_object('key', 'create_bill', 'ticked', o.bill_count > 0, 'partial', false),
        jsonb_build_object('key', 'actual_checking', 'ticked', i.actual_checking_by is not null or tg.checked, 'partial', false)
      )
    end,
    i.computation_status,
    jsonb_build_object(
      '1', jsonb_build_object(
        'prepared', '1:prepared' = any (lv.live),
        'approved', '1:approved' = any (lv.live)
      ),
      '3', jsonb_build_object(
        'prepared', '3:prepared' = any (lv.live),
        'approved', '3:approved' = any (lv.live)
      ),
      '7', jsonb_build_object(
        'received', '7:received' = any (lv.live),
        'noted', '7:noted' = any (lv.live),
        'checked', '7:checked' = any (lv.live),
        'approved', '7:approved' = any (lv.live)
      )
    ),
    lcost.total,
    lcost.mark
  from public.ipas i
  cross join lateral (
    select
      i.odoo_copy #>> '{po,state}' as po_state,
      i.odoo_copy #>> '{receipts,status}' as receipts_status,
      case when (i.odoo_copy #>> '{receipts,total}') ~ '^[0-9]+(\.[0-9]+)?$'
        then (i.odoo_copy #>> '{receipts,total}')::numeric else 0 end as receipts_total,
      case when (i.odoo_copy #>> '{receipts,done}') ~ '^[0-9]+(\.[0-9]+)?$'
        then (i.odoo_copy #>> '{receipts,done}')::numeric else 0 end as receipts_done,
      case when (i.odoo_copy #>> '{bills,count}') ~ '^[0-9]+(\.[0-9]+)?$'
        then (i.odoo_copy #>> '{bills,count}')::numeric else 0 end as bill_count
  ) o
  cross join lateral (
    select case
      when o.receipts_status = 'partial' then 'partial'
      when o.receipts_status = 'full' or (o.receipts_total > 0 and o.receipts_done >= o.receipts_total) then 'received'
      when o.receipts_done > 0 then 'partial'
      else 'none'
    end as received_state
  ) rs
  cross join lateral (
    select exists (
      select 1 from public.ipas_payments p
      where p.ipas_id = i.id and coalesce(p.proof_url, '') <> ''
    ) as has_proof
  ) pop
  cross join lateral (
    select coalesce(array_agg(so.section::text || ':' || so.role), '{}'::text[]) as live
    from public.ipas_signoffs so
    where so.ipas_id = i.id and so.cleared_at is null
  ) lv
  cross join lateral (
    select
      coalesce(bool_or(first_done), false) as delivered,
      coalesce(count(*) > 0 and bool_and(check_done), false) as checked
    from (
      select
        exists (
          select 1 from public.transmittal_stages st
           where st.transmittal_id = t.id and st.completed_at is not null
             and st.stage = case when t.check_warehouse then 'warehouse_checking' else 'technical_inspection' end
        ) as first_done,
        exists (
          select 1 from public.transmittal_stages st
           where st.transmittal_id = t.id and st.completed_at is not null
             and st.stage = case when t.check_technical then 'technical_inspection' else 'warehouse_checking' end
        ) as check_done
      from public.transmittals t
      where t.state not in ('draft', 'cancelled')
        and exists (select 1 from public.transmittal_lines l where l.transmittal_id = t.id and l.ipas_id = i.id)
    ) slips
  ) tg
  -- #283: the IPAS's Landed Cost total and mark, for cost-tier readers only.
  cross join lateral (
    select
      case when bool_or(l.mark = 'unavailable') then null else sum(l.total_php) end as total,
      case when count(*) = 0 then null
           when bool_or(l.mark = 'unavailable') then 'unavailable'
           when bool_and(l.mark = 'final') then 'final'
           else 'provisional' end as mark
    from public.ipas_line_landed_costs(i.id) l
    where public.costing_can_read_cost(p_opportunity_id)
  ) lcost
  where (select public.sor_access_level(p_opportunity_id)) = 'full'
    and i.purpose = 'project'
    and exists (
      select 1 from public.ipas_sors s
      where s.ipas_id = i.id and s.opportunity_id = p_opportunity_id
    )
  order by
    case i.state when 'open' then 0 when 'filed' then 1 else 2 end,
    i.number;
$function$;

comment on function public.ipas_summaries_for_sor(uuid) is
  '#249, #256, #283: the Project IPAS naming an SOR, as a summary (number, PO, supplier, Purpose, state, buyer track ticks, computation status, sign-off progress) for anyone who can read the SOR. Landed Cost total and mark only for the matrix''s cost tiers (null otherwise). Never payments, charges or bank details. No SOR access -> no rows.';

revoke all on function public.ipas_summaries_for_sor(uuid) from public, anon;
grant execute on function public.ipas_summaries_for_sor(uuid) to authenticated;
