-- ==============================================================================
-- #1226 (spec #1220): every ask, payment and charge change leaves one line in the
-- IPAS Chat, with its amounts
--
-- The Chat lines are written by the database as event lines (metadata.event set),
-- so they notify nobody (_ipas_message_notify skips them).
--
--   asks      payment_ask_opened / payment_ask_edited / payment_ask_withdrawn /
--             payment_ask_closed (reason 'paid')
--   payments  payment_added / payment_changed / payment_removed
--   charges   charge_added / charge_changed / charge_removed
--
-- Metadata always names the event and carries the amounts. An ask line carries
-- ask_id, purpose, purpose_label, amount, currency, kind (a charge ask's kind,
-- null for a supplier ask), priority, percent_of_order and note. A payment line
-- carries payment_id, kind, currency, amount, paid_on, method; a charge line
-- carries charge_id, kind, currency (PHP), amount, charged_on. An edit adds
-- changes: { field: { from, to } } with only the fields that changed.
--
-- One action, one line. A payment edit from the app is several writes inside
-- ipas_save_payment, so the line is written once at the end of that function
-- (the pieces it calls see the transaction-local setting ipas.money_chat_quiet and
-- stay silent). Called on their own, each piece posts its own line. A row trigger
-- is not used for that reason. A blank charge row being filled counts as the
-- charge being added.
--
-- #1227 (Charge asks) only has to fill the currency / charge_kind_id columns: the
-- ask lines read them when present.
--
-- SAFE TO RUN AGAIN: create or replace; no data is changed.
-- ==============================================================================

create or replace function public._ipas_diff(p_before jsonb, p_after jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $function$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('from', p_before -> k, 'to', p_after -> k)), '{}'::jsonb)
    from jsonb_object_keys(coalesce(p_before, '{}'::jsonb) || coalesce(p_after, '{}'::jsonb)) as k
   where (p_before -> k) is distinct from (p_after -> k);
$function$;

revoke all on function public._ipas_diff(p_before jsonb, p_after jsonb) from public, anon, authenticated;

create or replace function public._ipas_changes_text(p_changes jsonb)
returns text
language sql
immutable
set search_path = public
as $function$
  select string_agg(
           case c.key
             when 'kind' then 'Kind'
             when 'paid_on' then 'Paid on'
             when 'charged_on' then 'Date'
             when 'amount' then 'Amount'
             when 'percent_of_order' then '% of order'
             when 'forex_rate' then 'Forex rate'
             when 'php_debited' then 'Pesos debited'
             when 'charge_fee_php' then 'Bank charge'
             when 'doc_stamp_php' then 'Doc stamp'
             when 'misc_fee_php' then 'Misc fee'
             when 'method' then 'Method'
             when 'method_other' then 'Method (other)'
             when 'check_no' then 'Check no.'
             when 'proof_files' then 'Proof files'
             when 'attachment' then 'Attachment'
             when 'priority' then 'Priority'
             when 'note' then 'Note'
             else initcap(replace(c.key, '_', ' '))
           end
           || ' ' || case
             when c.value -> 'from' is null or jsonb_typeof(c.value -> 'from') = 'null' then 'none'
             when jsonb_typeof(c.value -> 'from') = 'number' and c.key in ('amount', 'php_debited', 'charge_fee_php', 'doc_stamp_php', 'misc_fee_php')
               then trim(to_char((c.value ->> 'from')::numeric, 'FM999G999G999G990.00'))
             when jsonb_typeof(c.value -> 'from') = 'number' and c.key = 'percent_of_order'
               then trim(trailing '.' from trim(trailing '0' from to_char((c.value ->> 'from')::numeric, 'FM9990.0000'))) || '%'
             else c.value ->> 'from'
           end || ' → ' || case
             when c.value -> 'to' is null or jsonb_typeof(c.value -> 'to') = 'null' then 'none'
             when jsonb_typeof(c.value -> 'to') = 'number' and c.key in ('amount', 'php_debited', 'charge_fee_php', 'doc_stamp_php', 'misc_fee_php')
               then trim(to_char((c.value ->> 'to')::numeric, 'FM999G999G999G990.00'))
             when jsonb_typeof(c.value -> 'to') = 'number' and c.key = 'percent_of_order'
               then trim(trailing '.' from trim(trailing '0' from to_char((c.value ->> 'to')::numeric, 'FM9990.0000'))) || '%'
             else c.value ->> 'to'
           end,
           '; ' order by c.key)
    from jsonb_each(coalesce(p_changes, '{}'::jsonb)) as c(key, value);
