-- #1158 (spec #1151, T6): Direct delivery to the client.
--
-- Some orders never reach our warehouse: the supplier delivers straight to the client. One switch on the
-- IPAS covers the whole order. While it is on, the Logistics sign-off asks only for the Delivered status
-- (Delivered here means the client has the goods); no Item Location and no Transmittal. Turning it off
-- brings every rule back. ipas_summaries_for_sor now returns the real column.
--
-- SAFE TO RUN AT ANY TIME: one NOT NULL DEFAULT false column, one new function, two create-or-replace.

alter table public.ipas
  add column if not exists direct_delivery boolean not null default false;

comment on column public.ipas.direct_delivery is
  '#1158: the supplier delivers straight to the client. Covers the whole order. Written only by ipas_set_direct_delivery.';

create or replace function public.ipas_set_direct_delivery(p_ipas_id uuid, p_on boolean)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas;
begin
  if v_actor is null then
    raise exception 'ipas_set_direct_delivery: not signed in' using errcode = '42501';
  end if;
  if not (
    coalesce(public.has_purchasing_access(), false)
    or coalesce(public.has_logistics_access(), false)
    or coalesce(public.is_super_admin(), false)
  ) then
    raise exception 'ipas_set_direct_delivery: only Purchasing, Logistics or a Super Admin sets Direct delivery'
      using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'ipas_set_direct_delivery: say on or off' using errcode = '22023';
  end if;

  v_row := public._ipas_lock_open('ipas_set_direct_delivery', p_ipas_id);
  if p_on = v_row.direct_delivery then
    return v_row;
  end if;

  update public.ipas set direct_delivery = p_on where id = v_row.id returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'direct_delivery_changed', jsonb_build_object('to', p_on));

  return v_row;
end;
$$;

comment on function public.ipas_set_direct_delivery(uuid, boolean) is
  '#1158: Purchasing access, Logistics access or a Super Admin switches Direct delivery on an open IPAS (refused once filed). Writes "direct_delivery_changed".';

revoke all on function public.ipas_set_direct_delivery(uuid, boolean) from public, anon;
grant execute on function public.ipas_set_direct_delivery(uuid, boolean) to authenticated;

-- The Logistics sign-off: on a Direct delivery only the Delivered status is asked for.
create or replace function public._ipas_logistics_missing(p_ipas_id uuid)
returns text[]
language sql
stable
set search_path = public
as $$
  select array_remove(array[
    case when not i.direct_delivery and i.item_location_id is null and not exists (
      select 1 from public.transmittal_ipas ti
        join public.transmittals t on t.id = ti.transmittal_id
       where ti.ipas_id = i.id and t.item_location_id is not null
    ) then 'the Item Location' end,
    case when not i.direct_delivery and not exists (select 1 from public.transmittal_ipas ti where ti.ipas_id = i.id)
      then 'a Transmittal' end,
    case when not exists (
      select 1 from public.ipas_status_steps s where s.ipas_id = i.id and s.step = 'delivered'
    ) then 'the Delivered status' end
  ], null)
  from public.ipas i
  where i.id = p_ipas_id;
$$;

revoke all on function public._ipas_logistics_missing(uuid) from public, anon, authenticated;

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
  landed_cost_mark text,
  status text,
  status_reached_on date,
  on_hold boolean,
  direct_delivery boolean
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
      '6', jsonb_build_object(
        'prepared', '6:prepared' = any (lv.live),
        'approved', '6:approved' = any (lv.live)
      ),
      '7', jsonb_build_object(
        'received', '7:received' = any (lv.live),
        'noted', '7:noted' = any (lv.live),
        'checked', '7:checked' = any (lv.live),
        'approved', '7:approved' = any (lv.live)
      )
    ),
    lcost.total,
    lcost.mark,
    i.status,
    (select st.reached_on from public.ipas_status_steps st where st.ipas_id = i.id and st.step = i.status),
    coalesce(i.on_hold, false),
    coalesce(i.direct_delivery, false)
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
  '#249, #256, #283, #1157: the Project IPAS naming an SOR, as a summary (number, PO, supplier, Purpose, state, the IPAS Status with the day it was reached, On-Hold, Direct delivery, buyer track ticks for the standing, computation status, sign-off progress) for anyone who can read the SOR. Landed Cost total and mark only for the matrix''s cost tiers (null otherwise). Never payments, charges or bank details. No SOR access -> no rows.';

revoke all on function public.ipas_summaries_for_sor(uuid) from public, anon;
grant execute on function public.ipas_summaries_for_sor(uuid) to authenticated;
