-- #787: "Costing settled" could never pass on screen. The database said settled_met true, but
-- costing_condition_inputs still counted rows with no Final Acquire as missing_cost (12), and the
-- client rule failed on it. The counts (and the cost guide's totals) now read the same cost as
-- costing_settled_met: Final Acquire, else Acquire.
--
-- SAFE TO RUN AT ANY TIME. Idempotent: create-or-replace.

CREATE OR REPLACE FUNCTION public.costing_condition_inputs(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_matrix      uuid;
  v_incharge    uuid;
  v_totals      record;
  v_costed      integer;
  v_missing     integer;
  v_components  integer;
  v_no_acquire  integer;
  v_tier        text;
  v_priced      jsonb;
  v_settled     boolean;
begin
  if public.get_employee_id() is null then
    raise exception 'costing_condition_inputs: sign in first' using errcode = '42501';
  end if;
  if public.sor_access_level(p_opportunity_id) = 'none' then
    raise exception 'costing_condition_inputs: you can''t see this SOR' using errcode = '42501';
  end if;

  select m.id, m.purchasing_incharge_id into v_matrix, v_incharge
    from public.costing_matrices m where m.opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return jsonb_build_object('has_matrix', false);
  end if;

  select * into v_totals from public.costing_bid_totals(v_matrix);

  select count(*),
         count(*) filter (where coalesce(cc.final_acquire_unit, cc.acquire_unit) is null),
         count(*) filter (where cc.acquire_unit is null and cc.p0_unit_price is null)
    into v_components, v_missing, v_no_acquire
    from public.costing_components c
    join public.costing_tender_lines l on l.id = c.tender_line_id
    left join public.costing_component_costs cc on cc.component_id = c.id
   where l.matrix_id = v_matrix;

  v_costed := v_components + (select count(*) from public.costing_cost_rows r where r.matrix_id = v_matrix);
  v_missing := v_missing + (select count(*) from public.costing_cost_rows r
                             where r.matrix_id = v_matrix and coalesce(r.final_acquire_unit, r.acquire_unit) is null);
  v_no_acquire := v_no_acquire + (select count(*) from public.costing_cost_rows r
                                   where r.matrix_id = v_matrix and r.acquire_unit is null);

  v_settled := public.costing_settled_met(v_matrix);
  v_priced := jsonb_build_object(
    'component_count', v_components,
    'missing_acquire', v_no_acquire,
    'has_purchasing_incharge', v_incharge is not null
  );

  v_tier := public.costing_tier(p_opportunity_id);
  if v_tier in ('price', 'closed_book') then
    return jsonb_build_object(
      'has_matrix', true,
      'settled_met', v_settled,
      'line_count', v_totals.line_count,
      'missing_offer', v_totals.missing_offer,
      'over_abc', coalesce(v_totals.final_offer_total > v_totals.abc_total, false),
      'costed_rows', v_costed,
      'missing_cost', v_missing,
      'evaluation_approved', exists (
        select 1 from public.costing_signoffs s
         where s.matrix_id = v_matrix and s.role = 'evaluation_approved' and s.cleared_at is null),
      'bid_verdict', (select d.verdict from public.costing_bid_decisions d
                       where d.matrix_id = v_matrix and d.cleared_at is null)
    ) || v_priced;
  end if;

  return jsonb_build_object('has_matrix', true, 'settled_met', v_settled) || v_priced;
end;
$function$;

CREATE OR REPLACE FUNCTION public.costing_cost_guide(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tier    text := public.costing_tier(p_opportunity_id);
  v_matrix  uuid;
  v_offer   numeric;
  v_missing_offer integer;
  v_missing_cost  integer;
  v_product numeric;
  v_cats    jsonb;
  v_uncat   numeric;
begin
  if v_tier is null then
    return null;
  end if;
  -- The figures are the Final Offer and Final Acquire; the tier must be sent both.
  if exists (
    select 1
      from (values ('costing_tender_line_prices', 'final_offer_unit'),
                   ('costing_component_costs', 'final_acquire_unit'),
                   ('costing_cost_rows', 'final_acquire_unit')) need (t, c)
     where not exists (
       select 1 from public.costing_column_tiers r
        where r.table_name = need.t and r.column_name = need.c and v_tier = any (r.tiers)
     )
  ) then
    return null;
  end if;
  select id into v_matrix from public.costing_matrices where opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return null;
  end if;

  select count(*) filter (where p.final_offer_unit is null),
         sum(p.final_offer_unit * l.quantity)
    into v_missing_offer, v_offer
    from public.costing_tender_lines l
    left join public.costing_tender_line_prices p on p.tender_line_id = l.id
   where l.matrix_id = v_matrix;
  if not exists (select 1 from public.costing_tender_lines where matrix_id = v_matrix) or v_missing_offer > 0 then
    v_offer := null;
  end if;

  select coalesce(sum(coalesce(cc.final_acquire_unit, cc.acquire_unit) * c.quantity), 0),
         count(*) filter (where coalesce(cc.final_acquire_unit, cc.acquire_unit) is null)
    into v_product, v_missing_cost
    from public.costing_tender_lines l
    join public.costing_components c on c.tender_line_id = l.id
    left join public.costing_component_costs cc on cc.component_id = c.id
   where l.matrix_id = v_matrix;

  select coalesce(sum(coalesce(r.final_acquire_unit, r.acquire_unit) * r.quantity), 0),
         v_missing_cost + count(*) filter (where coalesce(r.final_acquire_unit, r.acquire_unit) is null)
    into v_uncat, v_missing_cost
    from public.costing_cost_rows r
   where r.matrix_id = v_matrix and r.category_key is null;

  select coalesce(jsonb_agg(entry order by sort), '[]'::jsonb) into v_cats
    from (
      select k.sort,
             jsonb_build_object(
               'key', k.key,
               'label', k.label,
               'low_pct', k.low_pct,
               'high_pct', k.high_pct,
               'total', t.total,
               'share_pct', case when v_offer is null or v_offer = 0 then null else round(t.total * 100 / v_offer, 2) end,
               'status', case
                 when v_offer is null or v_offer = 0 then null
                 when round(t.total * 100 / v_offer, 2) < k.low_pct then 'below'
                 when round(t.total * 100 / v_offer, 2) > k.high_pct then 'above'
                 else 'within'
               end
             ) as entry
        from public.costing_cost_categories k
        cross join lateral (
          select case when k.key = 'products' then v_product else 0 end
                 + coalesce((
                     select sum(coalesce(r.final_acquire_unit, r.acquire_unit) * r.quantity)
                       from public.costing_cost_rows r
                      where r.matrix_id = v_matrix and r.category_key = k.key
                   ), 0) as total
        ) t
    ) s;

  -- Rows in a category with no Final Acquire yet.
  select v_missing_cost + count(*) into v_missing_cost
    from public.costing_cost_rows r
   where r.matrix_id = v_matrix and r.category_key is not null and coalesce(r.final_acquire_unit, r.acquire_unit) is null;

  return jsonb_build_object(
    'final_offer_total', v_offer,
    'missing_offer', v_missing_offer,
    'missing_cost', v_missing_cost,
    'categories', v_cats,
    'uncategorised', jsonb_build_object(
      'total', v_uncat,
      'share_pct', case when v_offer is null or v_offer = 0 then null else round(v_uncat * 100 / v_offer, 2) end
    )
  );
end;
$function$;