$function$;

revoke all on function public._ipas_changes_text(p_changes jsonb) from public, anon, authenticated;

create or replace function public._ipas_ask_meta(p_ask ipas_payment_asks)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
           'ask_id', p_ask.id,
           'purpose', p_ask.purpose,
           'purpose_label', public._ipas_ask_purpose_label(p_ask.purpose),
           'amount', p_ask.amount,
           'currency', coalesce(nullif(to_jsonb(p_ask) ->> 'currency', ''), nullif(i.odoo_copy -> 'po' ->> 'currency', ''), ''),
           'kind', (select o.label from public.ipas_options o where o.id = nullif(to_jsonb(p_ask) ->> 'charge_kind_id', '')::uuid),
           'priority', public._ipas_ask_priority_label(p_ask.priority),
           'percent_of_order', p_ask.percent_of_order,
           'note', p_ask.note)
    from public.ipas i
   where i.id = p_ask.ipas_id;
$function$;

revoke all on function public._ipas_ask_meta(p_ask ipas_payment_asks) from public, anon, authenticated;

create or replace function public._ipas_money_payment_snap(p_payment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
           'kind', case p.kind when 'down_payment' then 'Down payment' when 'payment' then 'Payment'
                               when 'full_payment' then 'Full payment' when 'shipping_fee' then 'Shipping fee' else p.kind end,
           'paid_on', p.paid_on,
           'amount', p.amount,
           'percent_of_order', p.percent_of_order,
           'forex_rate', p.forex_rate,
           'php_debited', p.php_debited,
           'charge_fee_php', p.charge_fee_php,
           'doc_stamp_php', p.doc_stamp_php,
           'misc_fee_php', p.misc_fee_php,
           'method', (select o.label from public.ipas_options o where o.id = p.method_id),
           'method_other', p.method_other,
           'check_no', p.check_no,
           'proof_files', greatest(
             (select count(*) from public.ipas_payment_files f where f.payment_id = p.id),
             case when p.proof_url is not null then 1 else 0 end))
    from public.ipas_payments p
   where p.id = p_payment_id;
$function$;

revoke all on function public._ipas_money_payment_snap(p_payment_id uuid) from public, anon, authenticated;

create or replace function public._ipas_money_charge_snap(p_charge_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
           'kind', (select o.label from public.ipas_options o where o.id = c.kind_id),
           'charged_on', c.charged_on,
           'amount', c.amount_php,
           'attachment', case when c.attachment_url is null then null else 'attached' end)
    from public.ipas_charges c
   where c.id = p_charge_id;
$function$;

revoke all on function public._ipas_money_charge_snap(p_charge_id uuid) from public, anon, authenticated;

