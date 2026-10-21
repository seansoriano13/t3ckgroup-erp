-- Code-review fixes for spec #595.
--
--   _ipas_clean_payment   (20261026150000)  a foreign payment can't be blank once Landed Cost is
--                                           final: at LC Odoo Done OR any later status (the old
--                                           Checked step, costs_complete), not only at LC Odoo Done
--   costing_matrix_page   (20261026160000)  each Component's Landed Cost is rounded to the centavo
--                                           before the SOR's total adds them up, exactly as the SOR
--                                           summary does (costingMath.revenueInputs), so the Costing
--                                           Matrix page and the SOR can never disagree
--
-- SAFE TO RUN AT ANY TIME: function bodies only. Idempotent.

create or replace function public._ipas_clean_payment(
  p_fn text,
  p_ipas public.ipas,
  p_kind text,
  p_paid_on date,
  p_amount numeric,
  p_php_debited numeric,
  p_charge_fee_php numeric,
  p_method_id uuid,
  p_current_method uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_amount numeric := round(p_amount, 2);
  v_php numeric := round(p_php_debited, 2);
  v_fee numeric := round(coalesce(p_charge_fee_php, 0), 2);
  v_label text;
begin
  if p_kind is null or p_kind not in ('down_payment', 'payment', 'full_payment', 'shipping_fee') then
    raise exception '%: % isn''t a payment kind', p_fn, coalesce(p_kind, 'null') using errcode = '22023';
  end if;
  if p_paid_on is null then
    raise exception '%: give the date of the payment', p_fn using errcode = '22023';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception '%: the amount must be more than zero', p_fn using errcode = '22023';
  end if;
  if v_fee < 0 then
    raise exception '%: the charge fee can''t be negative', p_fn using errcode = '22023';
  end if;

  if public._ipas_is_php(p_ipas.odoo_copy) then
    -- A PHP payment's PHP is its amount: no second figure to disagree with it.
    v_php := null;
  else
    -- #604: the pesos taken from the bank may be left blank (Landed Cost is then an estimate);
    -- a figure that is given has to make sense.
    if v_php is not null and v_php <= 0 then
      raise exception '%: the pesos taken from the bank must be more than zero, or left blank until the bank statement arrives', p_fn
        using errcode = '22023';
    end if;
    -- Once Landed Cost is final (LC Odoo Done, or any status after it), it can't go back to an estimate.
    if v_php is null and p_ipas.computation_status in ('lc_odoo_done', 'costs_complete', 'checked') then
      raise exception '%: % is % LC Odoo Done, so Landed Cost is final; give the pesos taken from the bank', p_fn, p_ipas.number,
        case when p_ipas.computation_status = 'lc_odoo_done' then 'at' else 'past' end
        using errcode = '22023';
    end if;
  end if;

  v_label := public._ipas_check_option(p_fn, p_method_id, 'payment_method', p_current_method, 'payment method');

  return jsonb_build_object(
    'amount', v_amount,
    'php_debited', v_php,
    'charge_fee_php', v_fee,
    'method_label', v_label
  );
end;
$$;

revoke all on function public._ipas_clean_payment(text, public.ipas, text, date, numeric, numeric, numeric, uuid, uuid)
  from public, anon, authenticated;

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
  order by o.serial_no desc;
end;
$function$;

comment on function public.costing_matrix_page() is
  '#606: one row per SOR with a Costing Matrix and the totals Planned and Actual Revenue are worked from (offer, Final Acquire, Landed Cost of the bought Components each rounded to the centavo, items bought of total, whether an IPAS is short of LC Odoo Done). Super Admins and the Final Acquire list only; anyone else is refused (42501). Never changes a row.';

revoke all on function public.costing_matrix_page() from public, anon;
grant execute on function public.costing_matrix_page() to authenticated;
