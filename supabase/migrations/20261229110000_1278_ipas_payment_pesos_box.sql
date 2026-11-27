-- #1278: a paid foreign payment is saved from the pesos taken from the bank, typed on the form.
-- Typed pesos are stored as php_debited with a null forex_rate (Landed Cost reads php_debited when there is no rate).
-- No pesos typed: the old behaviour (a stored rate is kept and the pesos are amount x rate).
DROP FUNCTION IF EXISTS public.ipas_save_payment(uuid, uuid, text, date, numeric, numeric, numeric, numeric, numeric, uuid, text, text, numeric, text, text[], uuid);


CREATE OR REPLACE FUNCTION public.ipas_save_payment(p_ipas_id uuid, p_payment_id uuid, p_kind text, p_paid_on date, p_amount numeric, p_forex_rate numeric, p_doc_stamp_php numeric, p_misc_fee_php numeric, p_charge_fee_php numeric, p_method_id uuid, p_check_no text, p_proof_url text, p_percent_of_order numeric DEFAULT NULL::numeric, p_method_other text DEFAULT NULL::text, p_proof_urls text[] DEFAULT NULL::text[], p_ask_id uuid DEFAULT NULL::uuid, p_php_debited numeric DEFAULT NULL::numeric)
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
  if v_php then
    v_pesos := null;
  elsif p_php_debited is not null then
    -- Pesos typed from the bank paper (#1278): they are the payment's rate. No rate is stored beside them.
    if p_php_debited <= 0 then
      raise exception 'ipas_save_payment: the pesos taken from the bank must be more than zero, or left blank' using errcode = '22023';
    end if;
    v_pesos := round(p_php_debited, 2);
    v_rate := null;
  else
    v_pesos := case when v_rate is null then null else round(p_amount * v_rate, 2) end;
  end if;

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

grant execute on function public.ipas_save_payment(uuid, uuid, text, date, numeric, numeric, numeric, numeric, numeric, uuid, text, text, numeric, text, text[], uuid, numeric) to authenticated;
