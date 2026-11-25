-- ==============================================================================
-- #1222 (spec #1220): a Super Admin records IPAS payments, charges and asks
--
-- Until now only Purchasing access or Finance access could add, edit or remove
-- a payment or a charge, or ask for and withdraw a payment. The General
-- Manager is a Super Admin with neither flag, so she could not record a payment
-- the moment she released it. Now Purchasing access, Finance access or Super
-- Admin is enough, for payments, charges and asks only.
--
-- _ipas_money_writer is shared with freight and withholding, which stay with
-- Purchasing and Finance. They move to _ipas_freight_writer, which keeps the old
-- rule. A filed or cancelled IPAS stays closed to everyone (_ipas_lock_open).
--
-- SAFE TO RUN AGAIN: create or replace only; no data changes.
-- ==============================================================================

-- The old rule, for the two writers that stay closed to a Super Admin.
create or replace function public._ipas_freight_writer(p_fn text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
begin
  if v_actor is null then
    raise exception '%: not signed in', p_fn using errcode = '42501';
  end if;
  if not (public.has_purchasing_access() or public.has_finance_access()) then
    raise exception '%: only Purchasing or Finance records payments and charges', p_fn using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

revoke all on function public._ipas_freight_writer(text) from public, anon, authenticated;

-- Payments, charges and their money: Purchasing, Finance or a Super Admin.
create or replace function public._ipas_money_writer(p_fn text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
begin
  if v_actor is null then
    raise exception '%: not signed in', p_fn using errcode = '42501';
  end if;
  if not (public.has_purchasing_access() or public.has_finance_access() or coalesce(public.is_super_admin(), false)) then
    raise exception '%: only Purchasing, Finance or a Super Admin records payments and charges', p_fn using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

revoke all on function public._ipas_money_writer(text) from public, anon, authenticated;

-- Freight: same body as before, on the old rule.
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
  v_actor uuid := public._ipas_freight_writer('ipas_set_freight');
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

revoke all on function public.ipas_set_freight(uuid, numeric, text, boolean, text) from public, anon;
grant execute on function public.ipas_set_freight(uuid, numeric, text, boolean, text) to authenticated;

-- Withholding: same body as before, on the old rule.
create or replace function public.ipas_set_withholding(p_ipas_id uuid, p_withholding text)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_freight_writer('ipas_set_withholding');
  v_ipas public.ipas;
  v_value text := nullif(btrim(coalesce(p_withholding, '')), '');
  v_row public.ipas;
begin
  v_ipas := public._ipas_lock_open('ipas_set_withholding', p_ipas_id);
  if v_value is not null and v_value not in ('1', '2', 'not_applicable') then
    raise exception 'ipas_set_withholding: pick 1%%, 2%% or Not applicable' using errcode = '22023';
  end if;
  if v_value is not null and v_ipas.source is distinct from 'local' then
    raise exception 'ipas_set_withholding: Withholding (2307) is only for a Local IPAS' using errcode = '22023';
  end if;
  if v_ipas.withholding is not distinct from v_value then
    return v_ipas;
  end if;

  update public.ipas set withholding = v_value where id = v_ipas.id returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'header_changed', jsonb_build_object(
    'fields', jsonb_build_object('withholding', jsonb_build_object('from', v_ipas.withholding, 'to', v_value))
  ));
  return v_row;
end;
$$;

revoke all on function public.ipas_set_withholding(uuid, text) from public, anon;
grant execute on function public.ipas_set_withholding(uuid, text) to authenticated;

-- Ask for payment: Purchasing, Finance or a Super Admin.
create or replace function public.ipas_ask_for_payment(
  p_ipas_id uuid,
  p_amount numeric,
  p_purpose text,
  p_note text default null,
  p_priority text default 'high',
  p_percent numeric default null
) returns public.ipas_payment_asks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_ipas public.ipas;
  v_note text := nullif(btrim(p_note), '');
  v_row public.ipas_payment_asks;
  v_currency text;
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
  if p_purpose is null or p_purpose not in ('down_payment', 'balance', 'freight') then
    raise exception 'ipas_ask_for_payment: the purpose must be Down payment, Balance or Freight' using errcode = '22023';
  end if;
  if p_priority is null or p_priority not in ('very_high', 'high', 'medium') then
    raise exception 'ipas_ask_for_payment: the priority must be Very High, High or Medium' using errcode = '22023';
  end if;
  if p_percent is not null and (p_percent <= 0 or p_percent > 1000) then
    raise exception 'ipas_ask_for_payment: the %% of order must be more than zero and at most 1000' using errcode = '22023';
  end if;
  if exists (select 1 from public.ipas_payment_asks where ipas_id = v_ipas.id and closed_at is null) then
    raise exception 'ipas_ask_for_payment: % already has an open ask; withdraw it first', v_ipas.number using errcode = '23505';
  end if;

  insert into public.ipas_payment_asks (ipas_id, amount, purpose, note, priority, percent_of_order, asked_by)
  values (v_ipas.id, p_amount, p_purpose, v_note, p_priority, p_percent, v_actor)
  returning * into v_row;

  v_currency := coalesce(nullif(v_ipas.odoo_copy->'po'->>'currency', ''), '');
  perform public._ipas_payment_ask_to_chat(
    v_ipas.id, 'payment_ask_opened',
    'Asked for payment: ' || public._ipas_ask_purpose_label(p_purpose) || ' '
      || btrim(v_currency || ' ' || trim(to_char(p_amount, 'FM999G999G999G990.00')))
      || coalesce(' (' || trim(trailing '.' from trim(trailing '0' from to_char(p_percent, 'FM9990.0000'))) || '% of the order)', '')
      || ', ' || public._ipas_ask_priority_label(p_priority) || ' priority'
      || coalesce(' (' || v_note || ')', '') || '.',
    v_row.id
  );
  return v_row;
end;
$$;

revoke all on function public.ipas_ask_for_payment(uuid, numeric, text, text, text, numeric) from public, anon;
grant execute on function public.ipas_ask_for_payment(uuid, numeric, text, text, text, numeric) to authenticated;

-- Withdraw the ask: Purchasing, Finance or a Super Admin.
create or replace function public.ipas_withdraw_payment_ask(p_ipas_id uuid)
returns public.ipas_payment_asks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas_payment_asks;
begin
  if v_actor is null then
    raise exception 'ipas_withdraw_payment_ask: not signed in' using errcode = '42501';
  end if;
  if not (public.has_purchasing_access() or public.has_finance_access() or coalesce(public.is_super_admin(), false)) then
    raise exception 'ipas_withdraw_payment_ask: only Purchasing, Finance or a Super Admin withdraws an ask' using errcode = '42501';
  end if;

  update public.ipas_payment_asks
     set closed_at = now(), closed_by = v_actor, closed_reason = 'withdrawn'
   where ipas_id = p_ipas_id and closed_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'ipas_withdraw_payment_ask: there is no open ask to withdraw' using errcode = '22023';
  end if;

  perform public._ipas_payment_ask_to_chat(p_ipas_id, 'payment_ask_withdrawn', 'Withdrew the ask for payment.', v_row.id);
  return v_row;
end;
$$;

revoke all on function public.ipas_withdraw_payment_ask(uuid) from public, anon;
grant execute on function public.ipas_withdraw_payment_ask(uuid) to authenticated;
