-- #709 (spec #699): IPAS freight amount and pre-filled charges, each with its file.
--
-- ipas gains freight_amount, freight_currency, freight_billed_by_supplier, freight_attachment_url.
--   Freight billed by the supplier is already inside the payments, so Landed Cost does not add it
--   again. Any other freight is added to the pool and converts at the blended rate.
-- ipas_charges: the amount and the date may be blank (a charge not filled in yet), and each charge
--   carries a file (attachment_url).
-- A new Import IPAS starts with one blank charge for every active charge kind.
-- A blank amount means unknown. Screen 3 (stored section 6) cannot be submitted while any charge is
--   blank, or while a charge with an amount has no file.
-- ipas_set_freight and ipas_fill_charge write them (Purchasing or Finance, open IPAS).
-- _ipas_landed_cost adds freight to the pool and reports it as totals.freightPhp.
-- Safe to run at any time: new nullable columns, relaxed checks, create or replace.

alter table public.ipas
  add column if not exists freight_amount numeric(14, 2),
  add column if not exists freight_currency text,
  add column if not exists freight_billed_by_supplier boolean not null default false,
  add column if not exists freight_attachment_url text;

alter table public.ipas drop constraint if exists ipas_freight_amount_chk;
alter table public.ipas add constraint ipas_freight_amount_chk check (freight_amount is null or freight_amount >= 0);

comment on column public.ipas.freight_amount is
  '#709: freight in freight_currency. Null = none typed. Not added to Landed Cost when freight_billed_by_supplier.';

alter table public.ipas_charges
  alter column charged_on drop not null,
  alter column amount_php drop not null,
  add column if not exists attachment_url text;

alter table public.ipas_charges drop constraint if exists ipas_charges_amount_chk;
alter table public.ipas_charges add constraint ipas_charges_amount_chk check (amount_php is null or amount_php > 0);

comment on column public.ipas_charges.attachment_url is
  '#709: the file for this charge. Needed before screen 3 is submitted when the charge has an amount.';

-- One blank charge per active charge kind on a new Import IPAS.
create or replace function public._ipas_seed_blank_charges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source = 'import' then
    insert into public.ipas_charges (ipas_id, kind_id, charged_on, amount_php)
    select new.id, o.id, null, null
      from public.ipas_options o
     where o.list = 'charge_kind' and o.active
     order by o.sort, o.label;
  end if;
  return new;
end;
$$;

revoke all on function public._ipas_seed_blank_charges() from public, anon, authenticated;

drop trigger if exists ipas_seed_blank_charges on public.ipas;
create trigger ipas_seed_blank_charges
  after insert on public.ipas
  for each row execute function public._ipas_seed_blank_charges();

-- Freight: amount, currency, billed-by-supplier mark and file.
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
  v_url text := nullif(btrim(coalesce(p_attachment_url, '')), '');
  v_row public.ipas;
begin
  v_ipas := public._ipas_lock_open('ipas_set_freight', p_ipas_id);
  if v_amount is not null and v_amount < 0 then
    raise exception 'ipas_set_freight: the freight can''t be negative' using errcode = '22023';
  end if;
  if v_amount is not null and v_currency is null then
    v_currency := 'PHP';
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

revoke all on function public.ipas_set_freight(uuid, numeric, text, boolean, text) from public, anon;
grant execute on function public.ipas_set_freight(uuid, numeric, text, boolean, text) to authenticated;

-- Fill (or clear) a charge: date, amount and file. A blank amount and date mean "not filled in yet".
create or replace function public.ipas_fill_charge(
  p_charge_id uuid,
  p_charged_on date,
  p_amount_php numeric,
  p_attachment_url text
) returns public.ipas_charges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_money_writer('ipas_fill_charge');
  v_ipas_id uuid;
  v_ipas public.ipas;
  v_before public.ipas_charges;
  v_row public.ipas_charges;
  v_amount numeric := round(p_amount_php, 2);
  v_url text := nullif(btrim(coalesce(p_attachment_url, '')), '');
begin
  select ipas_id into v_ipas_id from public.ipas_charges where id = p_charge_id;
  if v_ipas_id is null then
    raise exception 'ipas_fill_charge: charge % not found', p_charge_id using errcode = 'P0002';
  end if;
  v_ipas := public._ipas_lock_open('ipas_fill_charge', v_ipas_id);
  select * into v_before from public.ipas_charges where id = p_charge_id for update;
  if v_amount is not null and v_amount <= 0 then
    raise exception 'ipas_fill_charge: the amount must be more than zero' using errcode = '22023';
  end if;
  if v_before.charged_on is not distinct from p_charged_on
     and v_before.amount_php is not distinct from v_amount
     and v_before.attachment_url is not distinct from v_url then
    return v_before;
  end if;

  update public.ipas_charges
     set charged_on = p_charged_on, amount_php = v_amount, attachment_url = v_url
   where id = v_before.id
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'charge_changed', jsonb_build_object(
    'charge_id', v_row.id,
    'kind', (select o.label from public.ipas_options o where o.id = v_row.kind_id),
    'changes', jsonb_build_object('amount_php', jsonb_build_object('from', v_before.amount_php, 'to', v_amount))
  ));
  return v_row;
end;
$$;

revoke all on function public.ipas_fill_charge(uuid, date, numeric, text) from public, anon;
grant execute on function public.ipas_fill_charge(uuid, date, numeric, text) to authenticated;

-- Screen 3 (stored section 6) cannot be submitted with a blank charge, or an unfiled charge that has an amount.
create or replace function public._ipas_signoff_charges_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_blank integer;
  v_nofile integer;
begin
  if new.section = 6 and new.role = 'prepared' then
    select count(*) filter (where amount_php is null),
           count(*) filter (where amount_php is not null and attachment_url is null)
      into v_blank, v_nofile
      from public.ipas_charges where ipas_id = new.ipas_id;
    if v_blank > 0 then
      raise exception 'ipas_sign: % charge(s) are blank. Fill each in or remove it first', v_blank
        using errcode = '22023';
    end if;
    if v_nofile > 0 then
      raise exception 'ipas_sign: % charge(s) with an amount have no file', v_nofile
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public._ipas_signoff_charges_guard() from public, anon, authenticated;

drop trigger if exists ipas_signoffs_charges_guard on public.ipas_signoffs;
create trigger ipas_signoffs_charges_guard
  before insert on public.ipas_signoffs
  for each row execute function public._ipas_signoff_charges_guard();

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
  -- Freight (#709): its own amount, unless the supplier already billed it inside the payments. It
  -- converts at the blended rate when it is in the PO's currency; a peso freight is taken as it is.
  if v_ipas.freight_amount is not null and not coalesce(v_ipas.freight_billed_by_supplier, false) then
    if upper(btrim(coalesce(v_ipas.freight_currency, 'PHP'))) = 'PHP' then
      v_freight := round(v_ipas.freight_amount * 100);
    elsif not v_php and upper(btrim(v_ipas.freight_currency)) = upper(btrim(coalesce(v_currency, ''))) then
      v_freight := round(v_ipas.freight_amount * v_rate * 100);
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
  '#283: the one Landed Cost calculation (#218, #244), as the IPAS page reads it. Internal: ipas_landed_cost, ipas_line_landed_costs and through them the Costing Matrix and the SOR summary all read it. #604: a foreign payment with the pesos taken from the bank blank is taken at its payment date''s Reference Rate; the result then says estimate = true (status provisional) and lists the estimated payments. Never stored.';
