-- Landed Cost flows back to the Costing Matrix (#283, map #210, build step 6).
--
-- WHAT THIS ADDS
--   ipas_line_landed_costs(ipas)        per Odoo PO line of an IPAS: quantity, unit_php,
--                                       total_php and mark (provisional | final | unavailable).
--                                       #218/#244's maths, the same as utils/landedCost.js:
--                                       the pre-tax PO price, at the rate actually paid on a
--                                       foreign PO, plus every charge, charge fee and shipping
--                                       fee spread by landed_cost_split (largest remainder, to
--                                       the centavo). Internal: no client may call it.
--   costing_landed_costs(opportunity)   per Component of the SOR's matrix, the Landed Cost its
--                                       Requested Items claim from their picked PO lines, with
--                                       its mark, or a blank reason. Money tier only
--                                       (costing_can_read_money); nothing for anyone else.
--   costing_component_purchases(opp)    per Component, its Requested Items' PO numbers and
--                                       statuses, its typed po_rfq_no, the quantity ordered and
--                                       each PO's IPAS number and state. No money: every tier.
--   purchase_request_item_detach_component(item)
--                                       Purchasing access: clears an item's component_id and
--                                       writes the unlink to costing_events.
--   Delete guards                       a Component with a Requested Item or a typed PO number,
--                                       and a Tender Line holding one, can't be deleted until
--                                       unlinked. A cascade (an SOR or matrix going) is not refused.
--   ipas_summaries_for_sor              gains landed_cost_total_php and landed_cost_mark, filled
--                                       for money-tier readers only.
--
-- WHAT IT NEVER DOES
--   Landed Cost is computed on read and written nowhere. It feeds no markup, Final Acquire,
--   summary, Revenue, "Costing settled" or sign-off. Reading it never grants the IPAS.
--
-- SAFE TO RUN AT ANY TIME: new functions, two triggers and one redefined read. Idempotent.

-- ---------------------------------------------------------------------------
-- A number out of jsonb text, or null.
-- ---------------------------------------------------------------------------

create or replace function public._lc_num(p_text text)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case when btrim(coalesce(p_text, '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(p_text)::numeric end
$$;

revoke all on function public._lc_num(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Landed Cost per PO line of one IPAS
-- ---------------------------------------------------------------------------

create or replace function public.ipas_line_landed_costs(p_ipas_id uuid)
returns table (
  odoo_line_id integer,
  quantity numeric,
  unit_php numeric,
  total_php numeric,
  mark text
)
language sql
stable
security definer
set search_path = public
as $$
  with i as (
    select
      ip.id,
      upper(btrim(coalesce(ip.odoo_copy #>> '{po,currency}', ''))) = 'PHP' as php,
      (ip.state = 'filed' or ip.computation_status in ('lc_odoo_done', 'checked')) as final,
      coalesce(nullif(ip.landed_cost_split, ''), 'value') as split,
      case when jsonb_typeof(ip.odoo_copy -> 'lines') = 'array' then ip.odoo_copy -> 'lines' else '[]'::jsonb end as lines
    from public.ipas ip
    where ip.id = p_ipas_id
  ),
  lines as (
    select
      public._lc_num(e.l ->> 'line_id')::integer as lid,
      public._lc_num(e.l ->> 'quantity') as qty,
      coalesce(public._lc_num(e.l ->> 'price_unit'), 0) as price,
      e.ord
    from i
    cross join lateral jsonb_array_elements(i.lines) with ordinality as e(l, ord)
    where public._lc_num(e.l ->> 'quantity') > 0
  ),
  rate as (
    select case when i.php then 1::numeric else (
      select sum(p.php_debited) / sum(p.amount)
      from public.ipas_payments p
      where p.ipas_id = i.id and p.php_debited > 0 and p.amount > 0
      having count(*) > 0 and sum(p.amount) > 0
    ) end as r
    from i
  ),
  pool as (
    select
      coalesce((select sum(round(coalesce(c.amount_php, 0) * 100)) from public.ipas_charges c where c.ipas_id = i.id), 0)
      + coalesce((select sum(round(coalesce(p.charge_fee_php, 0) * 100)) from public.ipas_payments p where p.ipas_id = i.id), 0)
      + coalesce((
          select sum(round(coalesce(case when i.php then p.amount else p.php_debited end, 0) * 100))
          from public.ipas_payments p where p.ipas_id = i.id and p.kind = 'shipping_fee'
        ), 0) as c
    from i
  ),
  goods as (
    select lines.*, round(lines.qty * lines.price * rate.r * 100) as goods_c
    from lines, rate
  ),
  -- By value needs value to spread over; with nothing priced it falls back to equal.
  used as (
    select case
      when i.split = 'quantity' then 'quantity'
      when i.split = 'equal' then 'equal'
      when coalesce((select sum(goods_c) from goods), 0) > 0 then 'value'
      else 'equal'
    end as split
    from i
  ),
  weighted as (
    select goods.*, case used.split when 'value' then goods.goods_c when 'quantity' then goods.qty else 1 end as w
    from goods, used
  ),
  exact as (
    select weighted.*,
      case when sum(w) over () > 0 then pool.c * w / sum(w) over () else 0 end as x
    from weighted, pool
  ),
  floored as (
    select exact.*, floor(x) as fl, x - floor(x) as rem
    from exact
  ),
  ranked as (
    select floored.*,
      row_number() over (order by rem desc, ord) as rn,
      (select c from pool) - sum(fl) over () as left_over
    from floored
  )
  select
    ranked.lid,
    ranked.qty,
    case when rate.r is null then null else round((ranked.goods_c + ranked.fl + (ranked.rn <= ranked.left_over)::int) / ranked.qty) / 100 end,
    case when rate.r is null then null else (ranked.goods_c + ranked.fl + (ranked.rn <= ranked.left_over)::int) / 100 end,
    case when rate.r is null then 'unavailable' when i.final then 'final' else 'provisional' end
  from ranked, rate, i
  order by ranked.ord
$$;

comment on function public.ipas_line_landed_costs(uuid) is
  '#283: Landed Cost per Odoo PO line of an IPAS (#218: pre-tax price, the rate actually paid, every charge, charge fee and shipping fee spread by landed_cost_split). mark: final at LC Odoo Done, Checked or filed; unavailable on a foreign PO with no payment. Internal: called by costing_landed_costs and ipas_summaries_for_sor.';

revoke all on function public.ipas_line_landed_costs(uuid) from public, anon, authenticated;

-- The live IPAS for a PO number: the newest one not cancelled. Internal.
create or replace function public._lc_ipas_for_po(p_po_number text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select i.id from public.ipas i
  where i.po_number = btrim(p_po_number) and i.state <> 'cancelled'
  order by i.created_at desc
  limit 1
$$;

revoke all on function public._lc_ipas_for_po(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A Component's Landed Cost
-- ---------------------------------------------------------------------------

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
      and public.costing_can_read_money(p_opportunity_id)
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
  '#283: each Component''s Landed Cost, summed from what its Ordered and Received Requested Items claim from their picked PO lines on the live IPAS (a shared line splits by quantity; a sole claimant takes the whole line). final only when every IPAS it draws from is final. Blank, never partial: blank_reason not_ordered | po_line_not_picked | line_removed | landed_cost_unavailable. Money tier only; no rows otherwise. Never grants the IPAS.';

revoke all on function public.costing_landed_costs(uuid) from public, anon;
grant execute on function public.costing_landed_costs(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The P.O./RFQ No. and IPAS columns: no money, every tier
-- ---------------------------------------------------------------------------

create or replace function public.costing_component_purchases(p_opportunity_id uuid)
returns table (
  component_id uuid,
  po_rfq_no text,
  ordered_quantity numeric,
  requests jsonb,
  ipas jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with comps as (
    select c.id, nullif(btrim(c.po_rfq_no), '') as po_rfq_no
    from public.costing_components c
    join public.costing_tender_lines t on t.id = c.tender_line_id
    join public.costing_matrices m on m.id = t.matrix_id
    where m.opportunity_id = p_opportunity_id
      and public.costing_can_read(p_opportunity_id)
  )
  select
    comps.id,
    comps.po_rfq_no,
    (select coalesce(sum(pri.quantity), 0) from public.purchase_request_items pri
      where pri.component_id = comps.id and pri.status in ('ordered', 'received')),
    coalesce((
      select jsonb_agg(jsonb_build_object('item_id', pri.id, 'request_id', pri.request_id, 'name', pri.name, 'po_number', nullif(btrim(pri.po_number), ''), 'status', pri.status, 'odoo_po_line_ids', coalesce(to_jsonb(pri.odoo_po_line_ids), '[]'::jsonb))
        order by pri.created_at)
      from public.purchase_request_items pri
      where pri.component_id = comps.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('po_number', po.po_number, 'ipas_id', ip.id, 'number', ip.number, 'state', ip.state)
        order by po.po_number)
      from (
        select distinct p.po_number from (
          select nullif(btrim(pri.po_number), '') as po_number
          from public.purchase_request_items pri
          where pri.component_id = comps.id and pri.status <> 'cancelled'
          union select comps.po_rfq_no
        ) p
        where p.po_number is not null
      ) po
      left join public.ipas ip on ip.id = public._lc_ipas_for_po(po.po_number)
    ), '[]'::jsonb)
  from comps
$$;

comment on function public.costing_component_purchases(uuid) is
  '#283: per Component, its Requested Items (id, request, name, PO number, status, picked line ids), its typed po_rfq_no, the quantity Ordered or Received, and each PO number''s IPAS number and state. No money. Gated by costing_can_read.';

revoke all on function public.costing_component_purchases(uuid) from public, anon;
grant execute on function public.costing_component_purchases(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Unlinking a Requested Item from its Component
-- ---------------------------------------------------------------------------

create or replace function public.purchase_request_item_detach_component(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item   public.purchase_request_items;
  v_matrix uuid;
begin
  if auth.uid() is null then
    raise exception 'purchase_request_item_detach_component: sign in first' using errcode = '42501';
  end if;
  if not (coalesce(public.has_purchasing_access(), false) or coalesce(public.is_super_admin(), false)) then
    raise exception 'purchase_request_item_detach_component: Purchasing access only' using errcode = '42501';
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if not found then
    raise exception 'purchase_request_item_detach_component: not found' using errcode = 'P0002';
  end if;
  if v_item.component_id is null then
    return;
  end if;

  select t.matrix_id into v_matrix
  from public.costing_components c
  join public.costing_tender_lines t on t.id = c.tender_line_id
  where c.id = v_item.component_id;

  update public.purchase_request_items set component_id = null where id = p_item_id;

  if v_matrix is not null then
    insert into public.costing_events (matrix_id, actor_id, kind, detail)
    values (v_matrix, auth.uid(), 'changed', jsonb_build_object(
      'table', 'purchase_request_items',
      'row', p_item_id,
      'column', 'component_id',
      'old', v_item.component_id,
      'new', null
    ));
  end if;
end;
$$;

comment on function public.purchase_request_item_detach_component(uuid) is
  '#283: Purchasing access unlinks a Requested Item from its Component; the unlink is kept in costing_events.';

revoke all on function public.purchase_request_item_detach_component(uuid) from public, anon;
grant execute on function public.purchase_request_item_detach_component(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Linked rows can't be deleted
-- ---------------------------------------------------------------------------

-- What links a Component, in words, or null.
create or replace function public._costing_component_link(p_component_id uuid, p_po_rfq_no text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.purchase_request_items pri where pri.component_id = p_component_id)
      then 'a Requested Item'
    when nullif(btrim(p_po_rfq_no), '') is not null
      then 'P.O./RFQ No. ' || btrim(p_po_rfq_no)
  end
$$;

revoke all on function public._costing_component_link(uuid, text) from public, anon, authenticated;

-- A direct delete is refused; a cascade from the SOR or matrix going (trigger depth > 1) is not.
create or replace function public.costing_component_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link text;
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  v_link := public._costing_component_link(old.id, old.po_rfq_no);
  if v_link is not null then
    raise exception 'This Component is linked to %. Unlink it before deleting.', v_link
      using errcode = '55000', hint = 'costing_component_linked';
  end if;
  return old;
end;
$$;

revoke all on function public.costing_component_delete_guard() from public, anon, authenticated;

drop trigger if exists costing_component_delete_guard on public.costing_components;
create trigger costing_component_delete_guard before delete on public.costing_components
  for each row execute function public.costing_component_delete_guard();

create or replace function public.costing_tender_line_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link text;
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  select public._costing_component_link(c.id, c.po_rfq_no) into v_link
  from public.costing_components c
  where c.tender_line_id = old.id and public._costing_component_link(c.id, c.po_rfq_no) is not null
  limit 1;
  if v_link is not null then
    raise exception 'A Component on this Tender Line is linked to %. Unlink it before deleting.', v_link
      using errcode = '55000', hint = 'costing_component_linked';
  end if;
  return old;
end;
$$;

revoke all on function public.costing_tender_line_delete_guard() from public, anon, authenticated;

drop trigger if exists costing_tender_line_delete_guard on public.costing_tender_lines;
create trigger costing_tender_line_delete_guard before delete on public.costing_tender_lines
  for each row execute function public.costing_tender_line_delete_guard();

-- ---------------------------------------------------------------------------
-- The SOR's IPAS summary gains Landed Cost, for money-tier readers only
-- ---------------------------------------------------------------------------

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
  -- #283: the IPAS's Landed Cost total and mark, for money-tier readers only.
  cross join lateral (
    select
      case when bool_or(l.mark = 'unavailable') then null else sum(l.total_php) end as total,
      case when count(*) = 0 then null
           when bool_or(l.mark = 'unavailable') then 'unavailable'
           when bool_and(l.mark = 'final') then 'final'
           else 'provisional' end as mark
    from public.ipas_line_landed_costs(i.id) l
    where public.costing_can_read_money(p_opportunity_id)
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
  '#249, #256, #283: the Project IPAS naming an SOR, as a summary (number, PO, supplier, Purpose, state, buyer track ticks, computation status, sign-off progress) for anyone who can read the SOR. Landed Cost total and mark only for the matrix''s money tier (null otherwise). Never payments, charges or bank details. No SOR access -> no rows.';

revoke all on function public.ipas_summaries_for_sor(uuid) from public, anon;
grant execute on function public.ipas_summaries_for_sor(uuid) to authenticated;
