-- One copy of the Landed Cost maths (#283, #244, #218).
--
-- #283's first migration put the per-line maths in SQL for the Costing Matrix, and the IPAS page
-- kept its own copy in utils/landedCost.js. Two copies drift. This makes the database the only
-- place it is worked out:
--
--   _ipas_landed_cost(ipas)     internal: the whole result as jsonb, the shape the IPAS page reads
--                               ({ status, reason, currency, isForeign, rate, split, usedSplit,
--                               lines, totals }), the same keys utils/landedCost.js returned.
--   ipas_landed_cost(ipas)      the IPAS page's read: the same, for whoever may read the IPAS's
--                               payments and charges (ipas_can_read); null for anyone else.
--   ipas_line_landed_costs      redefined to read its rows from _ipas_landed_cost, so the
--                               matrix, the SOR summary and the IPAS page share one calculation.
--
-- The maths are unchanged: the pre-tax PO price, at the rate actually paid on a foreign PO (no
-- payment, unavailable), plus every charge, charge fee and shipping fee spread by value (falling
-- back to equal with nothing priced), by quantity or equally, in whole centavos by largest
-- remainder (ties to the earlier line). Final at LC Odoo Done, Checked or filed.
--
-- SAFE TO RUN AT ANY TIME: function bodies only. Idempotent.

create or replace function public._ipas_landed_cost(p_ipas_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ipas      public.ipas;
  v_currency  text;
  v_php       boolean;
  v_split     text;
  v_used      text;
  v_final     boolean;
  v_php_paid  numeric;
  v_foreign   numeric;
  v_payments  integer;
  v_rate      numeric := 1;
  v_rate_json jsonb := null;
  v_charges   numeric;
  v_fees      numeric;
  v_shipping  numeric;
  v_pool      numeric;
  v_lines     jsonb;
  v_goods     numeric;
  v_base      jsonb;
begin
  select * into v_ipas from public.ipas where id = p_ipas_id;
  if not found then
    return null;
  end if;

  v_currency := v_ipas.odoo_copy #>> '{po,currency}';
  v_php := upper(btrim(coalesce(v_currency, ''))) = 'PHP';
  v_split := case when v_ipas.landed_cost_split in ('value', 'quantity', 'equal') then v_ipas.landed_cost_split else 'value' end;
  v_final := v_ipas.state = 'filed' or v_ipas.computation_status in ('lc_odoo_done', 'checked');

  v_base := jsonb_build_object(
    'currency', v_currency,
    'isForeign', not v_php,
    'rate', null,
    'split', v_split,
    'usedSplit', v_split,
    'lines', '[]'::jsonb,
    'totals', null
  );

  -- Only lines that are goods being bought: a quantity above zero.
  if not exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(v_ipas.odoo_copy -> 'lines') = 'array' then v_ipas.odoo_copy -> 'lines' else '[]'::jsonb end) as e(l)
    where public._lc_num(e.l ->> 'quantity') > 0
  ) then
    return v_base || jsonb_build_object('status', 'unavailable', 'reason', 'no_lines');
  end if;

  -- A foreign PO converts at what was actually paid: combined PHP debited / combined amount.
  if not v_php then
    select sum(p.php_debited), sum(p.amount), count(*)
      into v_php_paid, v_foreign, v_payments
    from public.ipas_payments p
    where p.ipas_id = p_ipas_id and p.php_debited > 0 and p.amount > 0;
    if coalesce(v_payments, 0) = 0 or coalesce(v_foreign, 0) = 0 then
      return v_base || jsonb_build_object('status', 'unavailable', 'reason', 'no_payments');
    end if;
    v_rate := v_php_paid / v_foreign;
    v_rate_json := jsonb_build_object('rate', v_rate, 'phpDebited', v_php_paid, 'foreignPaid', v_foreign, 'payments', v_payments);
  end if;

  -- The pool, in centavos: every charge, every charge fee and every shipping fee.
  select coalesce(sum(round(coalesce(c.amount_php, 0) * 100)), 0) into v_charges
  from public.ipas_charges c where c.ipas_id = p_ipas_id;
  select
    coalesce(sum(round(coalesce(p.charge_fee_php, 0) * 100)), 0),
    coalesce(sum(case when p.kind = 'shipping_fee'
      then round(coalesce(case when v_php then p.amount else p.php_debited end, 0) * 100) else 0 end), 0)
    into v_fees, v_shipping
  from public.ipas_payments p where p.ipas_id = p_ipas_id;
  v_pool := v_charges + v_fees + v_shipping;

  with lines as (
    select e.ord, e.l as line,
      public._lc_num(e.l ->> 'quantity') as qty,
      coalesce(public._lc_num(e.l ->> 'price_unit'), 0) as price
    from jsonb_array_elements(case when jsonb_typeof(v_ipas.odoo_copy -> 'lines') = 'array' then v_ipas.odoo_copy -> 'lines' else '[]'::jsonb end)
      with ordinality as e(l, ord)
    where public._lc_num(e.l ->> 'quantity') > 0
  ),
  goods as (
    select lines.*, round(qty * price * v_rate * 100) as goods_c from lines
  ),
  -- By value needs value to spread over; with nothing priced it falls back to equal.
  used as (
    select case when v_split = 'value' and not (coalesce(sum(goods_c), 0) > 0) then 'equal' else v_split end as split,
           coalesce(sum(goods_c), 0) as goods_total
    from goods
  ),
  weighted as (
    select goods.*, case used.split when 'value' then goods_c when 'quantity' then qty else 1 end as w
    from goods, used
  ),
  exact as (
    select weighted.*, case when sum(w) over () > 0 then v_pool * w / sum(w) over () else 0 end as x from weighted
  ),
  -- Largest remainder: floors first, then one centavo each to the largest remainders.
  ranked as (
    select exact.*, floor(x) as fl,
      row_number() over (order by x - floor(x) desc, ord) as rn,
      v_pool - sum(floor(x)) over () as left_over
    from exact
  ),
  shared as (
    select ranked.*, fl + case when rn <= left_over then 1 else 0 end as share_c from ranked
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'lineId', coalesce(line -> 'line_id', 'null'::jsonb),
      'name', coalesce(line -> 'name', '""'::jsonb),
      'brand', coalesce(line -> 'brand', 'null'::jsonb),
      'unit', coalesce(line -> 'unit', 'null'::jsonb),
      'quantity', qty,
      'unitPriceForeign', price,
      'unitPricePhp', round(price * v_rate * 100) / 100,
      'goodsPhp', goods_c / 100,
      'spreadPhp', share_c / 100,
      'landedPhp', (goods_c + share_c) / 100,
      'landedPerUnitPhp', round((goods_c + share_c) / qty) / 100
    ) order by ord), '[]'::jsonb),
    coalesce(sum(goods_c), 0),
    (select used.split from used)
    into v_lines, v_goods, v_used
  from shared;

  return v_base || jsonb_build_object(
    'status', case when v_final then 'final' else 'provisional' end,
    'reason', null,
    'rate', v_rate_json,
    'usedSplit', v_used,
    'lines', v_lines,
    'totals', jsonb_build_object(
      'goodsPhp', v_goods / 100,
      'chargesPhp', v_charges / 100,
      'chargeFeesPhp', v_fees / 100,
      'shippingFeesPhp', v_shipping / 100,
      'spreadPhp', v_pool / 100,
      'landedPhp', (v_goods + v_pool) / 100
    )
  );
