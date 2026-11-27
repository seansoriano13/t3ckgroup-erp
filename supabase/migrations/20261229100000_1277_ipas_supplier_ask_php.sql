-- #1277 (spec #1276): a supplier ask (Down payment, Balance) can be made in pesos.
--
--   * ipas_payment_asks.currency is null (the P0's currency) or 'PHP' for a Down payment / Balance ask.
--   * PHP is refused on a peso PO (nothing to switch to), and a PHP ask has no % of order.
--   * ipas_ask_for_payment and ipas_edit_payment_ask take the currency.
-- A Charge ask is unchanged: it always names its own currency.

alter table public.ipas_payment_asks drop constraint if exists ipas_payment_asks_charge_chk;
alter table public.ipas_payment_asks
  add constraint ipas_payment_asks_charge_chk check (
    (purpose = 'charge' and charge_kind_id is not null and currency is not null)
    or (purpose <> 'charge' and charge_kind_id is null and (currency is null or currency = 'PHP'))
  );
alter table public.ipas_payment_asks drop constraint if exists ipas_payment_asks_php_percent_chk;
alter table public.ipas_payment_asks
  add constraint ipas_payment_asks_php_percent_chk check (
    purpose = 'charge' or currency is null or percent_of_order is null
  );

comment on column public.ipas_payment_asks.currency is
  'A Charge ask: the currency it is billed in, default PHP (#1227). A Down payment or Balance ask: null (the PO currency) or PHP, asked in pesos (#1277).';

-- ---------------------------------------------------------------------------
-- Ask for payment
-- ---------------------------------------------------------------------------
drop function if exists public.ipas_ask_for_payment(uuid, numeric, text, text, text, numeric, uuid, text);

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
  if p_purpose is null or p_purpose not in ('down_payment', 'balance', 'charge') then
    raise exception 'ipas_ask_for_payment: the purpose must be Down payment, Balance or Charge' using errcode = '22023';
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

-- ---------------------------------------------------------------------------
-- Edit an open ask: a supplier ask can change its currency (PO currency or PHP)
-- ---------------------------------------------------------------------------
drop function if exists public.ipas_edit_payment_ask(uuid, numeric, text, text, numeric);

CREATE OR REPLACE FUNCTION public.ipas_edit_payment_ask(p_ask_id uuid, p_amount numeric, p_priority text, p_note text DEFAULT NULL::text, p_percent numeric DEFAULT NULL::numeric, p_currency text DEFAULT NULL::text)
 RETURNS ipas_payment_asks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_changes jsonb;
  v_meta jsonb;
  v_actor uuid := public.get_employee_id();
  v_ask public.ipas_payment_asks;
  v_ipas public.ipas;
  v_note text := nullif(btrim(p_note), '');
  v_row public.ipas_payment_asks;
  v_currency text;
begin
  if v_actor is null then
    raise exception 'ipas_edit_payment_ask: not signed in' using errcode = '42501';
  end if;
  if not (public.has_purchasing_access() or public.has_finance_access() or coalesce(public.is_super_admin(), false)) then
    raise exception 'ipas_edit_payment_ask: only Purchasing, Finance or a Super Admin edits an ask' using errcode = '42501';
  end if;

  select * into v_ask from public.ipas_payment_asks where id = p_ask_id;
  if v_ask.id is null then
    raise exception 'ipas_edit_payment_ask: that ask was not found' using errcode = '22023';
  end if;
  v_ipas := public._ipas_lock_open('ipas_edit_payment_ask', v_ask.ipas_id);

  select * into v_ask from public.ipas_payment_asks where id = p_ask_id for update;
  if v_ask.closed_at is not null then
    raise exception 'ipas_edit_payment_ask: that ask is closed and can''t be edited' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'ipas_edit_payment_ask: the amount must be more than zero' using errcode = '22023';
  end if;
  if p_priority is null or p_priority not in ('very_high', 'high', 'medium') then
    raise exception 'ipas_edit_payment_ask: the priority must be Very High, High or Medium' using errcode = '22023';
  end if;
  if p_percent is not null and (p_percent <= 0 or p_percent > 1000) then
    raise exception 'ipas_edit_payment_ask: the %% of order must be more than zero and at most 1000' using errcode = '22023';
  end if;
  if p_percent is not null and v_ask.purpose = 'charge' then
    raise exception 'ipas_edit_payment_ask: a Charge ask has no %% of order (it applies to a supplier ask only)' using errcode = '22023';
  end if;

  if v_ask.purpose = 'charge' then
    -- A Charge ask keeps the currency it was made in.
    v_currency := v_ask.currency;
  else
    v_currency := nullif(upper(btrim(coalesce(p_currency, ''))), '');
    if v_currency is not null and v_currency <> 'PHP' then
      raise exception 'ipas_edit_payment_ask: a supplier ask is in the PO currency or in PHP' using errcode = '22023';
    end if;
    if v_currency = 'PHP' then
      if upper(btrim(coalesce(v_ipas.odoo_copy #>> '{po,currency}', ''))) in ('', 'PHP') then
        raise exception 'ipas_edit_payment_ask: this PO is already in pesos, so the ask needs no PHP switch' using errcode = '22023';
      end if;
      if p_percent is not null then
        raise exception 'ipas_edit_payment_ask: an ask in PHP has no %% of order' using errcode = '22023';
      end if;
    end if;
  end if;

  if v_ask.amount = p_amount and v_ask.priority = p_priority
     and v_ask.note is not distinct from v_note and v_ask.percent_of_order is not distinct from p_percent
     and v_ask.currency is not distinct from v_currency then
    return v_ask;
  end if;

  update public.ipas_payment_asks
     set amount = p_amount, priority = p_priority, note = v_note, percent_of_order = p_percent, currency = v_currency
   where id = v_ask.id
  returning * into v_row;

  v_meta := public._ipas_ask_meta(v_row);
  v_changes := public._ipas_diff(
    jsonb_build_object('amount', v_ask.amount, 'priority', public._ipas_ask_priority_label(v_ask.priority),
                       'note', v_ask.note, 'percent_of_order', v_ask.percent_of_order, 'currency', v_ask.currency),
    jsonb_build_object('amount', v_row.amount, 'priority', public._ipas_ask_priority_label(v_row.priority),
                       'note', v_row.note, 'percent_of_order', v_row.percent_of_order, 'currency', v_row.currency));
  perform public._ipas_payment_ask_to_chat(
    v_ipas.id, 'payment_ask_edited',
    'Changed the ask for payment (' || (v_meta ->> 'purpose_label') || ' ' || btrim((v_meta ->> 'currency') || ' '
      || trim(to_char(v_row.amount, 'FM999G999G999G990.00'))) || '): ' || public._ipas_changes_text(v_changes) || '.',
    v_row.id, v_meta || jsonb_build_object('changes', v_changes)
  );
  return v_row;
end;
$function$
;

revoke all on function public.ipas_edit_payment_ask(uuid, numeric, text, text, numeric, text) from public, anon;
grant execute on function public.ipas_edit_payment_ask(uuid, numeric, text, text, numeric, text) to authenticated;
