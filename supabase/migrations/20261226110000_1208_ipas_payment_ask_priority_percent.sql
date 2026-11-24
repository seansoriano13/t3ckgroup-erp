-- ==============================================================================
-- 20261226110000_1208_ipas_payment_ask_priority_percent.sql
--
-- Ask for payment: priority and percent (spec #1205, ticket #1208, ADR 0055).
--
--   ipas_payment_asks.priority          very_high / high / medium, required, High by default.
--   ipas_payment_asks.percent_of_order  optional percent of the order (P.I/QT Amount, else the
--                                       P0 total). It only labels the ask; the amount stays the
--                                       true figure.
--
-- ipas_ask_for_payment gains p_priority (default 'high') and p_percent (default null). Only
-- Purchasing access may ask, so only Purchasing sets either. The Chat line names both.
--
-- SAFE TO RUN AT ANY TIME: two columns (existing asks become High, no percent) and one function.
-- ==============================================================================

alter table public.ipas_payment_asks
  add column if not exists priority text not null default 'high',
  add column if not exists percent_of_order numeric;

alter table public.ipas_payment_asks drop constraint if exists ipas_payment_asks_priority_chk;
alter table public.ipas_payment_asks
  add constraint ipas_payment_asks_priority_chk check (priority in ('very_high', 'high', 'medium'));

alter table public.ipas_payment_asks drop constraint if exists ipas_payment_asks_percent_chk;
alter table public.ipas_payment_asks
  add constraint ipas_payment_asks_percent_chk check (percent_of_order is null or (percent_of_order > 0 and percent_of_order <= 1000));

comment on column public.ipas_payment_asks.priority is
  'ADR 0055: how soon the General Manager should pay (very_high, high, medium). The Payment Forecast sorts by it.';
comment on column public.ipas_payment_asks.percent_of_order is
  'ADR 0055: optional percent of the order the amount was filled from. A label only; the amount is the true figure.';

create or replace function public._ipas_ask_priority_label(p_priority text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_priority when 'very_high' then 'Very High' when 'high' then 'High' when 'medium' then 'Medium' else p_priority end;
$$;

revoke all on function public._ipas_ask_priority_label(text) from public, anon, authenticated;

drop function if exists public.ipas_ask_for_payment(uuid, numeric, text, text);

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
  if not public.has_purchasing_access() then
    raise exception 'ipas_ask_for_payment: only Purchasing asks for a payment' using errcode = '42501';
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
    raise exception 'ipas_ask_for_payment: the % of order must be more than zero' using errcode = '22023';
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