end;
$$;

comment on function public._ipas_landed_cost(uuid) is
  '#283: the one Landed Cost calculation (#218, #244), as the IPAS page reads it. Internal: ipas_landed_cost, ipas_line_landed_costs and through them the Costing Matrix and the SOR summary all read it.';

revoke all on function public._ipas_landed_cost(uuid) from public, anon, authenticated;

-- The IPAS page's read: the same people who may read the IPAS's payments and charges.
create or replace function public.ipas_landed_cost(p_ipas_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when coalesce(public.ipas_can_read(), false) then public._ipas_landed_cost(p_ipas_id) end
$$;

comment on function public.ipas_landed_cost(uuid) is
  '#283: an IPAS''s Landed Cost, lines and totals, for whoever may read its payments and charges (ipas_can_read); null otherwise.';

revoke all on function public.ipas_landed_cost(uuid) from public, anon;
grant execute on function public.ipas_landed_cost(uuid) to authenticated;

-- Same signature as before; the rows now come from the one calculation.
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
  with lc as (select public._ipas_landed_cost(p_ipas_id) as r),
  copy as (
    select public._lc_num(e.l ->> 'line_id')::integer as lid, public._lc_num(e.l ->> 'quantity') as qty, e.ord
    from public.ipas i
    cross join lateral jsonb_array_elements(case when jsonb_typeof(i.odoo_copy -> 'lines') = 'array' then i.odoo_copy -> 'lines' else '[]'::jsonb end)
      with ordinality as e(l, ord)
    where i.id = p_ipas_id and public._lc_num(e.l ->> 'quantity') > 0
  )
  -- Unavailable: every line, no figures.
  select copy.lid, copy.qty, null::numeric, null::numeric, 'unavailable'
  from copy, lc
  where lc.r ->> 'status' = 'unavailable'
  union all
  select public._lc_num(l ->> 'lineId')::integer, (l ->> 'quantity')::numeric,
         (l ->> 'landedPerUnitPhp')::numeric, (l ->> 'landedPhp')::numeric, lc.r ->> 'status'
  from lc
  cross join lateral jsonb_array_elements(lc.r -> 'lines') as l
  where lc.r ->> 'status' <> 'unavailable'
$$;

comment on function public.ipas_line_landed_costs(uuid) is
  '#283: Landed Cost per Odoo PO line of an IPAS, read from _ipas_landed_cost (the one calculation). mark: provisional | final | unavailable. Internal: called by costing_landed_costs and ipas_summaries_for_sor.';

revoke all on function public.ipas_line_landed_costs(uuid) from public, anon, authenticated;
