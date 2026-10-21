-- #604 (spec #595): "Pesos taken from the bank" is optional.
--
-- Finance can record a foreign-currency payment the day it is made, before the bank statement
-- shows the pesos. Until it is filled:
--   * Landed Cost is shown as an ESTIMATE: that payment is taken at the Reference Rate of its
--     payment date (reference_rate: the latest on or before the date). The estimate is worked out
--     on the way out of _ipas_landed_cost and never stored; the payment's column stays blank.
--   * The Computation status can't move to LC Odoo Done (a final Landed Cost uses the rate
--     actually paid), and a payment can't be added or edited to blank once it is there.
-- The column keeps its name (php_debited); only the label changed.
--
-- Redefines (latest definitions in brackets):
--   _ipas_clean_payment     (20261013100400)  blank allowed on a foreign PO
--   _ipas_landed_cost       (20261019210000)  estimate at the Reference Rate for blank payments
--   ipas_set_header         (20261025110000)  LC Odoo Done refused while a payment is blank
-- and adds _ipas_payments_missing_pesos, the list the refusal names.
--
-- SAFE TO RUN AT ANY TIME: function bodies only. Idempotent.

-- The foreign-currency payments with the pesos still blank, as a sentence fragment naming each
-- ("Down payment of USD 1,000.00 on Oct 2, 2026; ..."); null when there are none (always null on a PHP PO).
create or replace function public._ipas_payments_missing_pesos(p_ipas_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(
           upper(left(replace(p.kind, '_', ' '), 1)) || substr(replace(p.kind, '_', ' '), 2)
             || ' of ' || upper(btrim(i.odoo_copy #>> '{po,currency}')) || ' ' || to_char(p.amount, 'FM999,999,999,990.00')
             || ' on ' || to_char(p.paid_on, 'FMMon FMDD, YYYY'),
           '; ' order by p.paid_on, p.id)
  from public.ipas i
  join public.ipas_payments p on p.ipas_id = i.id
  where i.id = p_ipas_id
    and not public._ipas_is_php(i.odoo_copy)
    and p.php_debited is null
$$;

revoke all on function public._ipas_payments_missing_pesos(uuid) from public, anon, authenticated;

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
    -- Once Landed Cost is final, it can't go back to an estimate.
    if v_php is null and p_ipas.computation_status = 'lc_odoo_done' then
      raise exception '%: % is at LC Odoo Done, so Landed Cost is final; give the pesos taken from the bank', p_fn, p_ipas.number
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
      select p.id, p.kind, p.paid_on, p.amount, p.php_debited
      from public.ipas_payments p
      where p.ipas_id = p_ipas_id and p.amount > 0
      order by p.paid_on, p.id
    loop
      v_payments := v_payments + 1;
      v_foreign := v_foreign + r.amount;
      if r.php_debited > 0 then
        v_est_php := r.php_debited;
        v_php_paid := v_php_paid + r.php_debited;
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
      then round(coalesce(case when v_php then p.amount else p.php_debited end, 0) * 100) else 0 end), 0)
    into v_fees, v_shipping
  from public.ipas_payments p where p.ipas_id = p_ipas_id;
  -- A foreign payment's shipping fee is its pesos, or its estimated pesos while those are blank.
  if not v_php then
    v_shipping := v_ship_c;
  end if;
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
      'chargeFeesPhp', v_fees / 100,
      'shippingFeesPhp', v_shipping / 100,
      'spreadPhp', v_pool / 100,
      'landedPhp', (v_goods + v_pool) / 100
    )
  );
end;
$$;

comment on function public._ipas_landed_cost(uuid) is
  '#283: the one Landed Cost calculation (#218, #244), as the IPAS page reads it. Internal: ipas_landed_cost, ipas_line_landed_costs and through them the Costing Matrix and the SOR summary all read it. #604: a foreign payment with the pesos taken from the bank blank is taken at its payment date''s Reference Rate; the result then says estimate = true (status provisional) and lists the estimated payments. Never stored.';

-- ipas_set_header: the latest definition (20261025110000) with the LC Odoo Done check.
create or replace function public.ipas_set_header(p_ipas_id uuid, p_fields jsonb)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas;
  v_key text;
  v_raw jsonb;
  v_text text;
  v_contact text;
  v_pi text;
  v_amount numeric;
  v_freight uuid;
  v_split text;
  v_status text;
  v_sheet boolean;
  v_gantt boolean;
  v_label text;
  v_remarks text;
  v_missing text;
  v_changes jsonb := '{}'::jsonb;
