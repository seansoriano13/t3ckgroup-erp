-- #958 (spec #954): an optional "% of order" on a Down payment or Payment row.
--
-- ipas_payments.percent_of_order is the percent the purchaser typed (30 = 30%). The amount is still the
-- typed amount; the percent only says how it was worked out, so the printed form can show
-- "Payment · 30%". It is null for no percent, and the app clears it when the amount is typed by hand.
-- Only Down payment and Payment rows may carry one (the same rule the screen follows). More than 100%
-- in total is a warning on screen, never a refusal here.
--
-- ipas_add_payment, ipas_update_payment and ipas_save_payment take it as a last, optional argument
-- (the old signatures are dropped so a call never has two matches), save it, and name it in history.
-- Same access, open-IPAS and filed-IPAS rules as every other payment edit.
--
-- SAFE TO RUN AT ANY TIME: one nullable column, one helper, three functions replaced (latest before:
-- 20261013100400 add, 20261023210000 update, 20261112090000 save).

alter table public.ipas_payments
  add column if not exists percent_of_order numeric(7, 4);

-- Two plain range checks (null passes both). The kind rule lives in _ipas_clean_percent: the table is
-- only written through the payment functions.
alter table public.ipas_payments drop constraint if exists ipas_payments_percent_chk;
alter table public.ipas_payments add constraint ipas_payments_percent_chk check (percent_of_order > 0);
alter table public.ipas_payments drop constraint if exists ipas_payments_percent_max_chk;
alter table public.ipas_payments add constraint ipas_payments_percent_max_chk check (percent_of_order <= 1000);

comment on column public.ipas_payments.percent_of_order is
  '#958: the percent of the order this payment was worked out as (30 = 30%), or null. Only on a Down payment or Payment. The amount stays the truth; this is what the printed form shows beside the kind.';

drop function if exists public.ipas_add_payment(uuid, text, date, numeric, numeric, numeric, uuid, text, text);
drop function if exists public.ipas_update_payment(uuid, text, date, numeric, numeric, numeric, uuid, text, text);
drop function if exists public.ipas_save_payment(uuid, uuid, text, date, numeric, numeric, numeric, numeric, numeric, uuid, text, text);

-- The percent as stored (4 decimals), or a refusal when it can't go with the kind.
create or replace function public._ipas_clean_percent(p_fn text, p_kind text, p_percent numeric)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v numeric := round(p_percent, 4);
begin
  if v is null then
    return null;
  end if;
  if v <= 0 or v > 1000 then
    raise exception '%: the percent of the order must be more than 0 and at most 1000', p_fn using errcode = '22023';
  end if;
  if p_kind not in ('down_payment', 'payment') then
    raise exception '%: only a Down payment or a Payment can be a percent of the order', p_fn using errcode = '22023';
  end if;
  return v;
end;
$$;

revoke all on function public._ipas_clean_percent(text, text, numeric) from public, anon, authenticated;

