-- #606 (spec #595): the Costing Matrix page's read. One row per SOR that has a Costing Matrix,
-- with the per-SOR totals Planned and Actual Revenue are worked from. Closed Book only: the
-- Super Admins and the Final Acquire list; everyone else is refused, whatever SOR they can open.
--
--   costing_matrix_page()   (new)  the rows; the browser works the Revenue figures from them with
--                                  costingMath.revenueComparison, the same maths the SOR's own summary
--                                  uses (revenueInputs builds the same totals from a shaped matrix).
--
-- The totals match costingMath.revenueInputs figure for figure:
--   final_offer_total          the Tender Lines' Final Offers added up (unit x quantity, to the centavo);
--                              null while there is no Tender Line or any has no Final Offer
--   final_acquire_total        every Component and cost-only row at Final Acquire; null while there is
--                              none or any has no Final Acquire
--   landed_cost_total          the Landed Cost of the bought Components; 0 when none is bought
--   bought_final_acquire_total the Final Acquire of those same Components; 0 when none is bought; null
--                              while one of them has no Final Acquire
--   items_bought, items_total  Components with a Landed Cost, out of all Components (a Component is
--                              bought when costing_landed_costs gives it a Landed Cost)
--   ipas_short                 an open Project IPAS of the SOR has not reached LC Odoo Done, or a
--                              bought Component's Landed Cost is provisional
-- `entities` is the Odoo companies of the SOR's live Project IPAS (an SOR has no entity of its own).
-- No schema change. Re-runnable: create or replace.

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
as $function$
begin
  if public.get_employee_id() is null then
    raise exception 'costing_matrix_page: not signed in' using errcode = '42501';
  end if;
  if not (coalesce(public.is_super_admin(), false) or public.costing_on_list('final_acquire')) then
    raise exception 'costing_matrix_page: only Super Admins and the Final Acquire list read the Costing Matrix page'
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
      (count(*) filter (where l.total_php is not null))::integer as bought,
      coalesce(sum(l.total_php) filter (where l.total_php is not null), 0) as landed,
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
  order by o.serial_no desc;
end;
$function$;

comment on function public.costing_matrix_page() is
  '#606: one row per SOR with a Costing Matrix and the totals Planned and Actual Revenue are worked from (offer, Final Acquire, Landed Cost of the bought Components, items bought of total, whether an IPAS is short of LC Odoo Done). Super Admins and the Final Acquire list only; anyone else is refused (42501). Never changes a row.';

revoke all on function public.costing_matrix_page() from public, anon;
grant execute on function public.costing_matrix_page() to authenticated;
