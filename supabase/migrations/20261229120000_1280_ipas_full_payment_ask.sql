-- #1280 (spec #1276): Full payment as a request purpose.
--
--   * ipas_payment_asks.purpose accepts full_payment.
--   * ipas_ask_for_payment refuses Full payment once the IPAS has any recorded payment or any open or paid supplier
--     ask, and refuses Down payment and Balance while a Full payment ask is open or paid. Withdrawn asks count for nothing.
--   * A payment can pay a Full payment ask; the label reads "Full payment".

alter table public.ipas_payment_asks drop constraint if exists ipas_payment_asks_purpose_chk;
alter table public.ipas_payment_asks
  add constraint ipas_payment_asks_purpose_chk check (purpose in ('down_payment', 'balance', 'full_payment', 'charge'));

CREATE OR REPLACE FUNCTION public._ipas_ask_purpose_label(p_purpose text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_purpose when 'down_payment' then 'Down payment' when 'balance' then 'Balance' when 'full_payment' then 'Full payment' when 'charge' then 'Charge' when 'freight' then 'Freight' else p_purpose end;
$function$
;

CREATE OR REPLACE FUNCTION public.ipas_ask_for_payment(p_ipas_id uuid, p_amount numeric, p_purpose text, p_note text DEFAULT NULL::text, p_priority text DEFAULT 'high'::text, p_percent numeric DEFAULT NULL::numeric, p_charge_kind_id uuid DEFAULT NULL::uuid, p_currency text DEFAULT NULL::text)
 RETURNS ipas_payment_asks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_ipas public.ipas;
  v_note text := nullif(btrim(p_note), '');
  v_row public.ipas_payment_asks;
  v_kind uuid;
  v_currency text;
  v_meta jsonb;
begin
  if v_actor is null then
    raise exception 'ipas_ask_for_payment: not signed in' using errcode = '42501';
  end if;
  if not (public.has_purchasing_access() or public.has_finance_access() or coalesce(public.is_super_admin(), false)) then
    raise exception 'ipas_ask_for_payment: only Purchasing, Finance or a Super Admin asks for a payment' using errcode = '42501';
  end if;

  v_ipas := public._ipas_lock_open('ipas_ask_for_payment', p_ipas_id);

  if p_amount is null or p_amount <= 0 then
    raise exception 'ipas_ask_for_payment: the amount must be more than zero' using errcode = '22023';
  end if;
  if p_purpose is null or p_purpose not in ('down_payment', 'balance', 'full_payment', 'charge') then
    raise exception 'ipas_ask_for_payment: the purpose must be Down payment, Balance, Full payment or Charge' using errcode = '22023';
  end if;
  if p_priority is null or p_priority not in ('very_high', 'high', 'medium') then
    raise exception 'ipas_ask_for_payment: the priority must be Very High, High or Medium' using errcode = '22023';
  end if;
  if p_percent is not null and (p_percent <= 0 or p_percent > 1000) then
    raise exception 'ipas_ask_for_payment: the %% of order must be more than zero and at most 1000' using errcode = '22023';
  end if;
  if p_purpose = 'charge' and p_percent is not null then
    raise exception 'ipas_ask_for_payment: a Charge ask has no %% of order (it applies to a supplier ask only)' using errcode = '22023';
  end if;

  -- Full payment is the whole order in one go (#1280): refused once anything is paid or asked, and Down payment
  -- and Balance are refused while a Full payment ask is open or paid. A withdrawn ask counts for nothing.
  if p_purpose = 'full_payment' then
    if exists (select 1 from public.ipas_payments where ipas_id = v_ipas.id)
       or exists (select 1 from public.ipas_payment_asks
                   where ipas_id = v_ipas.id and purpose <> 'charge' and closed_reason is distinct from 'withdrawn') then
      raise exception 'ipas_ask_for_payment: there''s already a payment or an open request; use Balance for the rest' using errcode = '22023';
    end if;
  elsif p_purpose in ('down_payment', 'balance') then
    if exists (select 1 from public.ipas_payment_asks
                where ipas_id = v_ipas.id and purpose = 'full_payment' and closed_reason is distinct from 'withdrawn') then
      raise exception 'ipas_ask_for_payment: a Full payment is already asked' using errcode = '22023';
    end if;
  end if;

  if p_purpose = 'charge' then
    if p_charge_kind_id is null then
      raise exception 'ipas_ask_for_payment: pick the kind of charge' using errcode = '22023';
    end if;
    perform public._ipas_check_option('ipas_ask_for_payment', p_charge_kind_id, 'charge_kind', null, 'charge kind');
    v_kind := p_charge_kind_id;
    v_currency := upper(btrim(coalesce(nullif(btrim(p_currency), ''), 'PHP')));
    if v_currency !~ '^[A-Z]{3}$' then
      raise exception 'ipas_ask_for_payment: the currency must be a three-letter code like PHP' using errcode = '22023';
    end if;
  else
    -- A supplier ask is in the PO's currency (null) or in pesos (#1277).
    v_currency := nullif(upper(btrim(coalesce(p_currency, ''))), '');
    if v_currency is not null and v_currency <> 'PHP' then
      raise exception 'ipas_ask_for_payment: a supplier ask is in the PO currency or in PHP' using errcode = '22023';
    end if;
    if v_currency = 'PHP' then
      if upper(btrim(coalesce(v_ipas.odoo_copy #>> '{po,currency}', ''))) in ('', 'PHP') then
        raise exception 'ipas_ask_for_payment: this PO is already in pesos, so the ask needs no PHP switch' using errcode = '22023';
      end if;
      if p_percent is not null then
        raise exception 'ipas_ask_for_payment: an ask in PHP has no %% of order' using errcode = '22023';
      end if;
    end if;
  end if;

  insert into public.ipas_payment_asks (ipas_id, amount, purpose, note, priority, percent_of_order, asked_by, charge_kind_id, currency)
  values (v_ipas.id, p_amount, p_purpose, v_note, p_priority, p_percent, v_actor, v_kind, v_currency)
  returning * into v_row;

  v_meta := public._ipas_ask_meta(v_row);
  perform public._ipas_payment_ask_to_chat(
    v_ipas.id, 'payment_ask_opened',
    'Asked for payment: ' || (v_meta ->> 'purpose_label') || ' '
      || btrim((v_meta ->> 'currency') || ' ' || trim(to_char(p_amount, 'FM999G999G999G990.00')))
      || coalesce(' (' || trim(trailing '.' from trim(trailing '0' from to_char(p_percent, 'FM9990.0000'))) || '% of the order)', '')
      || ', ' || public._ipas_ask_priority_label(p_priority) || ' priority'
      || coalesce(' (' || v_note || ')', '') || '.',
    v_row.id,
    v_meta
  );
  return v_row;
end;
$function$
;

revoke all on function public.ipas_ask_for_payment(uuid, numeric, text, text, text, numeric, uuid, text) from public, anon;
grant execute on function public.ipas_ask_for_payment(uuid, numeric, text, text, text, numeric, uuid, text) to authenticated;

-- A payment can pay a Down payment, Balance or Full payment ask (never a Charge ask)
CREATE OR REPLACE FUNCTION public._ipas_payment_closes_ask()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_meta jsonb;
  v_ask public.ipas_payment_asks;
  v_pay_currency text;
begin
  if new.ask_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.ask_id is not distinct from new.ask_id then
    return null;
  end if;

  select * into v_ask from public.ipas_payment_asks where id = new.ask_id for update;
  if v_ask.id is null then
    raise exception 'that ask for payment was not found' using errcode = '22023';
  end if;
  if v_ask.ipas_id is distinct from new.ipas_id then
    raise exception 'that ask for payment is on another IPAS' using errcode = '22023';
  end if;
  if v_ask.closed_at is not null then
    raise exception 'that ask for payment is already closed' using errcode = '22023';
  end if;
  if v_ask.purpose not in ('down_payment', 'balance', 'full_payment') then
    raise exception 'a payment cannot pay a Charge ask; record a charge instead' using errcode = '22023';
  end if;

  update public.ipas_payment_asks
     set closed_at = now(), closed_by = public.get_employee_id(), closed_reason = 'paid',
         paid_by_payment_id = new.id
   where id = v_ask.id;

  v_meta := public._ipas_ask_meta(v_ask);
  -- The ask keeps its own currency (a request in pesos); the payment is in the PO's currency, which is its own.
  select coalesce(nullif(i.odoo_copy -> 'po' ->> 'currency', ''), '') into v_pay_currency
    from public.ipas i where i.id = new.ipas_id;
  perform public._ipas_payment_ask_to_chat(
    new.ipas_id, 'payment_ask_closed',
    'Paid the ask for payment: ' || (v_meta ->> 'purpose_label') || ' '
      || btrim((v_meta ->> 'currency') || ' ' || trim(to_char(v_ask.amount, 'FM999G999G999G990.00')))
      || ' (payment of ' || btrim(coalesce(v_pay_currency, '') || ' ' || trim(to_char(new.amount, 'FM999G999G999G990.00'))) || ' recorded).',
    v_ask.id,
    v_meta || jsonb_build_object('reason', 'paid', 'payment_id', new.id, 'paid_amount', new.amount)
  );
  return null;
end;
$function$
;
