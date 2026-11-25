-- ==============================================================================
-- #1227 (spec #1220): Charge asks. Anything that needs paying can be asked, not
-- only the supplier: forwarders, duties and taxes, brokerage.
--
--   * An ask is now a Down payment, a Balance (supplier side) or a Charge.
--     A Charge ask names a charge kind (the charge-kind list) and the currency it
--     is billed in (default PHP). A Charge ask without a kind is refused.
--     Supplier asks store no kind and no currency (they use the PO's currency).
--   * Old Freight asks become Charge asks of the kind labelled Freight. That kind
--     is created if missing. It stays ACTIVE (Record as paid has to be able to use
--     it) but is left out of the blank charges a new Import IPAS is seeded with,
--     so no blank Freight charge appears on every Import IPAS.
--   * A charge saved with ask_id closes that Charge ask (reason paid). A payment
--     cannot pay a Charge ask; a charge cannot pay a supplier ask.
--   * The Chat lines and the Payers' bell name the charge kind and the currency.
--
-- SAFE TO RUN AGAIN: if not exists / create or replace; the data move only
-- touches asks that still say freight.
-- ==============================================================================

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.ipas_payment_asks
  add column if not exists charge_kind_id uuid references public.ipas_options(id),
  add column if not exists currency text;

create index if not exists ipas_payment_asks_charge_kind_id_idx on public.ipas_payment_asks (charge_kind_id);

comment on column public.ipas_payment_asks.charge_kind_id is
  'A Charge ask: which charge kind is asked for (#1227). Null for a Down payment or Balance ask.';
comment on column public.ipas_payment_asks.currency is
  'A Charge ask: the currency it is billed in, default PHP (#1227). Null for a Down payment or Balance ask, which use the PO currency.';

-- ---------------------------------------------------------------------------
-- The Freight kind, kept out of the blank charges seeded on a new Import IPAS
-- ---------------------------------------------------------------------------
insert into public.ipas_options (list, label, sort, active)
select 'charge_kind', 'Freight', 80, true
 where not exists (
   select 1 from public.ipas_options o
    where o.list = 'charge_kind' and lower(btrim(o.label)) = 'freight'
 );

CREATE OR REPLACE FUNCTION public._ipas_seed_blank_charges()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.source = 'import' then
    insert into public.ipas_charges (ipas_id, kind_id, charged_on, amount_php)
    select new.id, o.id, null, null
      from public.ipas_options o
     where o.list = 'charge_kind' and o.active
       and lower(btrim(o.label)) <> 'freight'
     order by o.sort, o.label;
  end if;
  return new;
end;
$function$
;

-- ---------------------------------------------------------------------------
-- Old Freight asks become Charge asks of the Freight kind
-- ---------------------------------------------------------------------------
alter table public.ipas_payment_asks drop constraint if exists ipas_payment_asks_purpose_chk;

create or replace function public._ipas_migrate_freight_asks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind uuid;
  v_moved integer;
begin
  select id into v_kind from public.ipas_options
   where list = 'charge_kind' and lower(btrim(label)) = 'freight';
  update public.ipas_payment_asks a
     set purpose = 'charge',
         charge_kind_id = v_kind,
         currency = coalesce(nullif(upper(btrim(i.odoo_copy -> 'po' ->> 'currency')), ''), 'PHP')
    from public.ipas i
   where i.id = a.ipas_id and a.purpose = 'freight';
  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

revoke all on function public._ipas_migrate_freight_asks() from public, anon, authenticated;

select public._ipas_migrate_freight_asks();

alter table public.ipas_payment_asks
  add constraint ipas_payment_asks_purpose_chk check (purpose in ('down_payment', 'balance', 'charge'));
alter table public.ipas_payment_asks drop constraint if exists ipas_payment_asks_charge_chk;
alter table public.ipas_payment_asks
  add constraint ipas_payment_asks_charge_chk check (
    (purpose = 'charge' and charge_kind_id is not null and currency is not null)
    or (purpose <> 'charge' and charge_kind_id is null and currency is null)
  );

-- ---------------------------------------------------------------------------
-- Labels and the Chat metadata: a Charge ask is named by its kind
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ipas_ask_purpose_label(p_purpose text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_purpose when 'down_payment' then 'Down payment' when 'balance' then 'Balance' when 'charge' then 'Charge' when 'freight' then 'Freight' else p_purpose end;
$function$
;

CREATE OR REPLACE FUNCTION public._ipas_ask_meta(p_ask ipas_payment_asks)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
           'ask_id', p_ask.id,
           'purpose', p_ask.purpose,
           'purpose_label', coalesce(
             (select o.label from public.ipas_options o where o.id = p_ask.charge_kind_id),
             public._ipas_ask_purpose_label(p_ask.purpose)),
           'amount', p_ask.amount,
           'currency', coalesce(nullif(p_ask.currency, ''), nullif(i.odoo_copy -> 'po' ->> 'currency', ''), ''),
           'kind', (select o.label from public.ipas_options o where o.id = p_ask.charge_kind_id),
           'priority', public._ipas_ask_priority_label(p_ask.priority),
           'percent_of_order', p_ask.percent_of_order,
           'note', p_ask.note)
    from public.ipas i
   where i.id = p_ask.ipas_id;
$function$
;

-- ---------------------------------------------------------------------------
-- The Payers' bell names the charge kind and the currency
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ipas_payers_notify_ask()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ipas public.ipas;
  v_asker text;
  v_what text;
  v_currency text;
begin
  select * into v_ipas from public.ipas where id = new.ipas_id;
  select name into v_asker from public.employees where id = new.asked_by;
  select o.label into v_what from public.ipas_options o where o.id = new.charge_kind_id;
  v_currency := coalesce(nullif(new.currency, ''), nullif(v_ipas.odoo_copy->'po'->>'currency', ''));

  insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
  select l.employee_id, new.asked_by, 'IPAS_PAYMENT_ASKED',
         coalesce(v_asker, 'Someone') || ' asked for a payment',
         left(concat_ws(' — ', v_ipas.number, nullif(v_ipas.odoo_copy->'supplier'->>'name', ''))
              || ': ' || concat_ws(' ', v_what, v_currency, to_char(new.amount, 'FM999G999G999G990.00')), 280),
         v_ipas.id::text
    from public.ipas_signer_lists l
    join public.employees e on e.id = l.employee_id
   where l.list_key = 'payers'
     and not coalesce(e.is_deleted, false)
     and l.employee_id is distinct from new.asked_by;
  return null;
end;
$function$
;

-- ---------------------------------------------------------------------------
-- Ask for payment: a Charge ask names a kind and a currency
-- ---------------------------------------------------------------------------
drop function if exists public.ipas_ask_for_payment(uuid, numeric, text, text, text, numeric);

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
-- A payment cannot pay a Charge ask (the trigger said so only in general terms)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ipas_payment_closes_ask()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_meta jsonb;
  v_ask public.ipas_payment_asks;
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
  if v_ask.purpose not in ('down_payment', 'balance') then
    raise exception 'a payment cannot pay a Charge ask; record a charge instead' using errcode = '22023';
  end if;

  update public.ipas_payment_asks
     set closed_at = now(), closed_by = public.get_employee_id(), closed_reason = 'paid',
         paid_by_payment_id = new.id
   where id = v_ask.id;

  v_meta := public._ipas_ask_meta(v_ask);
  perform public._ipas_payment_ask_to_chat(
    new.ipas_id, 'payment_ask_closed',
    'Paid the ask for payment: ' || (v_meta ->> 'purpose_label') || ' '
      || btrim((v_meta ->> 'currency') || ' ' || trim(to_char(v_ask.amount, 'FM999G999G999G990.00')))
      || ' (payment of ' || btrim((v_meta ->> 'currency') || ' ' || trim(to_char(new.amount, 'FM999G999G999G990.00'))) || ' recorded).',
    v_ask.id,
    v_meta || jsonb_build_object('reason', 'paid', 'payment_id', new.id, 'paid_amount', new.amount)
  );
  return null;
end;
$function$
;

-- ---------------------------------------------------------------------------
-- A charge that names a Charge ask closes it; it cannot pay a supplier ask
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ipas_charge_closes_ask()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_meta jsonb;
  v_ask public.ipas_payment_asks;
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
  if v_ask.purpose <> 'charge' then
    raise exception 'a charge cannot pay a Down payment or Balance ask; record a payment instead' using errcode = '22023';
  end if;

  update public.ipas_payment_asks
     set closed_at = now(), closed_by = public.get_employee_id(), closed_reason = 'paid',
         paid_by_charge_id = new.id
   where id = v_ask.id;

  v_meta := public._ipas_ask_meta(v_ask);
  perform public._ipas_payment_ask_to_chat(
    new.ipas_id, 'payment_ask_closed',
    'Paid the ask for payment: ' || (v_meta ->> 'purpose_label') || ' '
      || btrim((v_meta ->> 'currency') || ' ' || trim(to_char(v_ask.amount, 'FM999G999G999G990.00')))
      || ' (charge' || coalesce(' of PHP ' || trim(to_char(new.amount_php, 'FM999G999G999G990.00')), '') || ' recorded).',
    v_ask.id,
    v_meta || jsonb_build_object('reason', 'paid', 'charge_id', new.id, 'paid_amount', new.amount_php)
  );
  return null;
end;
$function$
;

revoke all on function public._ipas_charge_closes_ask() from public, anon, authenticated;

drop trigger if exists ipas_charge_closes_ask on public.ipas_charges;
create trigger ipas_charge_closes_ask
after insert or update of ask_id on public.ipas_charges
for each row
execute function public._ipas_charge_closes_ask();

-- ---------------------------------------------------------------------------
-- Add charge, optionally as paying one open Charge ask
-- ---------------------------------------------------------------------------
drop function if exists public.ipas_add_charge(uuid, uuid, date, numeric);

CREATE OR REPLACE FUNCTION public.ipas_add_charge(p_ipas_id uuid, p_kind_id uuid, p_charged_on date, p_amount_php numeric, p_ask_id uuid DEFAULT NULL::uuid)
 RETURNS ipas_charges
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public._ipas_money_writer('ipas_add_charge');
  v_ipas public.ipas;
  v_amount numeric := round(p_amount_php, 2);
  v_label text;
  v_row public.ipas_charges;
begin
  perform public._ipas_check_date('ipas_add_charge', p_charged_on, 'the charge date');
  v_ipas := public._ipas_lock_open('ipas_add_charge', p_ipas_id);
  if p_charged_on is null then
    raise exception 'ipas_add_charge: give the date of the charge' using errcode = '22023';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'ipas_add_charge: the amount must be more than zero' using errcode = '22023';
  end if;
  v_label := public._ipas_check_option('ipas_add_charge', p_kind_id, 'charge_kind', null, 'charge kind');

  -- The ask link is set on the insert; the trigger checks it is an open Charge ask on this IPAS and closes it.
  insert into public.ipas_charges (ipas_id, kind_id, charged_on, amount_php, created_by, ask_id)
  values (v_ipas.id, p_kind_id, p_charged_on, v_amount, v_actor, p_ask_id)
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'charge_added', jsonb_build_object(
    'charge_id', v_row.id,
    'kind_id', v_row.kind_id,
    'kind', v_label,
    'charged_on', v_row.charged_on,
    'amount_php', v_row.amount_php
  ));

  perform public._ipas_money_charge_chat('charge_added', v_ipas.id, v_row.id, null, public._ipas_money_charge_snap(v_row.id));

  return v_row;
end;
$function$
;

revoke all on function public.ipas_add_charge(uuid, uuid, date, numeric, uuid) from public, anon;
grant execute on function public.ipas_add_charge(uuid, uuid, date, numeric, uuid) to authenticated;
