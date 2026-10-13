-- ==============================================================================
-- 20261013100400_ipas_payments_charges.sql
--
-- Issue #244 (IPAS, spec #241) — payments, charges and Landed Cost.
--
-- WHAT THIS ADDS
--   ipas_options        the option lists the business edits (payment methods,
--                       charge kinds, freight services; document kinds and item
--                       locations join in their own ticket). Options are
--                       deactivated, never deleted, and an IPAS row keeps its
--                       option when that option is later deactivated.
--   ipas_payments       any number of payments per IPAS: kind, date, amount in
--                       the PO's currency, PHP debited (required on a
--                       foreign-currency PO), charge fee in PHP, method, Check
--                       No., optional proof of payment.
--   ipas_charges        any number of charges per IPAS: kind, date, PHP amount.
--   ipas columns        pi_qt_amount (typed), freight_service_id (one per IPAS),
--                       landed_cost_split (value | quantity | equal),
--                       computation_status (encoding -> encoded -> costs_complete
--                       -> checked, set by Purchasing).
--
-- THE RPCs
--   ipas_add_payment / ipas_update_payment / ipas_remove_payment
--   ipas_add_charge  / ipas_update_charge  / ipas_remove_charge
--                       Purchasing access OR Finance access, on an open IPAS
--                       only. Every add, change and removal writes an
--                       ipas_events row in the same transaction (a removal keeps
--                       a snapshot of what was removed). None of them clears an
--                       approval: payments and charges are only history.
--   ipas_set_header     (re-declared, same signature) now also types
--                       pi_qt_amount, picks freight_service_id, and sets
--                       landed_cost_split and computation_status. Purchasing
--                       access only, as before.
--
-- Option lists are plain CRUD under row level security (no history needed):
-- Purchasing access or a Super Admin may insert and update, nobody may delete.
--
-- DP and FP header amounts are derived from the payment rows by the client and
-- never stored; no balance is computed anywhere (withholding would leave the
-- sample's P75 "unpaid" forever).
--
-- PAID BEFORE APPROVAL. `ipas_payments.paid_before_approval` exists here and is
-- left false: section 1's sign-offs don't exist yet, and the insert trigger
-- that sets it belongs to the sign-off ticket (#247), which owns its meaning.
--
-- LANDED COST is computed by the client from the stored Odoo copy, the payment
-- and charge rows and these columns (src/utils/landedCost.js); the database
-- stores no landed cost figure.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: new tables,
-- new nullable or defaulted columns, new functions, one `create or replace`
-- that only widens ipas_set_header. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Option lists
-- ------------------------------------------------------------------------------

create table if not exists public.ipas_options (
  id         uuid primary key default gen_random_uuid(),
  list       text not null,
  label      text not null,
  sort       integer not null default 0,
  active     boolean not null default true,
  applies_to text,
  used_for   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ipas_options_list_chk check (list in (
    'payment_method', 'charge_kind', 'document_kind', 'freight_service', 'item_location'
  )),
  constraint ipas_options_label_chk check (length(btrim(label)) > 0),
  constraint ipas_options_applies_to_chk check (applies_to is null or applies_to in ('import', 'local', 'both')),
  constraint ipas_options_used_for_chk check (used_for is null or used_for in ('documentation', 'filing', 'both')),
  constraint ipas_options_document_columns_chk check (
    list = 'document_kind' or (applies_to is null and used_for is null)
  )
);

comment on table public.ipas_options is
  'IPAS option lists the business edits (#241, #244): payment methods, charge kinds, freight services, and later document kinds and item locations. Deactivated, never deleted: an IPAS row keeps the option it used. Edited by Purchasing access and Super Admins.';
comment on column public.ipas_options.sort is
  'Display order within the list, ascending.';
comment on column public.ipas_options.active is
  'false = no longer offered for new rows; rows that already use it keep it.';
comment on column public.ipas_options.applies_to is
  'Document kinds only: the Source it is suggested for (import, local or both).';
comment on column public.ipas_options.used_for is
  'Document kinds only: documentation, filing or both.';

create unique index if not exists ipas_options_list_label_key
  on public.ipas_options (list, lower(btrim(label)));
create index if not exists ipas_options_list_sort_idx on public.ipas_options (list, sort);

drop trigger if exists ipas_options_updated_at on public.ipas_options;
create trigger ipas_options_updated_at
  before update on public.ipas_options
  for each row execute function public.set_ipas_updated_at();

-- An option never moves between lists: rows already point at it as, say, a
-- payment method.
create or replace function public.ipas_options_guard()
returns trigger
language plpgsql
as $$
begin
  if new.list is distinct from old.list then
    raise exception 'ipas_options: an option can''t move to another list' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists ipas_options_guard on public.ipas_options;
create trigger ipas_options_guard
  before update on public.ipas_options
  for each row execute function public.ipas_options_guard();

alter table public.ipas_options enable row level security;

drop policy if exists ipas_options_read on public.ipas_options;
create policy ipas_options_read on public.ipas_options
  for select to authenticated
  using (public.ipas_can_read());

drop policy if exists ipas_options_insert on public.ipas_options;
create policy ipas_options_insert on public.ipas_options
  for insert to authenticated
  with check (public.has_purchasing_access() or coalesce(public.is_super_admin(), false));

drop policy if exists ipas_options_update on public.ipas_options;
create policy ipas_options_update on public.ipas_options
  for update to authenticated
  using (public.has_purchasing_access() or coalesce(public.is_super_admin(), false))
  with check (public.has_purchasing_access() or coalesce(public.is_super_admin(), false));

-- Options are never deleted, by anyone through the API.
revoke delete, truncate on public.ipas_options from anon, authenticated;

-- The business's real lists, from the paper IPAS sheet, in sheet order. Still
-- editable in Purchasing settings. Insert-if-missing, so a re-run (or a list the
-- business already edited) is left alone.
insert into public.ipas_options (list, label, sort)
select v.list, v.label, v.sort
  from (values
    ('payment_method', 'Alipay', 10),
    ('payment_method', 'Bank Deposit', 20),
    ('payment_method', 'Bank TT', 30),
    ('payment_method', 'Cash', 40),
    ('payment_method', 'Credit Card', 50),
    ('payment_method', 'Dated Check', 60),
    ('payment_method', 'Petnet', 70),
    ('payment_method', 'Western Union', 80),
    ('payment_method', 'Alibaba', 90),
    ('payment_method', 'Paypal', 100),
    ('payment_method', 'Other', 110),
    ('charge_kind', 'Brokerage Fee', 10),
    ('charge_kind', 'Delivery Fee', 20),
    ('charge_kind', 'Destination Charges', 30),
    ('charge_kind', 'Duties & Taxes', 40),
    ('charge_kind', 'Origin Charges', 50),
    ('charge_kind', 'Processing Fee', 60),
    ('charge_kind', 'Truck Rental', 70),
    ('freight_service', 'Ahead', 10),
    ('freight_service', 'AVV', 20),
    ('freight_service', 'DHL', 30),
    ('freight_service', 'FedEx', 40),
    ('freight_service', 'UPS', 50),
    ('freight_service', 'Wide Range', 60),
    ('freight_service', 'DSV', 70),
    ('freight_service', 'TD Express Air', 80),
    ('freight_service', 'TD Express Sea', 90),
    ('freight_service', 'Other', 100)
  ) as v(list, label, sort)
 where not exists (
   select 1 from public.ipas_options o
    where o.list = v.list and lower(btrim(o.label)) = lower(v.label)
 );

-- ------------------------------------------------------------------------------
-- IPAS header columns
-- ------------------------------------------------------------------------------

alter table public.ipas
  add column if not exists pi_qt_amount numeric(14, 2),
  add column if not exists freight_service_id uuid references public.ipas_options (id),
  add column if not exists landed_cost_split text not null default 'value',
  add column if not exists computation_status text not null default 'encoding';

comment on column public.ipas.pi_qt_amount is
  '#244: P.I/QT Amount, typed from the supplier''s document, in the PO''s currency. Never computed; no balance is derived from it.';
comment on column public.ipas.freight_service_id is
  '#244: the IPAS''s one freight service (an ipas_options row, list freight_service).';
comment on column public.ipas.landed_cost_split is
  '#244: how charges, charge fees and shipping fees are spread over the item lines: value (default), quantity or equal.';
comment on column public.ipas.computation_status is
  '#244: where the costing stands, set by Purchasing: encoding, encoded, costs_complete or checked. Landed Cost reads provisional until costs_complete, then final.';

create index if not exists ipas_freight_service_id_idx on public.ipas (freight_service_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ipas_landed_cost_split_chk' and conrelid = 'public.ipas'::regclass) then
    alter table public.ipas add constraint ipas_landed_cost_split_chk
      check (landed_cost_split in ('value', 'quantity', 'equal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipas_computation_status_chk' and conrelid = 'public.ipas'::regclass) then
    alter table public.ipas add constraint ipas_computation_status_chk
      check (computation_status in ('encoding', 'encoded', 'costs_complete', 'checked'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipas_pi_qt_amount_chk' and conrelid = 'public.ipas'::regclass) then
    alter table public.ipas add constraint ipas_pi_qt_amount_chk
      check (pi_qt_amount is null or pi_qt_amount >= 0);
  end if;
end;
$$;

-- ------------------------------------------------------------------------------
-- Payments and charges
-- ------------------------------------------------------------------------------

create table if not exists public.ipas_payments (
  id                   uuid primary key default gen_random_uuid(),
  ipas_id              uuid not null references public.ipas (id) on delete cascade,
  kind                 text not null,
  paid_on              date not null,
  amount               numeric(14, 2) not null,
  php_debited          numeric(14, 2),
  charge_fee_php       numeric(14, 2) not null default 0,
  method_id            uuid not null references public.ipas_options (id),
  check_no             text,
  proof_url            text,
  paid_before_approval boolean not null default false,
  created_by           uuid references public.employees (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint ipas_payments_kind_chk check (kind in ('down_payment', 'payment', 'full_payment', 'shipping_fee')),
  constraint ipas_payments_amount_chk check (amount > 0),
  constraint ipas_payments_php_debited_chk check (php_debited is null or php_debited > 0),
  constraint ipas_payments_charge_fee_chk check (charge_fee_php >= 0),
  constraint ipas_payments_check_no_chk check (check_no is null or length(btrim(check_no)) > 0),
  constraint ipas_payments_proof_url_chk check (proof_url is null or proof_url ~* '^https?://')
);

comment on table public.ipas_payments is
  'IPAS payments (#241, #244): a list, not fixed slots. amount is in the PO''s currency; php_debited is the PHP actually debited and is required on a foreign-currency PO (null on a PHP PO, whose PHP is the amount); charge_fee_php is always PHP. DP and FP header amounts are derived from these rows.';
comment on column public.ipas_payments.paid_before_approval is
  'Set by the database when a payment is recorded while section 1 has no live Approved sign-off. The trigger arrives with the sign-off ticket (#247); until then it stays false.';
comment on column public.ipas_payments.proof_url is
  'Optional proof of payment (a link to the uploaded file). With P.O.P is stamped while any payment carries one.';

create index if not exists ipas_payments_ipas_id_idx on public.ipas_payments (ipas_id, paid_on);
create index if not exists ipas_payments_method_id_idx on public.ipas_payments (method_id);
create index if not exists ipas_payments_created_by_idx on public.ipas_payments (created_by);

drop trigger if exists ipas_payments_updated_at on public.ipas_payments;
create trigger ipas_payments_updated_at
  before update on public.ipas_payments
  for each row execute function public.set_ipas_updated_at();

create table if not exists public.ipas_charges (
  id         uuid primary key default gen_random_uuid(),
  ipas_id    uuid not null references public.ipas (id) on delete cascade,
  kind_id    uuid not null references public.ipas_options (id),
  charged_on date not null,
  amount_php numeric(14, 2) not null,
  created_by uuid references public.employees (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ipas_charges_amount_chk check (amount_php > 0)
);

comment on table public.ipas_charges is
  'IPAS charges (#241, #244): importation charges as a list, each a kind (an ipas_options row), a date and a PHP amount. A charge covering several POs is recorded as this IPAS''s own share.';

create index if not exists ipas_charges_ipas_id_idx on public.ipas_charges (ipas_id, charged_on);
create index if not exists ipas_charges_kind_id_idx on public.ipas_charges (kind_id);
create index if not exists ipas_charges_created_by_idx on public.ipas_charges (created_by);

drop trigger if exists ipas_charges_updated_at on public.ipas_charges;
create trigger ipas_charges_updated_at
  before update on public.ipas_charges
  for each row execute function public.set_ipas_updated_at();

alter table public.ipas_payments enable row level security;
alter table public.ipas_charges enable row level security;

drop policy if exists ipas_payments_read on public.ipas_payments;
create policy ipas_payments_read on public.ipas_payments
  for select to authenticated
  using (public.ipas_can_read());

drop policy if exists ipas_charges_read on public.ipas_charges;
create policy ipas_charges_read on public.ipas_charges
  for select to authenticated
  using (public.ipas_can_read());

-- ------------------------------------------------------------------------------
-- Internals
-- ------------------------------------------------------------------------------

-- Whether a copy's currency is the peso. Anything else (or no currency) is
-- foreign: it needs PHP debited and a rate before Landed Cost is available.
create or replace function public._ipas_is_php(p_copy jsonb)
returns boolean
language sql
immutable
as $$
  select upper(btrim(coalesce(p_copy->'po'->>'currency', ''))) = 'PHP';
$$;

-- The caller, if they may write payments and charges (Purchasing or Finance).
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
  if not (public.has_purchasing_access() or public.has_finance_access()) then
    raise exception '%: only Purchasing or Finance records payments and charges', p_fn using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

-- An open IPAS, locked for the rest of the transaction.
create or replace function public._ipas_lock_open(p_fn text, p_ipas_id uuid)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ipas;
begin
  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception '%: IPAS % not found', p_fn, p_ipas_id using errcode = 'P0002';
  end if;
  if v_row.state = 'filed' then
    raise exception '%: % is filed; a Super Admin reopens it first', p_fn, v_row.number using errcode = '55000';
  end if;
  if v_row.state = 'cancelled' then
    raise exception '%: % is cancelled', p_fn, v_row.number using errcode = '55000';
  end if;
  return v_row;
end;
$$;

-- An option of the given list. A deactivated one is refused unless it is the
-- value the row already holds (p_current), so history keeps its option.
-- Returns the label.
create or replace function public._ipas_check_option(
  p_fn text,
  p_option_id uuid,
  p_list text,
  p_current uuid,
  p_what text
) returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_option public.ipas_options;
begin
  select * into v_option from public.ipas_options where id = p_option_id;
  if v_option.id is null or v_option.list <> p_list then
    raise exception '%: pick a %', p_fn, p_what using errcode = '22023';
  end if;
  if not v_option.active and p_option_id is distinct from p_current then
    raise exception '%: % is deactivated; pick another %', p_fn, v_option.label, p_what using errcode = '22023';
  end if;
  return v_option.label;
end;
$$;

-- Checks a payment's values against the IPAS it belongs to and returns what is
-- stored: { php_debited, charge_fee_php, amount, method_label }.
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
    if v_php is null or v_php <= 0 then
      raise exception '%: % is a foreign-currency PO; give the PHP actually debited', p_fn, p_ipas.number
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

revoke all on function public._ipas_is_php(jsonb) from public, anon, authenticated;
revoke all on function public._ipas_money_writer(text) from public, anon, authenticated;
revoke all on function public._ipas_lock_open(text, uuid) from public, anon, authenticated;
revoke all on function public._ipas_check_option(text, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public._ipas_clean_payment(text, public.ipas, text, date, numeric, numeric, numeric, uuid, uuid)
  from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Payments
-- ------------------------------------------------------------------------------

create or replace function public.ipas_add_payment(
  p_ipas_id uuid,
  p_kind text,
  p_paid_on date,
  p_amount numeric,
  p_php_debited numeric,
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
  v_actor uuid := public._ipas_money_writer('ipas_add_payment');
  v_ipas public.ipas;
  v_clean jsonb;
  v_check text := nullif(btrim(p_check_no), '');
  v_proof text := nullif(btrim(p_proof_url), '');
  v_row public.ipas_payments;
begin
  v_ipas := public._ipas_lock_open('ipas_add_payment', p_ipas_id);
  v_clean := public._ipas_clean_payment(
    'ipas_add_payment', v_ipas, p_kind, p_paid_on, p_amount, p_php_debited, p_charge_fee_php, p_method_id, null
  );
  if v_proof is not null and v_proof !~* '^https?://' then
    raise exception 'ipas_add_payment: the proof of payment must be a link to the uploaded file' using errcode = '22023';
  end if;

  insert into public.ipas_payments (
    ipas_id, kind, paid_on, amount, php_debited, charge_fee_php, method_id, check_no, proof_url, created_by
  ) values (
    v_ipas.id, p_kind, p_paid_on,
    (v_clean->>'amount')::numeric,
    (v_clean->>'php_debited')::numeric,
    (v_clean->>'charge_fee_php')::numeric,
    p_method_id, v_check, v_proof, v_actor
  )
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'payment_added', jsonb_build_object(
    'payment_id', v_row.id,
    'kind', v_row.kind,
    'paid_on', v_row.paid_on,
    'amount', v_row.amount,
    'php_debited', v_row.php_debited,
    'charge_fee_php', v_row.charge_fee_php,
    'method_id', v_row.method_id,
    'method', v_clean->>'method_label',
    'check_no', v_row.check_no,
    'has_proof', v_row.proof_url is not null,
    'currency', v_ipas.odoo_copy->'po'->>'currency'
  ));

  return v_row;
end;
$$;

comment on function public.ipas_add_payment(uuid, text, date, numeric, numeric, numeric, uuid, text, text) is
  '#244: Purchasing or Finance records a payment on an open IPAS. A foreign-currency PO needs php_debited (refused otherwise); a PHP PO stores none. The method must be an active payment method. Writes a "payment_added" event. Clears no approval.';

revoke all on function public.ipas_add_payment(uuid, text, date, numeric, numeric, numeric, uuid, text, text) from public, anon;
grant execute on function public.ipas_add_payment(uuid, text, date, numeric, numeric, numeric, uuid, text, text) to authenticated;

create or replace function public.ipas_update_payment(
  p_payment_id uuid,
  p_kind text,
  p_paid_on date,
  p_amount numeric,
  p_php_debited numeric,
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
  v_actor uuid := public._ipas_money_writer('ipas_update_payment');
  v_ipas_id uuid;
  v_ipas public.ipas;
  v_before public.ipas_payments;
  v_row public.ipas_payments;
  v_clean jsonb;
  v_check text := nullif(btrim(p_check_no), '');
  v_proof text := nullif(btrim(p_proof_url), '');
  v_changes jsonb := '{}'::jsonb;
begin
  select ipas_id into v_ipas_id from public.ipas_payments where id = p_payment_id;
  if v_ipas_id is null then
    raise exception 'ipas_update_payment: payment % not found', p_payment_id using errcode = 'P0002';
  end if;

  v_ipas := public._ipas_lock_open('ipas_update_payment', v_ipas_id);
  select * into v_before from public.ipas_payments where id = p_payment_id for update;
  if v_before.id is null then
    raise exception 'ipas_update_payment: payment % not found', p_payment_id using errcode = 'P0002';
  end if;

  v_clean := public._ipas_clean_payment(
    'ipas_update_payment', v_ipas, p_kind, p_paid_on, p_amount, p_php_debited, p_charge_fee_php, p_method_id,
    v_before.method_id
  );
  if v_proof is not null and v_proof !~* '^https?://' then
    raise exception 'ipas_update_payment: the proof of payment must be a link to the uploaded file' using errcode = '22023';
  end if;

  if v_before.kind is distinct from p_kind then
    v_changes := v_changes || jsonb_build_object('kind', jsonb_build_object('from', v_before.kind, 'to', p_kind));
  end if;
  if v_before.paid_on is distinct from p_paid_on then
    v_changes := v_changes || jsonb_build_object('paid_on', jsonb_build_object('from', v_before.paid_on, 'to', p_paid_on));
  end if;
  if v_before.amount is distinct from (v_clean->>'amount')::numeric then
    v_changes := v_changes || jsonb_build_object('amount',
      jsonb_build_object('from', v_before.amount, 'to', (v_clean->>'amount')::numeric));
  end if;
  if v_before.php_debited is distinct from (v_clean->>'php_debited')::numeric then
    v_changes := v_changes || jsonb_build_object('php_debited',
      jsonb_build_object('from', v_before.php_debited, 'to', (v_clean->>'php_debited')::numeric));
  end if;
  if v_before.charge_fee_php is distinct from (v_clean->>'charge_fee_php')::numeric then
    v_changes := v_changes || jsonb_build_object('charge_fee_php',
      jsonb_build_object('from', v_before.charge_fee_php, 'to', (v_clean->>'charge_fee_php')::numeric));
  end if;
  if v_before.method_id is distinct from p_method_id then
    v_changes := v_changes || jsonb_build_object('method', jsonb_build_object(
      'from', (select o.label from public.ipas_options o where o.id = v_before.method_id),
      'to', v_clean->>'method_label'));
  end if;
  if v_before.check_no is distinct from v_check then
    v_changes := v_changes || jsonb_build_object('check_no', jsonb_build_object('from', v_before.check_no, 'to', v_check));
  end if;
  if v_before.proof_url is distinct from v_proof then
    v_changes := v_changes || jsonb_build_object('proof', jsonb_build_object(
      'from', v_before.proof_url is not null, 'to', v_proof is not null));
  end if;

  if v_changes = '{}'::jsonb then
    return v_before;
  end if;

  update public.ipas_payments
     set kind = p_kind,
         paid_on = p_paid_on,
         amount = (v_clean->>'amount')::numeric,
         php_debited = (v_clean->>'php_debited')::numeric,
         charge_fee_php = (v_clean->>'charge_fee_php')::numeric,
         method_id = p_method_id,
         check_no = v_check,
         proof_url = v_proof
   where id = v_before.id
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'payment_changed', jsonb_build_object(
    'payment_id', v_row.id,
    'kind', v_row.kind,
    'changes', v_changes
  ));

  return v_row;
end;
$$;

comment on function public.ipas_update_payment(uuid, text, date, numeric, numeric, numeric, uuid, text, text) is
  '#244: Purchasing or Finance edits a payment on an open IPAS (every editable field is passed). Same rules as ipas_add_payment; a deactivated method already on the row is kept. Writes a "payment_changed" event with what changed; nothing changed writes nothing.';

revoke all on function public.ipas_update_payment(uuid, text, date, numeric, numeric, numeric, uuid, text, text) from public, anon;
grant execute on function public.ipas_update_payment(uuid, text, date, numeric, numeric, numeric, uuid, text, text) to authenticated;

create or replace function public.ipas_remove_payment(p_payment_id uuid)
returns public.ipas_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_money_writer('ipas_remove_payment');
  v_ipas_id uuid;
  v_ipas public.ipas;
  v_row public.ipas_payments;
begin
  select ipas_id into v_ipas_id from public.ipas_payments where id = p_payment_id;
  if v_ipas_id is null then
    raise exception 'ipas_remove_payment: payment % not found', p_payment_id using errcode = 'P0002';
  end if;

  v_ipas := public._ipas_lock_open('ipas_remove_payment', v_ipas_id);
  delete from public.ipas_payments where id = p_payment_id returning * into v_row;
  if v_row.id is null then
    raise exception 'ipas_remove_payment: payment % not found', p_payment_id using errcode = 'P0002';
  end if;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'payment_removed', jsonb_build_object(
    'payment_id', v_row.id,
    'kind', v_row.kind,
    'paid_on', v_row.paid_on,
    'amount', v_row.amount,
    'php_debited', v_row.php_debited,
    'charge_fee_php', v_row.charge_fee_php,
    'method', (select o.label from public.ipas_options o where o.id = v_row.method_id),
    'check_no', v_row.check_no,
    'had_proof', v_row.proof_url is not null,
    'currency', v_ipas.odoo_copy->'po'->>'currency'
  ));

  return v_row;
end;
$$;

comment on function public.ipas_remove_payment(uuid) is
  '#244: Purchasing or Finance removes a payment from an open IPAS. The history keeps a snapshot of what was removed ("payment_removed").';

revoke all on function public.ipas_remove_payment(uuid) from public, anon;
grant execute on function public.ipas_remove_payment(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- Charges
-- ------------------------------------------------------------------------------

create or replace function public.ipas_add_charge(
  p_ipas_id uuid,
  p_kind_id uuid,
  p_charged_on date,
  p_amount_php numeric
) returns public.ipas_charges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_money_writer('ipas_add_charge');
  v_ipas public.ipas;
  v_amount numeric := round(p_amount_php, 2);
  v_label text;
  v_row public.ipas_charges;
begin
  v_ipas := public._ipas_lock_open('ipas_add_charge', p_ipas_id);
  if p_charged_on is null then
    raise exception 'ipas_add_charge: give the date of the charge' using errcode = '22023';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'ipas_add_charge: the amount must be more than zero' using errcode = '22023';
  end if;
  v_label := public._ipas_check_option('ipas_add_charge', p_kind_id, 'charge_kind', null, 'charge kind');

  insert into public.ipas_charges (ipas_id, kind_id, charged_on, amount_php, created_by)
  values (v_ipas.id, p_kind_id, p_charged_on, v_amount, v_actor)
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'charge_added', jsonb_build_object(
    'charge_id', v_row.id,
    'kind_id', v_row.kind_id,
    'kind', v_label,
    'charged_on', v_row.charged_on,
    'amount_php', v_row.amount_php
  ));

  return v_row;
end;
$$;

comment on function public.ipas_add_charge(uuid, uuid, date, numeric) is
  '#244: Purchasing or Finance records a charge (kind, date, PHP amount) on an open IPAS. The kind must be an active charge kind. Writes a "charge_added" event. Clears no approval.';

revoke all on function public.ipas_add_charge(uuid, uuid, date, numeric) from public, anon;
grant execute on function public.ipas_add_charge(uuid, uuid, date, numeric) to authenticated;

create or replace function public.ipas_update_charge(
  p_charge_id uuid,
  p_kind_id uuid,
  p_charged_on date,
  p_amount_php numeric
) returns public.ipas_charges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_money_writer('ipas_update_charge');
  v_ipas_id uuid;
  v_ipas public.ipas;
  v_before public.ipas_charges;
  v_row public.ipas_charges;
  v_amount numeric := round(p_amount_php, 2);
  v_label text;
  v_changes jsonb := '{}'::jsonb;
begin
  select ipas_id into v_ipas_id from public.ipas_charges where id = p_charge_id;
  if v_ipas_id is null then
    raise exception 'ipas_update_charge: charge % not found', p_charge_id using errcode = 'P0002';
  end if;

  v_ipas := public._ipas_lock_open('ipas_update_charge', v_ipas_id);
  select * into v_before from public.ipas_charges where id = p_charge_id for update;
  if v_before.id is null then
    raise exception 'ipas_update_charge: charge % not found', p_charge_id using errcode = 'P0002';
  end if;

  if p_charged_on is null then
    raise exception 'ipas_update_charge: give the date of the charge' using errcode = '22023';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'ipas_update_charge: the amount must be more than zero' using errcode = '22023';
  end if;
  v_label := public._ipas_check_option('ipas_update_charge', p_kind_id, 'charge_kind', v_before.kind_id, 'charge kind');

  if v_before.kind_id is distinct from p_kind_id then
    v_changes := v_changes || jsonb_build_object('kind', jsonb_build_object(
      'from', (select o.label from public.ipas_options o where o.id = v_before.kind_id),
      'to', v_label));
  end if;
  if v_before.charged_on is distinct from p_charged_on then
    v_changes := v_changes || jsonb_build_object('charged_on',
      jsonb_build_object('from', v_before.charged_on, 'to', p_charged_on));
  end if;
  if v_before.amount_php is distinct from v_amount then
    v_changes := v_changes || jsonb_build_object('amount_php',
      jsonb_build_object('from', v_before.amount_php, 'to', v_amount));
  end if;
  if v_changes = '{}'::jsonb then
    return v_before;
  end if;

  update public.ipas_charges
     set kind_id = p_kind_id, charged_on = p_charged_on, amount_php = v_amount
   where id = v_before.id
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'charge_changed', jsonb_build_object(
    'charge_id', v_row.id,
    'kind', v_label,
    'changes', v_changes
  ));

  return v_row;
end;
$$;

comment on function public.ipas_update_charge(uuid, uuid, date, numeric) is
  '#244: Purchasing or Finance edits a charge on an open IPAS. Writes a "charge_changed" event with what changed; nothing changed writes nothing.';

revoke all on function public.ipas_update_charge(uuid, uuid, date, numeric) from public, anon;
grant execute on function public.ipas_update_charge(uuid, uuid, date, numeric) to authenticated;

create or replace function public.ipas_remove_charge(p_charge_id uuid)
returns public.ipas_charges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_money_writer('ipas_remove_charge');
  v_ipas_id uuid;
  v_ipas public.ipas;
  v_row public.ipas_charges;
begin
  select ipas_id into v_ipas_id from public.ipas_charges where id = p_charge_id;
  if v_ipas_id is null then
    raise exception 'ipas_remove_charge: charge % not found', p_charge_id using errcode = 'P0002';
  end if;

  v_ipas := public._ipas_lock_open('ipas_remove_charge', v_ipas_id);
  delete from public.ipas_charges where id = p_charge_id returning * into v_row;
  if v_row.id is null then
    raise exception 'ipas_remove_charge: charge % not found', p_charge_id using errcode = 'P0002';
  end if;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'charge_removed', jsonb_build_object(
    'charge_id', v_row.id,
    'kind', (select o.label from public.ipas_options o where o.id = v_row.kind_id),
    'charged_on', v_row.charged_on,
    'amount_php', v_row.amount_php
  ));

  return v_row;
end;
$$;

comment on function public.ipas_remove_charge(uuid) is
  '#244: Purchasing or Finance removes a charge from an open IPAS. The history keeps a snapshot of what was removed ("charge_removed").';

revoke all on function public.ipas_remove_charge(uuid) from public, anon;
grant execute on function public.ipas_remove_charge(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- Typed header values (widened)
--
-- Same signature and same Purchasing-only rule as #243's. It now also takes
--   pi_qt_amount        a number >= 0, or null / "" to clear
--   freight_service_id  an active freight service, or null to clear (the one
--                       already on the IPAS stays valid after it is deactivated)
--   landed_cost_split   value | quantity | equal
--   computation_status  encoding | encoded | costs_complete | checked
-- Keys present are set; keys absent are left alone. Every change is one
-- "header_changed" event with { field: { from, to } }.
-- ------------------------------------------------------------------------------

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
  v_label text;
  v_changes jsonb := '{}'::jsonb;
begin
  if v_actor is null then
    raise exception 'ipas_set_header: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_set_header: only Purchasing changes an IPAS' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'ipas_set_header: the fields must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in (
      'supplier_contact', 'pi_number', 'pi_qt_amount', 'freight_service_id', 'landed_cost_split', 'computation_status'
    ) then
      raise exception 'ipas_set_header: % isn''t a header field you can type here', v_key using errcode = '22023';
    end if;
  end loop;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_set_header: IPAS % not found', p_ipas_id using errcode = 'P0002';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_set_header: % is filed; a Super Admin reopens it first', v_row.number using errcode = '55000';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_set_header: % is cancelled', v_row.number using errcode = '55000';
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
    if v_status is null or v_status not in ('encoding', 'encoded', 'costs_complete', 'checked') then
      raise exception 'ipas_set_header: the computation status is Encoding, Encoded, Costs complete or Checked'
        using errcode = '22023';
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
  if v_changes = '{}'::jsonb then
    return v_row;
  end if;

  update public.ipas
     set supplier_contact = v_contact,
         pi_number = v_pi,
         pi_qt_amount = v_amount,
         freight_service_id = v_freight,
         landed_cost_split = v_split,
         computation_status = v_status
   where id = v_row.id
  returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'header_changed', jsonb_build_object('fields', v_changes));

  return v_row;
end;
$$;

comment on function public.ipas_set_header(uuid, jsonb) is
  '#243/#244: Purchasing types the supplier contact, P.I # and P.I/QT Amount, picks the freight service, and sets the Landed Cost spread (value, quantity, equal) and the computation status on an open IPAS. Keys present are set, blank clears where allowed. Writes one "header_changed" event with what changed.';

revoke all on function public.ipas_set_header(uuid, jsonb) from public, anon;
grant execute on function public.ipas_set_header(uuid, jsonb) to authenticated;