begin
  if v_actor is null then
    raise exception 'ipas_set_header: not signed in' using errcode = '42501';
  end if;
  -- Only Purchasing changes an IPAS (#586: Checked by is gone, so there is no Finance
  -- or Super Admin exception any more; section 3's sign-off is the check).
  if not public.has_purchasing_access() then
    raise exception 'ipas_set_header: only Purchasing changes an IPAS' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'ipas_set_header: the fields must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in (
      'supplier_contact', 'pi_number', 'pi_qt_amount', 'freight_service_id', 'landed_cost_split', 'computation_status',
      'google_sheet', 'gantt_chart', 'remarks'
    ) then
      raise exception 'ipas_set_header: % isn''t a header field you can type here', v_key using errcode = '22023';
    end if;
  end loop;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_set_header: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_set_header: % is filed; a Super Admin reopens it first', v_row.number using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_set_header: % is cancelled', v_row.number using errcode = '22023';
  end if;

  -- Remarks: free text, blank clears. A non-text value is refused with a sentence.
  v_remarks := v_row.remarks;
  if jsonb_exists(p_fields, 'remarks') then
    if jsonb_typeof(p_fields->'remarks') not in ('string', 'null') then
      raise exception 'ipas_set_header: Remarks must be text' using errcode = '22023';
    end if;
    v_remarks := nullif(btrim(p_fields->>'remarks'), '');
  end if;

  v_contact := case when jsonb_exists(p_fields, 'supplier_contact') then nullif(btrim(p_fields->>'supplier_contact'), '') else v_row.supplier_contact end;
  v_pi := case when jsonb_exists(p_fields, 'pi_number') then nullif(btrim(p_fields->>'pi_number'), '') else v_row.pi_number end;

  -- P.I/QT Amount: a number, or blank to clear. Anything half-typed is refused
  -- with a sentence, never a cast error.
  v_amount := v_row.pi_qt_amount;
  if jsonb_exists(p_fields, 'pi_qt_amount') then
    v_raw := p_fields->'pi_qt_amount';
    if jsonb_typeof(v_raw) = 'null' then
      v_amount := null;
    elsif jsonb_typeof(v_raw) = 'number' then
      v_amount := round((p_fields->>'pi_qt_amount')::numeric, 2);
    elsif jsonb_typeof(v_raw) = 'string' then
      v_text := btrim(replace(p_fields->>'pi_qt_amount', ',', ''));
      if v_text = '' then
        v_amount := null;
      elsif v_text ~ '^[0-9]+(\.[0-9]+)?$' then
        v_amount := round(v_text::numeric, 2);
      else
        raise exception 'ipas_set_header: P.I/QT Amount must be a number' using errcode = '22023';
      end if;
    else
      raise exception 'ipas_set_header: P.I/QT Amount must be a number' using errcode = '22023';
    end if;
    if v_amount is not null and v_amount < 0 then
      raise exception 'ipas_set_header: P.I/QT Amount can''t be negative' using errcode = '22023';
    end if;
  end if;

  v_freight := v_row.freight_service_id;
  if jsonb_exists(p_fields, 'freight_service_id') then
    v_raw := p_fields->'freight_service_id';
    if jsonb_typeof(v_raw) = 'null' or nullif(btrim(p_fields->>'freight_service_id'), '') is null then
      v_freight := null;
    else
      begin
        v_freight := (p_fields->>'freight_service_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'ipas_set_header: pick a freight service' using errcode = '22023';
      end;
      perform public._ipas_check_option(
        'ipas_set_header', v_freight, 'freight_service', v_row.freight_service_id, 'freight service'
      );
    end if;
  end if;

  v_split := v_row.landed_cost_split;
  if jsonb_exists(p_fields, 'landed_cost_split') then
    v_split := p_fields->>'landed_cost_split';
    if v_split is null or v_split not in ('value', 'quantity', 'equal') then
      raise exception 'ipas_set_header: Landed Cost is spread by value, by quantity or equally' using errcode = '22023';
    end if;
  end if;

  v_status := v_row.computation_status;
  if jsonb_exists(p_fields, 'computation_status') then
    v_status := p_fields->>'computation_status';
    if v_status is null or v_status not in ('encoding', 'encoded', 'lc_gs_done', 'lc_odoo_done') then
      raise exception 'ipas_set_header: the computation status is Encoding, Encoded, LC GS Done or LC Odoo Done'
        using errcode = '22023';
    end if;
    -- #604: LC Odoo Done makes Landed Cost final, and a final Landed Cost needs the pesos actually
    -- paid. Refused while a foreign-currency payment has "Pesos taken from the bank" blank.
    if v_status = 'lc_odoo_done' and v_status is distinct from v_row.computation_status then
      v_missing := public._ipas_payments_missing_pesos(v_row.id);
      if v_missing is not null then
        raise exception 'ipas_set_header: LC Odoo Done needs the pesos taken from the bank on every foreign-currency payment. Still blank: %', v_missing
          using errcode = '22023';
      end if;
    end if;
  end if;

  if v_contact is distinct from v_row.supplier_contact then
    v_changes := v_changes || jsonb_build_object('supplier_contact', jsonb_build_object('from', v_row.supplier_contact, 'to', v_contact));
  end if;
  if v_pi is distinct from v_row.pi_number then
    v_changes := v_changes || jsonb_build_object('pi_number', jsonb_build_object('from', v_row.pi_number, 'to', v_pi));
  end if;
  if v_amount is distinct from v_row.pi_qt_amount then
    v_changes := v_changes || jsonb_build_object('pi_qt_amount', jsonb_build_object('from', v_row.pi_qt_amount, 'to', v_amount));
  end if;
  if v_freight is distinct from v_row.freight_service_id then
    v_changes := v_changes || jsonb_build_object('freight_service_id', jsonb_build_object(
      'from', (select o.label from public.ipas_options o where o.id = v_row.freight_service_id),
      'to', (select o.label from public.ipas_options o where o.id = v_freight)));
  end if;
  if v_split is distinct from v_row.landed_cost_split then
    v_changes := v_changes || jsonb_build_object('landed_cost_split', jsonb_build_object('from', v_row.landed_cost_split, 'to', v_split));
  end if;
  if v_status is distinct from v_row.computation_status then
    v_changes := v_changes || jsonb_build_object('computation_status', jsonb_build_object('from', v_row.computation_status, 'to', v_status));
  end if;
  -- The section 2 ticks: plain yes or no. JSON null and any other type are refused.
  v_sheet := v_row.google_sheet;
  if jsonb_exists(p_fields, 'google_sheet') then
    if jsonb_typeof(p_fields->'google_sheet') <> 'boolean' then
      raise exception 'ipas_set_header: Googlesheet must be ticked or not ticked' using errcode = '22023';
    end if;
    v_sheet := (p_fields->>'google_sheet')::boolean;
  end if;

  v_gantt := v_row.gantt_chart;
  if jsonb_exists(p_fields, 'gantt_chart') then
    if jsonb_typeof(p_fields->'gantt_chart') <> 'boolean' then
      raise exception 'ipas_set_header: Gantt Chart must be ticked or not ticked' using errcode = '22023';
    end if;
    v_gantt := (p_fields->>'gantt_chart')::boolean;
  end if;

  if v_sheet is distinct from v_row.google_sheet then
    v_changes := v_changes || jsonb_build_object('google_sheet', jsonb_build_object('from', v_row.google_sheet, 'to', v_sheet));
  end if;
  if v_gantt is distinct from v_row.gantt_chart then
    v_changes := v_changes || jsonb_build_object('gantt_chart', jsonb_build_object('from', v_row.gantt_chart, 'to', v_gantt));
  end if;
  if v_remarks is distinct from v_row.remarks then
    v_changes := v_changes || jsonb_build_object('remarks', jsonb_build_object('from', v_row.remarks, 'to', v_remarks));
  end if;
  if v_changes = '{}'::jsonb then
    return v_row;
  end if;

  update public.ipas
     set supplier_contact = v_contact,
         pi_number = v_pi,
         pi_qt_amount = v_amount,
         freight_service_id = v_freight,
         landed_cost_split = v_split,
         computation_status = v_status,
         google_sheet = v_sheet,
         gantt_chart = v_gantt,
         remarks = v_remarks
   where id = v_row.id
  returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'header_changed', jsonb_build_object('fields', v_changes));

  return v_row;
end;
$$;