create or replace function public.ipas_add_payment(
  p_ipas_id uuid,
  p_kind text,
  p_paid_on date,
  p_amount numeric,
  p_php_debited numeric,
  p_charge_fee_php numeric,
  p_method_id uuid,
  p_check_no text,
  p_proof_url text,
  p_percent_of_order numeric default null
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
  v_percent numeric := public._ipas_clean_percent('ipas_add_payment', p_kind, p_percent_of_order);
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
    ipas_id, kind, paid_on, amount, php_debited, charge_fee_php, method_id, check_no, proof_url, percent_of_order, created_by
  ) values (
    v_ipas.id, p_kind, p_paid_on,
    (v_clean->>'amount')::numeric,
    (v_clean->>'php_debited')::numeric,
    (v_clean->>'charge_fee_php')::numeric,
    p_method_id, v_check, v_proof, v_percent, v_actor
  )
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'payment_added', jsonb_build_object(
    'payment_id', v_row.id,
    'kind', v_row.kind,
    'paid_on', v_row.paid_on,
    'amount', v_row.amount,
    'percent_of_order', v_row.percent_of_order,
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

comment on function public.ipas_add_payment(uuid, text, date, numeric, numeric, numeric, uuid, text, text, numeric) is
  '#244: Purchasing or Finance records a payment on an open IPAS. A foreign-currency PO needs php_debited (refused otherwise); a PHP PO stores none. The method must be an active payment method. #958: an optional percent of the order (Down payment or Payment only). Writes a "payment_added" event. Clears no approval.';

revoke all on function public.ipas_add_payment(uuid, text, date, numeric, numeric, numeric, uuid, text, text, numeric) from public, anon;
grant execute on function public.ipas_add_payment(uuid, text, date, numeric, numeric, numeric, uuid, text, text, numeric) to authenticated;

create or replace function public.ipas_update_payment(
  p_payment_id uuid,
  p_kind text,
  p_paid_on date,
  p_amount numeric,
  p_php_debited numeric,
  p_charge_fee_php numeric,
  p_method_id uuid,
  p_check_no text,
  p_proof_url text,
  p_percent_of_order numeric default null
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
  v_percent numeric := public._ipas_clean_percent('ipas_update_payment', p_kind, p_percent_of_order);
  v_changes jsonb := '{}'::jsonb;
begin
  select ipas_id into v_ipas_id from public.ipas_payments where id = p_payment_id;
  if v_ipas_id is null then
    raise exception 'ipas_update_payment: payment % not found', p_payment_id using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_update_payment', v_ipas_id);
  select * into v_before from public.ipas_payments where id = p_payment_id for update;
  if v_before.id is null then
    raise exception 'ipas_update_payment: payment % not found', p_payment_id using errcode = '22023';
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
  if v_before.percent_of_order is distinct from v_percent then
    v_changes := v_changes || jsonb_build_object('percent_of_order',
      jsonb_build_object('from', v_before.percent_of_order, 'to', v_percent));
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
         percent_of_order = v_percent,
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
    'percent_of_order', v_row.percent_of_order,
    'changes', v_changes
  ));

  return v_row;
end;
$$;

comment on function public.ipas_update_payment(uuid, text, date, numeric, numeric, numeric, uuid, text, text, numeric) is
  '#244: Purchasing or Finance edits a payment on an open IPAS (every editable field is passed, the percent included: null clears it). Same rules as ipas_add_payment; a deactivated method already on the row is kept. Writes a "payment_changed" event with what changed; nothing changed writes nothing.';

revoke all on function public.ipas_update_payment(uuid, text, date, numeric, numeric, numeric, uuid, text, text, numeric) from public, anon;
grant execute on function public.ipas_update_payment(uuid, text, date, numeric, numeric, numeric, uuid, text, text, numeric) to authenticated;

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
  p_percent_of_order numeric default null
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
begin
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

  -- One transaction: if any step refuses, nothing is kept.
  if p_payment_id is null then
    v_row := public.ipas_add_payment(v_ipas.id, p_kind, p_paid_on, p_amount, v_pesos, p_charge_fee_php,
                                     p_method_id, p_check_no, p_proof_url, p_percent_of_order);
  else
    v_row := public.ipas_update_payment(p_payment_id, p_kind, p_paid_on, p_amount, v_pesos, p_charge_fee_php,
                                        p_method_id, p_check_no, p_proof_url, p_percent_of_order);
  end if;
  return public.ipas_set_payment_money(v_row.id, v_rate, p_doc_stamp_php, p_misc_fee_php);
end;
$$;

revoke all on function public.ipas_save_payment(uuid, uuid, text, date, numeric, numeric, numeric, numeric, numeric, uuid, text, text, numeric) from public, anon;
grant execute on function public.ipas_save_payment(uuid, uuid, text, date, numeric, numeric, numeric, numeric, numeric, uuid, text, text, numeric) to authenticated;
