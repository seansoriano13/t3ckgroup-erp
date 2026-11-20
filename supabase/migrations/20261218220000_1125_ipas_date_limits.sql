-- #1125 (spec #1123, tracker A3): a payment date, a charge date and the typed Delivered / Import Clearance
-- dates must fall between 2015-01-01 and today (Asia/Manila). Existing rows stay as they are.
create or replace function public._ipas_check_date(p_fn text, p_date date, p_what text)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if p_date is null then
    return;
  end if;
  if p_date > (now() at time zone 'Asia/Manila')::date then
    raise exception '%: % cannot be after today', p_fn, p_what using errcode = '22023';
  end if;
  if p_date < date '2015-01-01' then
    raise exception '%: % cannot be before January 1, 2015', p_fn, p_what using errcode = '22023';
  end if;
end;
$$;

revoke all on function public._ipas_check_date(text, date, text) from public, anon;

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

  return v_row;
end;
$$;

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

revoke all on function public.ipas_update_charge(uuid, uuid, date, numeric) from public, anon;
grant execute on function public.ipas_update_charge(uuid, uuid, date, numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.ipas_fill_charge(p_charge_id uuid, p_charged_on date, p_amount_php numeric, p_attachment_url text)
 RETURNS ipas_charges
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
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

  update public.ipas_charges
     set charged_on = p_charged_on, amount_php = v_amount, attachment_url = v_url
   where id = v_before.id
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'charge_changed', jsonb_build_object(
    'charge_id', v_row.id,
    'kind', (select o.label from public.ipas_options o where o.id = v_row.kind_id),
    'changes', jsonb_build_object('amount_php', jsonb_build_object('from', v_before.amount_php, 'to', v_amount))
  ));
  return v_row;
end;
$function$;

revoke all on function public.ipas_fill_charge(uuid, date, numeric, text) from public, anon;
grant execute on function public.ipas_fill_charge(uuid, date, numeric, text) to authenticated;

create or replace function public.ipas_set_typed_status(p_ipas_id uuid, p_status text, p_date date)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_set_typed_status');
  v_row public.ipas;
  v_from date;
begin
  perform public._ipas_check_date('ipas_set_typed_status', p_date, 'the ' || replace(p_status, '_', ' ') || ' date');
  if p_status is null or p_status not in ('import_clearance', 'delivered') then
    raise exception 'ipas_set_typed_status: Import Clearance and Delivered are the typed statuses' using errcode = '22023';
  end if;

  v_row := public._ipas_lock_open('ipas_set_typed_status', p_ipas_id);
  if p_status = 'import_clearance' and v_row.source <> 'import' then
    raise exception 'ipas_set_typed_status: % is a Local IPAS; Import Clearance is for Import only', v_row.number
      using errcode = '22023';
  end if;

  v_from := case p_status when 'import_clearance' then v_row.import_clearance_on else v_row.delivered_on end;
  if v_from is not distinct from p_date then
    return v_row;
  end if;

  if p_status = 'import_clearance' then
    update public.ipas
       set import_clearance_on = p_date,
           import_clearance_typed_by = case when p_date is null then null else v_actor end,
           import_clearance_typed_at = case when p_date is null then null else now() end
     where id = v_row.id
    returning * into v_row;
  else
    update public.ipas
       set delivered_on = p_date,
           delivered_typed_by = case when p_date is null then null else v_actor end,
           delivered_typed_at = case when p_date is null then null else now() end
     where id = v_row.id
    returning * into v_row;
  end if;

  perform public._ipas_write_event(v_row.id, v_actor,
    case when p_date is null then 'status_cleared' else 'status_typed' end,
    jsonb_build_object('status', p_status, 'from', v_from, 'to', p_date));

  return v_row;
end;
$$;

revoke all on function public.ipas_set_typed_status(uuid, text, date) from public, anon;
grant execute on function public.ipas_set_typed_status(uuid, text, date) to authenticated;
