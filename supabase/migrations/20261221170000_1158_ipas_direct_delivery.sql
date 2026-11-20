-- #1158 (spec #1151, T6): Direct delivery to the client.
--
-- Some orders never reach our warehouse: the supplier delivers straight to the client. One switch on the
-- IPAS covers the whole order. While it is on, the Logistics sign-off asks only for the Delivered status
-- (Delivered here means the client has the goods); no Item Location and no Transmittal. Turning it off
-- brings every rule back. ipas_summaries_for_sor now returns the real column, and ipas_standing_for_sor
-- (the SOR's order standing facts) carries the IPAS Status, the Odoo receipt and bill facts and the flag.
--
-- SAFE TO RUN AT ANY TIME: one NOT NULL DEFAULT false column, one new function, one create-or-replace and two
-- drop-and-create (the SOR summary and the SOR standing facts).

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
    select coalesce(array_agg(so.section::text || ':' || so.role), '{}'::text[]) as live
    from public.ipas_signoffs so
    where so.ipas_id = i.id and so.cleared_at is null
  ) lv
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
  '#249, #256, #283, #1157: the Project IPAS naming an SOR, as a summary (number, PO, supplier, Purpose, state, the IPAS Status with the day it was reached, On-Hold, Direct delivery, computation status, sign-off progress) for anyone who can read the SOR. Landed Cost total and mark only for the matrix''s cost tiers (null otherwise). Never payments, charges or bank details. No SOR access -> no rows.';

revoke all on function public.ipas_summaries_for_sor(uuid) from public, anon;
grant execute on function public.ipas_summaries_for_sor(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- The SOR's orders carry their IPAS Status, the Odoo facts and Direct delivery (#1156, #1158)
-- ------------------------------------------------------------------------------

drop function if exists public.ipas_standing_for_sor(uuid);

create function public.ipas_standing_for_sor(p_opportunity_id uuid)
returns table (
  ipas_id uuid,
  source text,
  created_at timestamptz,
  updated_at timestamptz,
  costs_completed_at timestamptz,
  proof_paid_on date,
  shipped_out_on date,
  onboard_on date,
  arrived_in_ph_on date,
  arrived_in_whs_on date,
  import_clearance_on date,
  delivered_on date,
  actual_checking_stamped boolean,
  actual_checking_at timestamptz,
  slips jsonb,
  on_hold boolean,
  status text,
  status_steps jsonb,
  received_state text,
  has_bill boolean,
  direct_delivery boolean
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    i.id,
    i.source,
    i.created_at,
    i.updated_at,
    (
      select max(e.created_at)
        from public.ipas_events e
       where e.ipas_id = i.id
         and e.kind = 'header_changed'
         and e.detail #>> '{fields,computation_status,to}' in ('lc_odoo_done', 'checked')
    ),
    (
      select max(p.paid_on)
        from public.ipas_payments p
       where p.ipas_id = i.id and coalesce(p.proof_url, '') <> ''
    ),
    i.shipped_out_on,
    i.onboard_on,
    i.arrived_in_ph_on,
    i.arrived_in_whs_on,
    i.import_clearance_on,
    i.delivered_on,
    i.actual_checking_by is not null,
    i.actual_checking_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'number', t.number,
          'prepared_on', t.prepared_on,
          'created_at', t.created_at,
          'submitted_at', t.submitted_at,
          'state', t.state,
          'check_warehouse', t.check_warehouse,
          'check_technical', t.check_technical,
          'stages', coalesce((
            select jsonb_agg(jsonb_build_object('stage', st.stage, 'completed_at', st.completed_at))
              from public.transmittal_stages st
             where st.transmittal_id = t.id
          ), '[]'::jsonb),
          'lines', coalesce((
            select jsonb_agg(jsonb_build_object(
              'ipas_id', l.ipas_id,
              'odoo_po_line_id', l.odoo_po_line_id,
              'wh_rating', l.wh_rating,
              'tech_rating', l.tech_rating
            ))
              from public.transmittal_lines l
             where l.transmittal_id = t.id and l.ipas_id = i.id
          ), '[]'::jsonb)
        )
        order by t.prepared_on, t.created_at, t.number
      )
        from public.transmittals t
       where t.state <> 'cancelled'
         and exists (
           select 1 from public.transmittal_lines l
            where l.transmittal_id = t.id and l.ipas_id = i.id
         )
    ), '[]'::jsonb),
    i.on_hold,
    i.status,
    coalesce((
      select jsonb_agg(jsonb_build_object('step', s.step, 'reached_on', s.reached_on) order by s.reached_on)
        from public.ipas_status_steps s
       where s.ipas_id = i.id
    ), '[]'::jsonb),
    rs.received_state,
    o.bill_count > 0,
    coalesce(i.direct_delivery, false)
  from public.ipas i
  cross join lateral (
    select
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
  where (select public.sor_access_level(p_opportunity_id)) = 'full'
    and i.purpose = 'project'
    and exists (
      select 1 from public.ipas_sors s
      where s.ipas_id = i.id and s.opportunity_id = p_opportunity_id
    )
  order by i.number;
$function$;

comment on function public.ipas_standing_for_sor(uuid) is
  '#265, #597, #1156: the dates and Transmittal facts the SOR''s IPAS section needs to say where each order stands (next thing, owner, days waiting, late), for anyone who can read the SOR (sor_access_level = full), plus whether the order is On-Hold (the flag only, never its note) and its IPAS Status with each step''s day, whether Odoo reports the goods received and a bill, and whether it is a Direct delivery. Never money or bank columns. No SOR access -> no rows. Uncancelled Transmittals, drafts included (a draft only tells the service one has been raised).';

revoke all on function public.ipas_standing_for_sor(uuid) from public, anon;
grant execute on function public.ipas_standing_for_sor(uuid) to authenticated;
