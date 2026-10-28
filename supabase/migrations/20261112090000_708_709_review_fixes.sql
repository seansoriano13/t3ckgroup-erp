-- Review fixes for spec #699 (#708, #709).
--
-- 1. _ipas_landed_cost reads a payment's pesos as amount x forex_rate (php_debited only for an old
--    payment with no rate), so Landed Cost never depends on a separately-written php_debited.
-- 2. Freight: a typed freight amount replaces the older shipping-fee payments (no double count);
--    freight billed by the supplier adds nothing; freight in a currency other than PHP or the PO's
--    makes Landed Cost "unavailable" (reason freight_currency) instead of being dropped, and
--    ipas_set_freight refuses it.
-- 3. ipas_save_payment: one call that writes the payment, its pesos (amount x rate) and its rate and
--    fees in a single transaction (the app used two calls before).
--
-- SAFE TO RUN AT ANY TIME: function replacements and one new function.

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
  v_freight   numeric := 0;
  v_pool      numeric;
  v_lines     jsonb;
  v_goods     numeric;
  v_base      jsonb;
  r           record;
  v_ref       numeric;
  v_ref_date  date;
  v_est_php   numeric;
  v_est_n     integer := 0;
  v_est_php_t numeric := 0;
  v_estimates jsonb := '[]'::jsonb;
  v_ship_c    numeric := 0;
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
    'estimate', false,
    'estimates', '[]'::jsonb,
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

  -- A foreign PO converts at what was actually paid: combined pesos taken from the bank / combined
  -- amount. A payment whose "Pesos taken from the bank" is still blank (#604) is taken at the
  -- Reference Rate of its payment date instead, which makes the whole figure an estimate. That
  -- estimate is only ever worked out here, on the way out; nothing is written back.
  if not v_php then
    v_php_paid := 0;
    v_foreign := 0;
    v_payments := 0;
    for r in
      select p.id, p.kind, p.paid_on, p.amount,
             case when p.forex_rate > 0 then round(p.amount * p.forex_rate, 2) else p.php_debited end as pesos
      from public.ipas_payments p
      where p.ipas_id = p_ipas_id and p.amount > 0
      order by p.paid_on, p.id
    loop
      v_payments := v_payments + 1;
      v_foreign := v_foreign + r.amount;
      if r.pesos > 0 then
        v_est_php := r.pesos;
        v_php_paid := v_php_paid + r.pesos;
      else
        v_ref := null;
        select rr.php_per_unit, rr.rate_date into v_ref, v_ref_date
        from public.reference_rate(v_currency, r.paid_on) rr;
        if v_ref is null then
          return v_base || jsonb_build_object('status', 'unavailable', 'reason', 'no_reference_rate');
        end if;
        v_est_php := round(r.amount * v_ref, 2);
        v_php_paid := v_php_paid + v_est_php;
        v_est_php_t := v_est_php_t + v_est_php;
        v_est_n := v_est_n + 1;
        v_estimates := v_estimates || jsonb_build_object(
          'paymentId', r.id, 'kind', r.kind, 'paidOn', r.paid_on, 'amount', r.amount,
          'referenceRate', v_ref, 'rateDate', v_ref_date, 'php', v_est_php);
      end if;
      if r.kind = 'shipping_fee' then
        v_ship_c := v_ship_c + round(v_est_php * 100);
      end if;
    end loop;
    if v_payments = 0 or v_foreign = 0 then
      return v_base || jsonb_build_object('status', 'unavailable', 'reason', 'no_payments');
    end if;
    v_rate := v_php_paid / v_foreign;
    v_rate_json := jsonb_build_object(
      'rate', v_rate, 'phpDebited', v_php_paid, 'foreignPaid', v_foreign, 'payments', v_payments,
      'estimatedPayments', v_est_n, 'estimatedPhp', v_est_php_t);
  end if;

  -- The pool, in centavos: every charge, every charge fee and every shipping fee.
  select coalesce(sum(round(coalesce(c.amount_php, 0) * 100)), 0) into v_charges
  from public.ipas_charges c where c.ipas_id = p_ipas_id;
  select
    coalesce(sum(round(coalesce(p.charge_fee_php, 0) * 100)), 0),
    coalesce(sum(case when p.kind = 'shipping_fee'
      then round(coalesce(case when v_php then p.amount else case when p.forex_rate > 0 then round(p.amount * p.forex_rate, 2) else p.php_debited end end, 0) * 100) else 0 end), 0)
    into v_fees, v_shipping
  from public.ipas_payments p where p.ipas_id = p_ipas_id;
  -- A foreign payment's shipping fee is its pesos, or its estimated pesos while those are blank.
  if not v_php then
    v_shipping := v_ship_c;
  end if;
  -- Freight (#709). Its own amount is the freight when one is typed; the older shipping-fee payments
  -- then no longer count (they would be the same freight twice). Freight the supplier billed is
  -- already inside the payments, so nothing is added for it. Freight in the PO's currency converts
  -- at the blended rate; a peso freight is taken as it is; any other currency can't be converted.
  if v_ipas.freight_amount is not null then
    v_shipping := 0;
    if upper(btrim(coalesce(v_ipas.freight_currency, 'PHP'))) <> 'PHP'
       and (v_php or upper(btrim(v_ipas.freight_currency)) <> upper(btrim(coalesce(v_currency, '')))) then
      return v_base || jsonb_build_object('status', 'unavailable', 'reason', 'freight_currency');
    end if;
    if not coalesce(v_ipas.freight_billed_by_supplier, false) then
      if upper(btrim(coalesce(v_ipas.freight_currency, 'PHP'))) = 'PHP' then
        v_freight := round(v_ipas.freight_amount * 100);
      else
        v_freight := round(v_ipas.freight_amount * v_rate * 100);
      end if;
    end if;
  end if;
  v_pool := v_charges + v_freight + v_fees + v_shipping;

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
    'status', case when v_final and v_est_n = 0 then 'final' else 'provisional' end,
    'estimate', v_est_n > 0,
    'estimates', v_estimates,
    'reason', null,
    'rate', v_rate_json,
    'usedSplit', v_used,
    'lines', v_lines,
    'totals', jsonb_build_object(
      'goodsPhp', v_goods / 100,
      'chargesPhp', v_charges / 100,
      'freightPhp', v_freight / 100,
      'chargeFeesPhp', v_fees / 100,
      'shippingFeesPhp', v_shipping / 100,
      'spreadPhp', v_pool / 100,
      'landedPhp', (v_goods + v_pool) / 100
    )
  );
end;
$$;

comment on function public._ipas_landed_cost(uuid) is
  '#708/#709 review fixes: payments are read as amount x forex_rate (php_debited only when there is no rate). #283: the one Landed Cost calculation (#218, #244), as the IPAS page reads it. Internal: ipas_landed_cost, ipas_line_landed_costs and through them the Costing Matrix and the SOR summary all read it. #604: a foreign payment with the pesos taken from the bank blank is taken at its payment date''s Reference Rate; the result then says estimate = true (status provisional) and lists the estimated payments. Never stored.';

create or replace function public.ipas_save_payment(
  p_ipas_id uuid,
  p_payment_id uuid,
  p_kind text,
  p_paid_on date,
  p_amount numeric,
  p_forex_rate numeric,
  p_doc_stamp_php numeric,
  p_misc_fee_php numeric,
  p_charge_fee_php numeric,
  p_method_id uuid,
  p_check_no text,
  p_proof_url text
) returns public.ipas_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ipas public.ipas;
  v_php boolean;
  v_rate numeric := round(p_forex_rate, 6);
  v_pesos numeric;
  v_row public.ipas_payments;
begin
  if p_payment_id is null then
    v_ipas := public._ipas_lock_open('ipas_save_payment', p_ipas_id);
  else
    select i.* into v_ipas
      from public.ipas i join public.ipas_payments p on p.ipas_id = i.id
     where p.id = p_payment_id;
    if v_ipas.id is null then
      raise exception 'ipas_save_payment: payment % not found', p_payment_id using errcode = '22023';
    end if;
  end if;
  v_php := upper(btrim(coalesce(v_ipas.odoo_copy #>> '{po,currency}', ''))) = 'PHP';
  if v_php then
    v_rate := null;
  elsif v_rate is not null and v_rate <= 0 then
    raise exception 'ipas_save_payment: the forex rate must be more than zero' using errcode = '22023';
  end if;
  v_pesos := case when v_rate is null then null else round(p_amount * v_rate, 2) end;

  -- One transaction: if any step refuses, nothing is kept.
  if p_payment_id is null then
    v_row := public.ipas_add_payment(v_ipas.id, p_kind, p_paid_on, p_amount, v_pesos, p_charge_fee_php,
                                     p_method_id, p_check_no, p_proof_url);
  else
    v_row := public.ipas_update_payment(p_payment_id, p_kind, p_paid_on, p_amount, v_pesos, p_charge_fee_php,
                                        p_method_id, p_check_no, p_proof_url);
  end if;
  return public.ipas_set_payment_money(v_row.id, v_rate, p_doc_stamp_php, p_misc_fee_php);
end;
$$;

revoke all on function public.ipas_save_payment(uuid, uuid, text, date, numeric, numeric, numeric, numeric, numeric, uuid, text, text) from public, anon;
grant execute on function public.ipas_save_payment(uuid, uuid, text, date, numeric, numeric, numeric, numeric, numeric, uuid, text, text) to authenticated;

-- ipas_set_freight now refuses a currency Landed Cost can't convert (latest before: 20261106130000).
create or replace function public.ipas_set_freight(
  p_ipas_id uuid,
  p_amount numeric,
  p_currency text,
  p_billed_by_supplier boolean,
  p_attachment_url text
) returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_money_writer('ipas_set_freight');
  v_ipas public.ipas;
  v_amount numeric := round(p_amount, 2);
  v_currency text := nullif(upper(btrim(coalesce(p_currency, ''))), '');
  v_po text;
  v_url text := nullif(btrim(coalesce(p_attachment_url, '')), '');
  v_row public.ipas;
begin
  v_ipas := public._ipas_lock_open('ipas_set_freight', p_ipas_id);
  v_po := upper(btrim(coalesce(v_ipas.odoo_copy #>> '{po,currency}', '')));
  if v_amount is not null and v_amount < 0 then
    raise exception 'ipas_set_freight: the freight can''t be negative' using errcode = '22023';
  end if;
  if v_amount is not null and v_currency is null then
    v_currency := 'PHP';
  end if;
  if v_amount is not null and v_currency <> 'PHP' and v_currency is distinct from v_po then
    raise exception 'ipas_set_freight: freight can only be in pesos or in the PO''s currency (%)',
      coalesce(nullif(v_po, ''), 'PHP') using errcode = '22023';
  end if;
  if v_ipas.freight_amount is not distinct from v_amount
     and v_ipas.freight_currency is not distinct from v_currency
     and v_ipas.freight_billed_by_supplier = coalesce(p_billed_by_supplier, false)
     and v_ipas.freight_attachment_url is not distinct from v_url then
    return v_ipas;
  end if;

  update public.ipas
     set freight_amount = v_amount,
         freight_currency = v_currency,
         freight_billed_by_supplier = coalesce(p_billed_by_supplier, false),
         freight_attachment_url = v_url
   where id = v_ipas.id
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'header_changed', jsonb_build_object(
    'changes', jsonb_build_object('freight', jsonb_build_object(
      'from', v_ipas.freight_amount, 'to', v_amount))
  ));
  return v_row;
end;
$$;