create or replace function public._ipas_money_payment_chat(p_event text, p_ipas_id uuid, p_payment_id uuid, p_before jsonb, p_after jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_snap jsonb := coalesce(p_after, p_before);
  v_currency text;
  v_money text;
  v_changes jsonb;
  v_text text;
  v_meta jsonb;
begin
  -- ipas_save_payment posts its own single line; the pieces it calls stay quiet.
  if coalesce(current_setting('ipas.money_chat_quiet', true), '') = 'on' then
    return;
  end if;

  select coalesce(nullif(i.odoo_copy -> 'po' ->> 'currency', ''), '') into v_currency
    from public.ipas i where i.id = p_ipas_id;
  v_money := btrim(coalesce(v_currency, '') || ' ' || trim(to_char((v_snap ->> 'amount')::numeric, 'FM999G999G999G990.00')));

  v_meta := jsonb_build_object(
    'event', p_event, 'payment_id', p_payment_id,
    'kind', v_snap -> 'kind', 'currency', v_currency, 'amount', v_snap -> 'amount',
    'paid_on', v_snap -> 'paid_on', 'method', v_snap -> 'method');

  if p_event = 'payment_added' then
    v_text := 'Recorded a payment: ' || (v_snap ->> 'kind') || ' ' || v_money
      || coalesce(' on ' || (v_snap ->> 'paid_on'), '')
      || coalesce(' via ' || (v_snap ->> 'method'), '') || '.';
  elsif p_event = 'payment_removed' then
    v_text := 'Removed a payment: ' || (v_snap ->> 'kind') || ' ' || v_money
      || coalesce(' dated ' || (v_snap ->> 'paid_on'), '') || '.';
  else
    v_changes := public._ipas_diff(p_before, p_after);
    if v_changes = '{}'::jsonb then
      return;
    end if;
    v_text := 'Changed the payment (' || (v_snap ->> 'kind') || ' ' || v_money || '): '
      || public._ipas_changes_text(v_changes) || '.';
    v_meta := v_meta || jsonb_build_object('changes', v_changes);
  end if;

  insert into public.ipas_messages (ipas_id, author_id, content, metadata, created_at)
  values (p_ipas_id, public.get_employee_id(), v_text, v_meta, clock_timestamp());
end;
$function$;

revoke all on function public._ipas_money_payment_chat(p_event text, p_ipas_id uuid, p_payment_id uuid, p_before jsonb, p_after jsonb) from public, anon, authenticated;

create or replace function public._ipas_money_charge_chat(p_event text, p_ipas_id uuid, p_charge_id uuid, p_before jsonb, p_after jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_snap jsonb := coalesce(p_after, p_before);
  v_money text;
  v_changes jsonb;
  v_text text;
  v_meta jsonb;
begin
  if coalesce(current_setting('ipas.money_chat_quiet', true), '') = 'on' then
    return;
  end if;

  v_money := case when v_snap ->> 'amount' is null then 'no amount yet'
                  else 'PHP ' || trim(to_char((v_snap ->> 'amount')::numeric, 'FM999G999G999G990.00')) end;

  v_meta := jsonb_build_object(
    'event', p_event, 'charge_id', p_charge_id,
    'kind', v_snap -> 'kind', 'currency', 'PHP', 'amount', v_snap -> 'amount',
    'charged_on', v_snap -> 'charged_on');

  if p_event = 'charge_added' then
    v_text := 'Added a charge: ' || coalesce(v_snap ->> 'kind', 'Charge') || ' ' || v_money
      || coalesce(' on ' || (v_snap ->> 'charged_on'), '') || '.';
  elsif p_event = 'charge_removed' then
    v_text := 'Removed a charge: ' || coalesce(v_snap ->> 'kind', 'Charge') || ' ' || v_money
      || coalesce(' dated ' || (v_snap ->> 'charged_on'), '') || '.';
  else
    v_changes := public._ipas_diff(p_before, p_after);
    if v_changes = '{}'::jsonb then
      return;
    end if;
    v_text := 'Changed the charge (' || coalesce(v_snap ->> 'kind', 'Charge') || ' ' || v_money || '): '
      || public._ipas_changes_text(v_changes) || '.';
    v_meta := v_meta || jsonb_build_object('changes', v_changes);
  end if;

  insert into public.ipas_messages (ipas_id, author_id, content, metadata, created_at)
  values (p_ipas_id, public.get_employee_id(), v_text, v_meta, clock_timestamp());
end;
$function$;

revoke all on function public._ipas_money_charge_chat(p_event text, p_ipas_id uuid, p_charge_id uuid, p_before jsonb, p_after jsonb) from public, anon, authenticated;

drop function if exists public._ipas_payment_ask_to_chat(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.ipas_add_payment(p_ipas_id uuid, p_kind text, p_paid_on date, p_amount numeric, p_php_debited numeric, p_charge_fee_php numeric, p_method_id uuid, p_check_no text, p_proof_url text, p_percent_of_order numeric DEFAULT NULL::numeric)
 RETURNS ipas_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  perform public._ipas_money_payment_chat('payment_added', v_ipas.id, v_row.id, null, public._ipas_money_payment_snap(v_row.id));

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ipas_update_payment(p_payment_id uuid, p_kind text, p_paid_on date, p_amount numeric, p_php_debited numeric, p_charge_fee_php numeric, p_method_id uuid, p_check_no text, p_proof_url text, p_percent_of_order numeric DEFAULT NULL::numeric)
 RETURNS ipas_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_snap jsonb;
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

  v_snap := public._ipas_money_payment_snap(v_before.id);

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

  perform public._ipas_money_payment_chat('payment_changed', v_ipas.id, v_row.id, v_snap, public._ipas_money_payment_snap(v_row.id));

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ipas_remove_payment(p_payment_id uuid)
 RETURNS ipas_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_snap jsonb;
  v_actor uuid := public._ipas_money_writer('ipas_remove_payment');
  v_ipas_id uuid;
  v_ipas public.ipas;
  v_row public.ipas_payments;
begin
  select ipas_id into v_ipas_id from public.ipas_payments where id = p_payment_id;
  if v_ipas_id is null then
    raise exception 'ipas_remove_payment: payment % not found', p_payment_id using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_remove_payment', v_ipas_id);
  v_snap := public._ipas_money_payment_snap(p_payment_id);
  delete from public.ipas_payments where id = p_payment_id returning * into v_row;
  if v_row.id is null then
    raise exception 'ipas_remove_payment: payment % not found', p_payment_id using errcode = '22023';
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

  perform public._ipas_money_payment_chat('payment_removed', v_ipas.id, v_row.id, v_snap, null);

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ipas_set_payment_money(p_payment_id uuid, p_forex_rate numeric, p_doc_stamp_php numeric, p_misc_fee_php numeric)
 RETURNS ipas_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_snap jsonb;
  v_actor uuid := public._ipas_money_writer('ipas_set_payment_money');
  v_ipas_id uuid;
  v_before public.ipas_payments;
  v_row public.ipas_payments;
  v_rate numeric := round(p_forex_rate, 6);
  v_stamp numeric := round(coalesce(p_doc_stamp_php, 0), 2);
  v_misc numeric := round(coalesce(p_misc_fee_php, 0), 2);
begin
  select ipas_id into v_ipas_id from public.ipas_payments where id = p_payment_id;
  if v_ipas_id is null then
    raise exception 'ipas_set_payment_money: payment % not found', p_payment_id using errcode = '22023';
  end if;
  perform public._ipas_lock_open('ipas_set_payment_money', v_ipas_id);
  select * into v_before from public.ipas_payments where id = p_payment_id for update;
  if v_rate is not null and v_rate <= 0 then
    raise exception 'ipas_set_payment_money: the forex rate must be more than zero' using errcode = '22023';
  end if;
  if v_stamp < 0 or v_misc < 0 then
    raise exception 'ipas_set_payment_money: a fee can''t be negative' using errcode = '22023';
  end if;
  if v_before.forex_rate is not distinct from v_rate
     and v_before.doc_stamp_php = v_stamp and v_before.misc_fee_php = v_misc then
    return v_before;
  end if;

  v_snap := public._ipas_money_payment_snap(v_before.id);

  update public.ipas_payments
     set forex_rate = v_rate, doc_stamp_php = v_stamp, misc_fee_php = v_misc
   where id = v_before.id
  returning * into v_row;

  perform public._ipas_write_event(v_ipas_id, v_actor, 'payment_changed', jsonb_build_object(
    'payment_id', v_row.id,
    'kind', v_row.kind,
    'changes', jsonb_build_object(
      'forex_rate', jsonb_build_object('from', v_before.forex_rate, 'to', v_rate),
      'doc_stamp_php', jsonb_build_object('from', v_before.doc_stamp_php, 'to', v_stamp),
      'misc_fee_php', jsonb_build_object('from', v_before.misc_fee_php, 'to', v_misc)
    )
  ));
  perform public._ipas_money_payment_chat('payment_changed', v_ipas_id, v_row.id, v_snap, public._ipas_money_payment_snap(v_row.id));
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ipas_add_charge(p_ipas_id uuid, p_kind_id uuid, p_charged_on date, p_amount_php numeric)
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

  perform public._ipas_money_charge_chat('charge_added', v_ipas.id, v_row.id, null, public._ipas_money_charge_snap(v_row.id));

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ipas_update_charge(p_charge_id uuid, p_kind_id uuid, p_charged_on date, p_amount_php numeric)
 RETURNS ipas_charges
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_snap jsonb;
  v_actor uuid := public._ipas_money_writer('ipas_update_charge');
  v_ipas_id uuid;
  v_ipas public.ipas;
  v_before public.ipas_charges;
  v_row public.ipas_charges;
  v_amount numeric := round(p_amount_php, 2);
  v_label text;
  v_changes jsonb := '{}'::jsonb;
begin
  perform public._ipas_check_date('ipas_update_charge', p_charged_on, 'the charge date');
  select ipas_id into v_ipas_id from public.ipas_charges where id = p_charge_id;
  if v_ipas_id is null then
    raise exception 'ipas_update_charge: charge % not found', p_charge_id using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_update_charge', v_ipas_id);
  select * into v_before from public.ipas_charges where id = p_charge_id for update;
  if v_before.id is null then
    raise exception 'ipas_update_charge: charge % not found', p_charge_id using errcode = '22023';
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

  v_snap := public._ipas_money_charge_snap(v_before.id);

  update public.ipas_charges
     set kind_id = p_kind_id, charged_on = p_charged_on, amount_php = v_amount
   where id = v_before.id
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'charge_changed', jsonb_build_object(
    'charge_id', v_row.id,
    'kind', v_label,
    'changes', v_changes
  ));

  perform public._ipas_money_charge_chat('charge_changed', v_ipas.id, v_row.id, v_snap, public._ipas_money_charge_snap(v_row.id));

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ipas_fill_charge(p_charge_id uuid, p_charged_on date, p_amount_php numeric, p_attachment_url text)
 RETURNS ipas_charges
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_snap jsonb;
  v_actor uuid := public._ipas_money_writer('ipas_fill_charge');
  v_ipas_id uuid;
  v_ipas public.ipas;
  v_before public.ipas_charges;
  v_row public.ipas_charges;
  v_amount numeric := round(p_amount_php, 2);
  v_url text := nullif(btrim(coalesce(p_attachment_url, '')), '');
begin
  perform public._ipas_check_date('ipas_fill_charge', p_charged_on, 'the charge date');
  select ipas_id into v_ipas_id from public.ipas_charges where id = p_charge_id;
  if v_ipas_id is null then
    raise exception 'ipas_fill_charge: charge % not found', p_charge_id using errcode = '22023';
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

  v_snap := public._ipas_money_charge_snap(v_before.id);

  update public.ipas_charges
     set charged_on = p_charged_on, amount_php = v_amount, attachment_url = v_url
   where id = v_before.id
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'charge_changed', jsonb_build_object(
    'charge_id', v_row.id,
    'kind', (select o.label from public.ipas_options o where o.id = v_row.kind_id),
    'changes', jsonb_build_object('amount_php', jsonb_build_object('from', v_before.amount_php, 'to', v_amount))
  ));
  perform public._ipas_money_charge_chat(
    case when v_snap ->> 'amount' is null then 'charge_added' else 'charge_changed' end,
    v_ipas.id, v_row.id, v_snap, public._ipas_money_charge_snap(v_row.id));
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ipas_remove_charge(p_charge_id uuid)
 RETURNS ipas_charges
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_snap jsonb;
  v_actor uuid := public._ipas_money_writer('ipas_remove_charge');
  v_ipas_id uuid;
  v_ipas public.ipas;
  v_row public.ipas_charges;
begin
  select ipas_id into v_ipas_id from public.ipas_charges where id = p_charge_id;
  if v_ipas_id is null then
    raise exception 'ipas_remove_charge: charge % not found', p_charge_id using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_remove_charge', v_ipas_id);
  v_snap := public._ipas_money_charge_snap(p_charge_id);
  delete from public.ipas_charges where id = p_charge_id returning * into v_row;
  if v_row.id is null then
    raise exception 'ipas_remove_charge: charge % not found', p_charge_id using errcode = '22023';
  end if;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'charge_removed', jsonb_build_object(
    'charge_id', v_row.id,
    'kind', (select o.label from public.ipas_options o where o.id = v_row.kind_id),
    'charged_on', v_row.charged_on,
    'amount_php', v_row.amount_php
  ));

  perform public._ipas_money_charge_chat('charge_removed', v_ipas.id, v_row.id, v_snap, null);

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ipas_save_payment(p_ipas_id uuid, p_payment_id uuid, p_kind text, p_paid_on date, p_amount numeric, p_forex_rate numeric, p_doc_stamp_php numeric, p_misc_fee_php numeric, p_charge_fee_php numeric, p_method_id uuid, p_check_no text, p_proof_url text, p_percent_of_order numeric DEFAULT NULL::numeric, p_method_other text DEFAULT NULL::text, p_proof_urls text[] DEFAULT NULL::text[], p_ask_id uuid DEFAULT NULL::uuid)
 RETURNS ipas_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_snap jsonb;
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

  -- One line in the Chat for the whole save: the pieces below stay quiet, and the line is written at the end.
  perform set_config('ipas.money_chat_quiet', 'on', true);
  v_snap := public._ipas_money_payment_snap(p_payment_id);

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

  v_row := public.ipas_set_payment_money(v_row.id, v_rate, p_doc_stamp_php, p_misc_fee_php);

  perform set_config('ipas.money_chat_quiet', 'off', true);
  perform public._ipas_money_payment_chat(
    case when p_payment_id is null then 'payment_added' else 'payment_changed' end,
    v_ipas.id, v_row.id, v_snap, public._ipas_money_payment_snap(v_row.id));

  -- Paying an open ask: the trigger checks it is open, on this IPAS and supplier side, then closes it.
  -- It runs after the payment's own line so the Chat reads in order.
  if p_ask_id is not null then
    update public.ipas_payments set ask_id = p_ask_id where id = v_row.id and ask_id is distinct from p_ask_id;
    select * into v_row from public.ipas_payments where id = v_row.id;
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._ipas_payment_ask_to_chat(p_ipas_id uuid, p_event text, p_text text, p_ask_id uuid, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.ipas_messages (ipas_id, author_id, content, metadata, created_at)
  values (p_ipas_id, public.get_employee_id(), p_text,
          jsonb_build_object('event', p_event, 'ask_id', p_ask_id) || coalesce(p_meta, '{}'::jsonb), clock_timestamp());
$function$
;

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
    raise exception 'a payment can only pay a Down payment or Balance ask' using errcode = '22023';
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

CREATE OR REPLACE FUNCTION public.ipas_ask_for_payment(p_ipas_id uuid, p_amount numeric, p_purpose text, p_note text DEFAULT NULL::text, p_priority text DEFAULT 'high'::text, p_percent numeric DEFAULT NULL::numeric)
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
    v_row.id,
    public._ipas_ask_meta(v_row)
  );
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ipas_withdraw_payment_ask(p_ask_id uuid)
 RETURNS ipas_payment_asks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_meta jsonb;
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
   where id = p_ask_id and closed_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'ipas_withdraw_payment_ask: that ask is not open' using errcode = '22023';
  end if;

  v_meta := public._ipas_ask_meta(v_row);
  perform public._ipas_payment_ask_to_chat(
    v_row.ipas_id, 'payment_ask_withdrawn',
    'Withdrew the ask for payment: ' || (v_meta ->> 'purpose_label') || ' '
      || btrim((v_meta ->> 'currency') || ' ' || trim(to_char(v_row.amount, 'FM999G999G999G990.00'))) || '.',
    v_row.id, v_meta
  );
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ipas_edit_payment_ask(p_ask_id uuid, p_amount numeric, p_priority text, p_note text DEFAULT NULL::text, p_percent numeric DEFAULT NULL::numeric)
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

  if v_ask.amount = p_amount and v_ask.priority = p_priority
     and v_ask.note is not distinct from v_note and v_ask.percent_of_order is not distinct from p_percent then
    return v_ask;
  end if;

  update public.ipas_payment_asks
     set amount = p_amount, priority = p_priority, note = v_note, percent_of_order = p_percent
   where id = v_ask.id
  returning * into v_row;

  v_meta := public._ipas_ask_meta(v_row);
  v_changes := public._ipas_diff(
    jsonb_build_object('amount', v_ask.amount, 'priority', public._ipas_ask_priority_label(v_ask.priority),
                       'note', v_ask.note, 'percent_of_order', v_ask.percent_of_order),
    jsonb_build_object('amount', v_row.amount, 'priority', public._ipas_ask_priority_label(v_row.priority),
                       'note', v_row.note, 'percent_of_order', v_row.percent_of_order));
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

revoke all on function public._ipas_payment_ask_to_chat(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
