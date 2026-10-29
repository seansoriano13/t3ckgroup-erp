-- #791: the S0 Evaluation list's "Items bought" counts a Component as bought when it has a Landed Cost
-- OR a Purchase Request line for it is Purchased or Received (the list read "0 of 12" with 11 lines Received).
-- Only items_bought changes. Redefines costing_matrix_page (latest: 20261113130000_718_review_fixes.sql).
-- SAFE TO RUN AT ANY TIME: one read-only function.
create or replace function public.costing_matrix_page()
returns table (
  opportunity_id uuid,
  sor_code text,
  sales_reference text,
  project_title text,
  stage text,
  entities text[],
  final_offer_total numeric,
  final_acquire_total numeric,
  landed_cost_total numeric,
  bought_final_acquire_total numeric,
  items_bought integer,
  items_total integer,
  ipas_short boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- Super Admins and the list read every SOR; anyone else, the SORs they are open on.
  v_all boolean := coalesce(public.is_super_admin(), false) or public.costing_on_list('final_acquire');
begin
  if public.get_employee_id() is null then
    raise exception 'costing_matrix_page: not signed in' using errcode = '42501';
  end if;
  if not (v_all or public.costing_is_open_anywhere()) then
    raise exception 'costing_matrix_page: only Super Admins, Purchasing, the Deal Team and the Final Acquire list read the S0 Evaluation page'
      using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.sor_code,
    o.sales_reference,
    o.project_title,
    fs.name,
    coalesce(ent.names, '{}'::text[]),
    offer.total,
    acquire.total,
    lc.landed,
    lc.bought_acquire,
    lc.bought,
    lc.total_items,
    (shortage.open_short or lc.provisional)
  from public.costing_matrices m
  join public.sales_opportunities o on o.id = m.opportunity_id
  left join public.flow_stages fs on fs.id = o.flow_stage_id
  cross join lateral (
    select case when count(*) > 0 and bool_and(p.final_offer_unit is not null)
                then sum(round(p.final_offer_unit * t.quantity, 2)) end as total
    from public.costing_tender_lines t
    left join public.costing_tender_line_prices p on p.tender_line_id = t.id
    where t.matrix_id = m.id
  ) offer
  cross join lateral (
    select case when count(*) > 0 and bool_and(x.fa is not null)
                then sum(round(x.fa * x.q, 2)) end as total
    from (
      select cc.final_acquire_unit as fa, c.quantity as q
      from public.costing_components c
      join public.costing_tender_lines t on t.id = c.tender_line_id
      left join public.costing_component_costs cc on cc.component_id = c.id
      where t.matrix_id = m.id
      union all
      select r.final_acquire_unit, r.quantity
      from public.costing_cost_rows r
      where r.matrix_id = m.id
    ) x
  ) acquire
  cross join lateral (
    select
      count(*)::integer as total_items,
      (count(*) filter (where l.total_php is not null
        or exists (select 1 from public.purchase_request_items pi
                    where pi.component_id = c.id and pi.status in ('purchased', 'received'))))::integer as bought,
      -- Each Component's Landed Cost is rounded to the centavo before it is added, as the SOR summary does.
      coalesce(sum(round(l.total_php, 2)) filter (where l.total_php is not null), 0) as landed,
      case when coalesce(bool_and(l.total_php is null or cc.final_acquire_unit is not null), true)
           then coalesce(sum(round(cc.final_acquire_unit * c.quantity, 2)) filter (where l.total_php is not null), 0)
      end as bought_acquire,
      coalesce(bool_or(l.total_php is not null and l.mark is distinct from 'final'), false) as provisional
    from public.costing_components c
    join public.costing_tender_lines t on t.id = c.tender_line_id
    left join public.costing_component_costs cc on cc.component_id = c.id
    left join public.costing_landed_costs(o.id) l on l.component_id = c.id
    where t.matrix_id = m.id
  ) lc
  cross join lateral (
    select exists (
      select 1
      from public.ipas i
      join public.ipas_sors s on s.ipas_id = i.id
      where s.opportunity_id = o.id
        and i.purpose = 'project'
        and i.state = 'open'
        and coalesce(i.computation_status, '') not in ('lc_odoo_done', 'costs_complete', 'checked')
    ) as open_short
  ) shortage
  cross join lateral (
    select array_agg(distinct e.name order by e.name) as names
    from (
      select nullif(btrim(coalesce(nullif(btrim(i.entity_override), ''), i.odoo_copy #>> '{po,company}')), '') as name
      from public.ipas i
      join public.ipas_sors s on s.ipas_id = i.id
      where s.opportunity_id = o.id
        and i.purpose = 'project'
        and i.state <> 'cancelled'
    ) e
    where e.name is not null
  ) ent
  where not coalesce(o.is_deleted, false)
    and not coalesce(o.is_scratch, false)
    and (v_all or public.costing_is_open(o.id))
  order by o.serial_no desc;
end;
$$;
