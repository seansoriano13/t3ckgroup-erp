-- ==============================================================================
-- 20261224120000_1188_ipas_payment_ask.sql
--
-- Payment status on every IPAS (spec #1187, ticket #1188, ADR 0055).
--
-- The Payment status itself is worked out in the app from the payments and an
-- open ask (utils/ipasFigures.js). The one thing a person sets is the ASK FOR
-- PAYMENT, stored here:
--
--   ipas_payment_asks   amount in the P0's currency, purpose (down_payment /
--                       balance / freight), optional note, who asked and when,
--                       and how it closed (withdrawn or paid, by whom, when).
--                       An IPAS has one OPEN ask at a time (partial unique index).
--
--   ipas_ask_for_payment(ipas, amount, purpose, note)   Purchasing access only.
--   ipas_withdraw_payment_ask(ipas)                     Purchasing access only.
--   a trigger on ipas_payments closes the open ask when any payment is recorded.
--
-- CHAT
--   Ask, withdraw and close each post an event line in the IPAS Chat
--   (metadata.event = payment_ask_opened / payment_ask_withdrawn /
--   payment_ask_closed). Event lines notify nobody (_ipas_message_notify).
--
-- SAFE TO RUN AT ANY TIME: new table, functions and trigger; nothing is backfilled.
-- ==============================================================================

create table if not exists public.ipas_payment_asks (
  id uuid primary key default gen_random_uuid(),
  ipas_id uuid not null references public.ipas (id) on delete cascade,
  amount numeric not null,
  purpose text not null,
  note text,
  asked_by uuid references public.employees (id),
  asked_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.employees (id),
  closed_reason text,
  constraint ipas_payment_asks_amount_chk check (amount > 0),
  constraint ipas_payment_asks_purpose_chk check (purpose in ('down_payment', 'balance', 'freight')),
  constraint ipas_payment_asks_closed_reason_chk check (closed_reason is null or closed_reason in ('withdrawn', 'paid')),
  constraint ipas_payment_asks_closed_chk check ((closed_at is null) = (closed_reason is null))
);

comment on table public.ipas_payment_asks is
  'ADR 0055: Purchasing''s ask for a payment on an IPAS (amount in the P0''s currency, purpose, note). One open ask per IPAS; it closes when withdrawn or when any payment is recorded. An open ask makes the Payment status For payment.';

create unique index if not exists ipas_payment_asks_one_open_idx
  on public.ipas_payment_asks (ipas_id) where closed_at is null;
create index if not exists ipas_payment_asks_asked_by_idx on public.ipas_payment_asks (asked_by);
create index if not exists ipas_payment_asks_closed_by_idx on public.ipas_payment_asks (closed_by);

alter table public.ipas_payment_asks enable row level security;

drop policy if exists ipas_payment_asks_read on public.ipas_payment_asks;
create policy ipas_payment_asks_read on public.ipas_payment_asks
  for select to authenticated
  using (public.ipas_can_read());

-- No insert, update or delete policy: the functions below are the only writers.

-- ------------------------------------------------------------------------------
-- One chat line, written by the database
-- ------------------------------------------------------------------------------

create or replace function public._ipas_payment_ask_to_chat(p_ipas_id uuid, p_event text, p_text text, p_ask_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ipas_messages (ipas_id, author_id, content, metadata)
  values (p_ipas_id, public.get_employee_id(), p_text, jsonb_build_object('event', p_event, 'ask_id', p_ask_id));
$$;

revoke all on function public._ipas_payment_ask_to_chat(uuid, text, text, uuid) from public, anon, authenticated;

create or replace function public._ipas_ask_purpose_label(p_purpose text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_purpose when 'down_payment' then 'Down payment' when 'balance' then 'Balance' when 'freight' then 'Freight' else p_purpose end;
$$;

revoke all on function public._ipas_ask_purpose_label(text) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Ask for payment
-- ------------------------------------------------------------------------------

create or replace function public.ipas_ask_for_payment(
  p_ipas_id uuid,
  p_amount numeric,
  p_purpose text,
  p_note text default null
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
  if exists (select 1 from public.ipas_payment_asks where ipas_id = v_ipas.id and closed_at is null) then
    raise exception 'ipas_ask_for_payment: % already has an open ask; withdraw it first', v_ipas.number using errcode = '55000';
  end if;

  insert into public.ipas_payment_asks (ipas_id, amount, purpose, note, asked_by)
  values (v_ipas.id, p_amount, p_purpose, v_note, v_actor)
  returning * into v_row;

  v_currency := coalesce(nullif(v_ipas.odoo_copy->'po'->>'currency', ''), '');
  perform public._ipas_payment_ask_to_chat(
    v_ipas.id, 'payment_ask_opened',
    'Asked for payment: ' || public._ipas_ask_purpose_label(p_purpose) || ' '
      || btrim(v_currency || ' ' || trim(to_char(p_amount, 'FM999G999G999G990.00')))
      || coalesce(' (' || v_note || ')', '') || '.',
    v_row.id
  );
  return v_row;
end;
$$;

revoke all on function public.ipas_ask_for_payment(uuid, numeric, text, text) from public, anon;
grant execute on function public.ipas_ask_for_payment(uuid, numeric, text, text) to authenticated;

-- ------------------------------------------------------------------------------
-- Withdraw
-- ------------------------------------------------------------------------------

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
  if not public.has_purchasing_access() then
    raise exception 'ipas_withdraw_payment_ask: only Purchasing withdraws an ask' using errcode = '42501';
  end if;

  update public.ipas_payment_asks
     set closed_at = now(), closed_by = v_actor, closed_reason = 'withdrawn'
   where ipas_id = p_ipas_id and closed_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'ipas_withdraw_payment_ask: there is no open ask to withdraw' using errcode = 'P0002';
  end if;

  perform public._ipas_payment_ask_to_chat(p_ipas_id, 'payment_ask_withdrawn', 'Withdrew the ask for payment.', v_row.id);
  return v_row;
end;
$$;

revoke all on function public.ipas_withdraw_payment_ask(uuid) from public, anon;
grant execute on function public.ipas_withdraw_payment_ask(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- Recording any payment closes the open ask
-- ------------------------------------------------------------------------------

create or replace function public._ipas_payment_closes_ask()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ask public.ipas_payment_asks;
begin
  update public.ipas_payment_asks
     set closed_at = now(), closed_by = public.get_employee_id(), closed_reason = 'paid'
   where ipas_id = new.ipas_id and closed_at is null
  returning * into v_ask;

  if v_ask.id is not null then
    perform public._ipas_payment_ask_to_chat(new.ipas_id, 'payment_ask_closed', 'Payment recorded; the ask for payment is closed.', v_ask.id);
  end if;
  return null;
end;
$$;

revoke all on function public._ipas_payment_closes_ask() from public, anon, authenticated;

drop trigger if exists ipas_payment_closes_ask on public.ipas_payments;
create trigger ipas_payment_closes_ask
after insert on public.ipas_payments
for each row
execute function public._ipas_payment_closes_ask();
