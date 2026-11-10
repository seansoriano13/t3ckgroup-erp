-- #551 (spec #544): Purchasing edits an IPAS's Remarks until it is filed.
-- ipas_set_header carries #547's definition forward (Checked by belongs to Finance) and adds 'remarks'.
-- Filed and cancelled IPAS are refused above (55000), so filing still freezes Remarks. The SOR list is not
-- a header field, so it stays fixed after raising. Finance's Checked by path stays one-key-only, so it
-- can't touch Remarks. Re-runnable (create or replace).

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
  v_sheet boolean;
  v_gantt boolean;
  v_label text;
  v_remarks text;
  v_is_purchasing boolean;
  v_changes jsonb := '{}'::jsonb;
begin
  if v_actor is null then
    raise exception 'ipas_set_header: not signed in' using errcode = '42501';
  end if;
  -- Purchasing changes an IPAS. Finance or a Super Admin may only give or take back
  -- "Checked by" (the last computation status), which is checked further down.
  v_is_purchasing := public.has_purchasing_access();
  if not v_is_purchasing
     and not (public.has_finance_access() or coalesce(public.is_super_admin(), false)) then
    raise exception 'ipas_set_header: only Purchasing changes an IPAS' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'ipas_set_header: the fields must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in (
      'supplier_contact', 'pi_number', 'pi_qt_amount', 'freight_service_id', 'landed_cost_split', 'computation_status',
      'google_sheet', 'gantt_chart', 'remarks'
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

  -- Remarks: free text, blank clears. A non-text value is refused with a sentence.
  v_remarks := v_row.remarks;
  if jsonb_exists(p_fields, 'remarks') then
    if jsonb_typeof(p_fields->'remarks') not in ('string', 'null') then
      raise exception 'ipas_set_header: Remarks must be text' using errcode = '22023';
    end if;
    v_remarks := nullif(btrim(p_fields->>'remarks'), '');
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
    if v_status is null or v_status not in ('encoding', 'encoded', 'lc_gs_done', 'lc_odoo_done', 'checked') then
      raise exception 'ipas_set_header: the computation status is Encoding, Encoded, LC GS Done, LC Odoo Done or Checked by'
        using errcode = '22023';
    end if;
  end if;

  -- Checked by belongs to Finance (#547). Purchasing, a Super Admin in Purchasing included, moves
  -- the status only from Encoding up to LC Odoo Done: it never gives Checked by and never takes it back.
  if v_is_purchasing then
    if v_status is distinct from v_row.computation_status
       and (v_status = 'checked' or v_row.computation_status = 'checked') then
      raise exception 'ipas_set_header: Checked by is Finance''s step; Purchasing can''t give it or take it back'
        using errcode = '42501';
    end if;
  else
    -- Finance and Super Admins (who aren't Purchasing) only move Checked by: from LC Odoo Done
    -- to Checked by, or back, and nothing else in the same call.
    if (select count(*) from jsonb_object_keys(p_fields)) <> 1
       or not jsonb_exists(p_fields, 'computation_status')
       or not (
         (v_row.computation_status = 'lc_odoo_done' and v_status = 'checked')
         or (v_row.computation_status = 'checked' and v_status = 'lc_odoo_done')
       ) then
      raise exception 'ipas_set_header: only Purchasing changes an IPAS; Finance gives or takes back Checked by' using errcode = '42501';
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
  -- The section 2 ticks: plain yes or no. JSON null and any other type are refused.
  v_sheet := v_row.google_sheet;
  if jsonb_exists(p_fields, 'google_sheet') then
    if jsonb_typeof(p_fields->'google_sheet') <> 'boolean' then
      raise exception 'ipas_set_header: Googlesheet must be ticked or not ticked' using errcode = '22023';
    end if;
    v_sheet := (p_fields->>'google_sheet')::boolean;
  end if;

  v_gantt := v_row.gantt_chart;
  if jsonb_exists(p_fields, 'gantt_chart') then
    if jsonb_typeof(p_fields->'gantt_chart') <> 'boolean' then
      raise exception 'ipas_set_header: Gantt Chart must be ticked or not ticked' using errcode = '22023';
    end if;
    v_gantt := (p_fields->>'gantt_chart')::boolean;
  end if;

  if v_sheet is distinct from v_row.google_sheet then
    v_changes := v_changes || jsonb_build_object('google_sheet', jsonb_build_object('from', v_row.google_sheet, 'to', v_sheet));
  end if;
  if v_gantt is distinct from v_row.gantt_chart then
    v_changes := v_changes || jsonb_build_object('gantt_chart', jsonb_build_object('from', v_row.gantt_chart, 'to', v_gantt));
  end if;
  if v_remarks is distinct from v_row.remarks then
    v_changes := v_changes || jsonb_build_object('remarks', jsonb_build_object('from', v_row.remarks, 'to', v_remarks));
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
         computation_status = v_status,
         google_sheet = v_sheet,
         gantt_chart = v_gantt,
         remarks = v_remarks
   where id = v_row.id
  returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'header_changed', jsonb_build_object('fields', v_changes));

  return v_row;
end;
$$;

comment on function public.ipas_set_header(uuid, jsonb) is
  '#243/#244/#241: Purchasing types the supplier''s name, P.I # and P.I/QT Amount, picks the freight service, sets the Landed Cost spread (value, quantity, equal), the computation status and the section 2 ticks (Googlesheet, Gantt Chart) and the Remarks on an open IPAS. Purchasing moves the status only up to LC Odoo Done and never gives or takes back Checked by (#547). Finance, or a Super Admin who is not Purchasing, may only give or take back Checked by. Keys present are set, blank clears where allowed. Writes one "header_changed" event with what changed.';
