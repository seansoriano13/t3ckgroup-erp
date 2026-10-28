-- Refusal codes (tier 108): every IPAS refusal is 42501, 22023 or 23505. ipas_fill_charge (#709) and
-- ipas_set_markup (#710) raised "not found" as P0002; they now say 22023 like the rest. Definitions are
-- unchanged otherwise; create or replace keeps the grants.

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

CREATE OR REPLACE FUNCTION public.ipas_set_markup(p_ipas_id uuid, p_multiplier numeric, p_discount_pct numeric)
 RETURNS ipas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ipas public.ipas;
  v_row public.ipas;
  v_mult numeric := case when p_multiplier is null then null else round(p_multiplier, 4) end;
  v_disc numeric := round(coalesce(p_discount_pct, 30), 2);
begin
  if not public.ipas_can_set_markup() then
    raise exception 'ipas_set_markup: only the Markup list can set the multiplier and the discount' using errcode = '42501';
  end if;
  select * into v_ipas from public.ipas where id = p_ipas_id for update;
  if v_ipas.id is null then
    raise exception 'ipas_set_markup: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if v_mult is not null and v_mult <= 0 then
    raise exception 'ipas_set_markup: the multiplier must be more than zero' using errcode = '22023';
  end if;
  if v_disc < 0 or v_disc >= 100 then
    raise exception 'ipas_set_markup: the discount must be from 0 up to 100' using errcode = '22023';
  end if;
  if v_ipas.retail_multiplier is not distinct from v_mult and v_ipas.wholesale_discount_pct = v_disc then
    return v_ipas;
  end if;

  update public.ipas set retail_multiplier = v_mult, wholesale_discount_pct = v_disc
   where id = v_ipas.id returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, public.get_employee_id(), 'header_changed', jsonb_build_object(
    'changes', jsonb_build_object(
      'retail_multiplier', jsonb_build_object('from', v_ipas.retail_multiplier, 'to', v_mult),
      'wholesale_discount_pct', jsonb_build_object('from', v_ipas.wholesale_discount_pct, 'to', v_disc))
  ));
  return v_row;
end;
$function$;
