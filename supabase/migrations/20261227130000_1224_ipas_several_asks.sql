-- ==============================================================================
-- #1224 (spec #1220): several asks for payment open at once, each closed only by
-- the payment that pays it (ADR 0055, amendment of 2026-11-25)
--
-- Before: one ask open per IPAS, and any payment recorded closed it.
-- Now:
--   * Any number of asks may be open on one IPAS (the one-open index is dropped).
--   * A payment is saved as paying one open ask (ipas_payments.ask_id). That closes
--     the ask, reason paid, even when the amount is less than asked. A payment with
--     no link closes nothing. The link must name an open, supplier-side ask
--     (Down payment or Balance) on the same IPAS.
--   * The ask remembers which payment paid it (paid_by_payment_id). Removing that
--     payment leaves the ask closed (ON DELETE SET NULL; closed_* is untouched).
--   * ipas_charges.ask_id and ipas_payment_asks.paid_by_charge_id are added now so
--     Charge asks (#1227) can use them; nothing writes them yet.
--   * An open ask is edited (ipas_edit_payment_ask) and withdrawn
--     (ipas_withdraw_payment_ask) by its own id.
--
-- The close-ask trigger is replaced in this same migration: its old body closed
-- "the" open ask and would fail with several open.
--
-- SAFE TO RUN AGAIN: create or replace / if not exists; no data is changed.
-- ==============================================================================

drop index if exists public.ipas_payment_asks_one_open_idx;

-- ---------------------------------------------------------------------------
-- The links
-- ---------------------------------------------------------------------------
alter table public.ipas_payments
  add column if not exists ask_id uuid references public.ipas_payment_asks(id) on delete set null;
alter table public.ipas_charges
  add column if not exists ask_id uuid references public.ipas_payment_asks(id) on delete set null;
alter table public.ipas_payment_asks
  add column if not exists paid_by_payment_id uuid references public.ipas_payments(id) on delete set null;
alter table public.ipas_payment_asks
  add column if not exists paid_by_charge_id uuid references public.ipas_charges(id) on delete set null;

create index if not exists ipas_payments_ask_id_idx on public.ipas_payments (ask_id);
create index if not exists ipas_charges_ask_id_idx on public.ipas_charges (ask_id);
create index if not exists ipas_payment_asks_paid_by_payment_id_idx on public.ipas_payment_asks (paid_by_payment_id);
create index if not exists ipas_payment_asks_paid_by_charge_id_idx on public.ipas_payment_asks (paid_by_charge_id);
create index if not exists ipas_payment_asks_open_idx on public.ipas_payment_asks (ipas_id) where closed_at is null;

comment on column public.ipas_payments.ask_id is
  'The open ask this payment paid (#1224). Set when the payment is saved; the ask closes with reason paid.';
comment on column public.ipas_payment_asks.paid_by_payment_id is
  'The payment that paid this ask (#1224). Cleared if that payment is removed; the ask stays closed.';

-- ---------------------------------------------------------------------------
-- A payment that names an ask closes that ask only
-- ---------------------------------------------------------------------------
create or replace function public._ipas_payment_closes_ask()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
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
    raise exception 'a payment can only pay a Down payment or Balance ask' using errcode = '22023';
  end if;

  update public.ipas_payment_asks
     set closed_at = now(), closed_by = public.get_employee_id(), closed_reason = 'paid',
         paid_by_payment_id = new.id
   where id = v_ask.id;

  perform public._ipas_payment_ask_to_chat(new.ipas_id, 'payment_ask_closed', 'Payment recorded; the ask for payment is closed.', v_ask.id);
  return null;
end;
$$;

revoke all on function public._ipas_payment_closes_ask() from public, anon, authenticated;

drop trigger if exists ipas_payment_closes_ask on public.ipas_payments;
create trigger ipas_payment_closes_ask
after insert or update of ask_id on public.ipas_payments
for each row
execute function public._ipas_payment_closes_ask();

-- ---------------------------------------------------------------------------
-- Ask for payment: no one-open check any more
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Edit one open ask: amount, priority, note (and the % label)
-- ---------------------------------------------------------------------------
create or replace function public.ipas_edit_payment_ask(
  p_ask_id uuid,
  p_amount numeric,
  p_priority text,
  p_note text default null,
  p_percent numeric default null
) returns public.ipas_payment_asks
language plpgsql
security definer
set search_path = public
as $$
declare
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

  if v_ask.amount = p_amount and v_ask.priority = p_priority
     and v_ask.note is not distinct from v_note and v_ask.percent_of_order is not distinct from p_percent then
    return v_ask;
  end if;

  update public.ipas_payment_asks
     set amount = p_amount, priority = p_priority, note = v_note, percent_of_order = p_percent
   where id = v_ask.id
  returning * into v_row;

  v_currency := coalesce(nullif(v_ipas.odoo_copy->'po'->>'currency', ''), '');
  insert into public.ipas_messages (ipas_id, author_id, content, metadata)
  values (
    v_ipas.id, v_actor,
    'Changed the ask for payment: ' || public._ipas_ask_purpose_label(v_row.purpose) || ' '
      || btrim(v_currency || ' ' || trim(to_char(v_row.amount, 'FM999G999G999G990.00')))
      || ', ' || public._ipas_ask_priority_label(v_row.priority) || ' priority'
      || coalesce(' (' || v_row.note || ')', '') || '.',
    jsonb_build_object(
      'event', 'payment_ask_edited', 'ask_id', v_row.id,
      'changes', jsonb_strip_nulls(jsonb_build_object(
        'amount', case when v_ask.amount is distinct from v_row.amount
                       then jsonb_build_object('from', v_ask.amount, 'to', v_row.amount) end,
        'priority', case when v_ask.priority is distinct from v_row.priority
                         then jsonb_build_object('from', v_ask.priority, 'to', v_row.priority) end,
        'note', case when v_ask.note is distinct from v_row.note
                     then jsonb_build_object('from', v_ask.note, 'to', v_row.note) end
      ))
    )
  );
  return v_row;
end;
$$;

revoke all on function public.ipas_edit_payment_ask(uuid, numeric, text, text, numeric) from public, anon;
grant execute on function public.ipas_edit_payment_ask(uuid, numeric, text, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Withdraw one open ask, by its own id (it used to take the IPAS id)
-- ---------------------------------------------------------------------------
-- The live function names its parameter p_ipas_id; Postgres will not rename a
-- parameter with create or replace, so drop it first (the grant below is repeated).
drop function if exists public.ipas_withdraw_payment_ask(uuid);

create or replace function public.ipas_withdraw_payment_ask(p_ask_id uuid)
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

  select * into v_row from public.ipas_payment_asks where id = p_ask_id;
  if v_row.id is null then
    raise exception 'ipas_withdraw_payment_ask: that ask is not open' using errcode = '22023';
  end if;
  perform public._ipas_lock_open('ipas_withdraw_payment_ask', v_row.ipas_id);

  update public.ipas_payment_asks
     set closed_at = now(), closed_by = v_actor, closed_reason = 'withdrawn'
   where id = p_ask_id and closed_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'ipas_withdraw_payment_ask: that ask is not open' using errcode = '22023';
  end if;

  perform public._ipas_payment_ask_to_chat(v_row.ipas_id, 'payment_ask_withdrawn', 'Withdrew the ask for payment.', v_row.id);
  return v_row;
end;
$$;

revoke all on function public.ipas_withdraw_payment_ask(uuid) from public, anon;
grant execute on function public.ipas_withdraw_payment_ask(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Save a payment, optionally as paying one open ask
-- ---------------------------------------------------------------------------
drop function if exists public.ipas_save_payment(uuid, uuid, text, date, numeric, numeric, numeric, numeric, numeric, uuid, text, text, numeric, text, text[]);

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
  p_proof_url text,
  p_percent_of_order numeric default null,
  p_method_other text default null,
  p_proof_urls text[] default null,
  p_ask_id uuid default null
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
  v_label text;
  v_other text := nullif(btrim(p_method_other), '');
  v_urls text[];
  v_url text;
begin
  perform public._ipas_check_date('ipas_save_payment', p_paid_on, 'the payment date');
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

  -- The method: Others needs what it was; any other method keeps no typed text.
  select lower(btrim(label)) into v_label from public.ipas_options where id = p_method_id;
  if v_label in ('others', 'other') then
    if v_other is null then
      raise exception 'ipas_save_payment: type the payment method when it is Others' using errcode = '22023';
    end if;
    if char_length(v_other) > 100 then
      raise exception 'ipas_save_payment: the payment method can be at most 100 characters' using errcode = '22023';
    end if;
  else
    v_other := null;
  end if;

  -- The proof files: the whole list, or the one p_proof_url when no list is sent. No duplicates, no blanks.
  select coalesce(array_agg(s.u order by s.first_at), '{}'::text[])
    into v_urls
    from (
      select btrim(x.u) as u, min(x.n) as first_at
        from unnest(coalesce(p_proof_urls, case when nullif(btrim(p_proof_url), '') is null then '{}'::text[] else array[p_proof_url] end))
             with ordinality as x(u, n)
       where nullif(btrim(x.u), '') is not null
       group by btrim(x.u)
    ) s;

  -- One transaction: if any step refuses, nothing is kept.
  if p_payment_id is null then
    v_row := public.ipas_add_payment(v_ipas.id, p_kind, p_paid_on, p_amount, v_pesos, p_charge_fee_php,
                                     p_method_id, p_check_no, v_urls[1], p_percent_of_order);
  else
    v_row := public.ipas_update_payment(p_payment_id, p_kind, p_paid_on, p_amount, v_pesos, p_charge_fee_php,
                                        p_method_id, p_check_no, v_urls[1], p_percent_of_order);
  end if;

  -- Files that left the list go; new ones come in.
  delete from public.ipas_payment_files where payment_id = v_row.id and not (url = any (v_urls));
  foreach v_url in array v_urls loop
    if v_url !~* '^https?://' then
      raise exception 'ipas_save_payment: the proof must be a link to the uploaded file' using errcode = '22023';
    end if;
    if not exists (select 1 from public.ipas_payment_files where payment_id = v_row.id and url = v_url) then
      insert into public.ipas_payment_files (payment_id, url, file_name, created_by)
      values (v_row.id, v_url, public._ipas_file_name_from_url(v_url), public.get_employee_id());
    end if;
  end loop;

  update public.ipas_payments set method_other = v_other where id = v_row.id and method_other is distinct from v_other;

  -- Paying an open ask: the trigger checks it is open, on this IPAS and supplier side, then closes it.
  if p_ask_id is not null then
    update public.ipas_payments set ask_id = p_ask_id where id = v_row.id and ask_id is distinct from p_ask_id;
  end if;

  return public.ipas_set_payment_money(v_row.id, v_rate, p_doc_stamp_php, p_misc_fee_php);
end;
$$;

revoke all on function public.ipas_save_payment(uuid, uuid, text, date, numeric, numeric, numeric, numeric, numeric, uuid, text, text, numeric, text, text[], uuid) from public, anon;
grant execute on function public.ipas_save_payment(uuid, uuid, text, date, numeric, numeric, numeric, numeric, numeric, uuid, text, text, numeric, text, text[], uuid) to authenticated;
