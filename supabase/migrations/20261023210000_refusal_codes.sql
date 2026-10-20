-- #556 (spec #544, story 55): every refusal raised by the IPAS, Transmittal and
-- Costing functions carries one of three codes, so none reads as a server error:
--   42501  not allowed   22023  invalid value / wrong state   23505  already exists
-- PostgREST turns 55000 (object not in prerequisite state) into HTTP 500, which is why a
-- sign order, a send back, a document removal, a second cancel and a change to a filed
-- IPAS all looked like the app broke. Each function below is its LATEST definition with
-- only the SQLSTATE of its refusals changed:
--   55000 wrong state, P0002 not found, 23514 rule broken, P0001 / none -> 22023
--   ipas_actual_checking_hand_guard (P0001, hand stamping) -> 42501
-- Messages, hints and every other line are unchanged. Table CHECK constraints still raise
-- 23514 themselves; only refusals raised by these functions moved.
-- Re-runnable: create or replace.

-- ipas_enforce_sor_rule (latest: 20261013100100_ipas.sql)
create or replace function public.ipas_enforce_sor_rule()
returns trigger
language plpgsql
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_purpose text;
  v_number text;
  v_count integer;
begin
  if tg_table_name = 'ipas' then
    v_ids := array[new.id];
  elsif tg_op = 'DELETE' then
    v_ids := array[old.ipas_id];
  elsif tg_op = 'UPDATE' and new.ipas_id is distinct from old.ipas_id then
    v_ids := array[new.ipas_id, old.ipas_id];
  else
    v_ids := array[new.ipas_id];
  end if;

  foreach v_id in array v_ids loop
    select i.purpose, i.number into v_purpose, v_number from public.ipas i where i.id = v_id;
    -- The IPAS itself is gone (a cascade): nothing left to hold to the rule.
    if v_purpose is null then
      continue;
    end if;
    select count(*) into v_count from public.ipas_sors s where s.ipas_id = v_id;
    if v_purpose = 'project' and v_count = 0 then
      raise exception '% is a Project IPAS and needs at least one SOR', v_number using errcode = '22023';
    end if;
    if v_purpose <> 'project' and v_count > 0 then
      raise exception '% is not a Project IPAS and can''t name an SOR', v_number using errcode = '22023';
    end if;
  end loop;
  return null;
end;
$$;

-- _ipas_clean_sor_ids (latest: 20261013100100_ipas.sql)
create or replace function public._ipas_clean_sor_ids(p_fn text, p_purpose text, p_sor_ids uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_found integer;
begin
  if p_sor_ids is not null and array_position(p_sor_ids, null) is not null then
    raise exception '%: an SOR id is missing', p_fn using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct s), '{}'::uuid[]) into v_ids from unnest(coalesce(p_sor_ids, '{}'::uuid[])) s;

  if p_purpose = 'project' and cardinality(v_ids) = 0 then
    raise exception '%: a Project IPAS needs at least one SOR', p_fn using errcode = '22023';
  end if;
  if p_purpose <> 'project' and cardinality(v_ids) > 0 then
    raise exception '%: an Inventory, Supplies or Events IPAS can''t name an SOR; put the note in Remarks', p_fn
      using errcode = '22023';
  end if;

  if cardinality(v_ids) > 0 then
    select count(*) into v_found
      from public.sales_opportunities o
     where o.id = any (v_ids) and not coalesce(o.is_deleted, false);
    if v_found <> cardinality(v_ids) then
      raise exception '%: one of those SORs no longer exists', p_fn using errcode = '22023';
    end if;
  end if;
  return v_ids;
end;
$$;

-- ipas_set_purpose_and_sors (latest: 20261013100100_ipas.sql)
create or replace function public.ipas_set_purpose_and_sors(
  p_ipas_id uuid,
  p_purpose text,
  p_sor_ids uuid[]
) returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas;
  v_before uuid[];
  v_after uuid[];
  v_from text;
begin
  if v_actor is null then
    raise exception 'ipas_set_purpose_and_sors: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_set_purpose_and_sors: only Purchasing changes an IPAS' using errcode = '42501';
  end if;
  if p_purpose is null or p_purpose not in ('project', 'inventory', 'supplies', 'events') then
    raise exception 'ipas_set_purpose_and_sors: % isn''t a Purpose', coalesce(p_purpose, 'null') using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_set_purpose_and_sors: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_set_purpose_and_sors: % is filed; a Super Admin reopens it first', v_row.number
      using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_set_purpose_and_sors: % is cancelled', v_row.number using errcode = '22023';
  end if;

  v_after := public._ipas_clean_sor_ids('ipas_set_purpose_and_sors', p_purpose, p_sor_ids);
  select coalesce(array_agg(s.opportunity_id order by s.opportunity_id), '{}'::uuid[]) into v_before
    from public.ipas_sors s where s.ipas_id = v_row.id;
  select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_after from unnest(v_after) x;

  if v_row.purpose = p_purpose and v_before = v_after then
    return v_row;
  end if;

  v_from := v_row.purpose;
  delete from public.ipas_sors where ipas_id = v_row.id;
  update public.ipas set purpose = p_purpose where id = v_row.id returning * into v_row;
  insert into public.ipas_sors (ipas_id, opportunity_id)
  select v_row.id, s from unnest(v_after) s;

  perform public._ipas_write_event(v_row.id, v_actor, 'purpose_sors_changed', jsonb_build_object(
    'purpose_from', v_from,
    'purpose_to', v_row.purpose,
    'sor_ids_from', to_jsonb(v_before),
    'sor_ids_to', to_jsonb(v_after)
  ));

  return v_row;
end;
$$;

-- ipas_cancel (latest: 20261013100100_ipas.sql)
create or replace function public.ipas_cancel(p_ipas_id uuid, p_reason text)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_row public.ipas;
begin
  if v_actor is null then
    raise exception 'ipas_cancel: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_cancel: only Purchasing cancels an IPAS' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_cancel: a cancelled IPAS needs a reason' using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_cancel: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_cancel: % is filed; a Super Admin reopens it before it can be cancelled', v_row.number
      using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_cancel: % is already cancelled', v_row.number using errcode = '22023';
  end if;

  update public.ipas
     set state = 'cancelled',
         cancel_reason = v_reason,
         cancelled_by = v_actor,
         cancelled_at = now()
   where id = v_row.id
  returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'cancelled', jsonb_build_object('reason', v_reason));

  return v_row;
end;
$$;

-- ipas_record_odoo_copy (latest: 20261013100300_ipas_odoo_copy.sql)
create or replace function public.ipas_record_odoo_copy(p_ipas_id uuid, p_odoo_copy jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas;
  v_before public.ipas;
  v_note jsonb;
  v_lines_changed boolean;
  v_digest_changed boolean;
  v_state_from text;
  v_state_to text;
  v_filled text[] := '{}';
  v_sections integer[] := '{}';
  v_preparers uuid[] := '{}';
begin
  if v_actor is null then
    raise exception 'ipas_record_odoo_copy: not signed in' using errcode = '42501';
  end if;
  if not public.ipas_can_read() then
    raise exception 'ipas_record_odoo_copy: you can''t read IPAS' using errcode = '42501';
  end if;

  if p_odoo_copy is null
     or jsonb_typeof(p_odoo_copy) <> 'object'
     or jsonb_typeof(p_odoo_copy->'po') is distinct from 'object'
     or jsonb_typeof(p_odoo_copy->'lines') is distinct from 'array' then
    raise exception 'ipas_record_odoo_copy: the Odoo copy is missing' using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_record_odoo_copy: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if upper(btrim(p_odoo_copy->'po'->>'name')) is distinct from v_row.po_number then
    raise exception 'ipas_record_odoo_copy: the Odoo copy is for %, not %',
      coalesce(p_odoo_copy->'po'->>'name', 'no PO'), v_row.po_number
      using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_record_odoo_copy: % is cancelled and keeps the copy it had', v_row.number
      using errcode = '22023';
  end if;

  v_before := v_row;
  v_digest_changed := public._ipas_copy_digest(v_row.odoo_copy) is distinct from public._ipas_copy_digest(p_odoo_copy);

  -- A filed IPAS keeps its frozen copy. All that moves is the flag, in step with
  -- whether the PO still matches what was filed.
  if v_row.state = 'filed' then
    if v_digest_changed is distinct from v_row.odoo_changed_since_filing then
      update public.ipas set odoo_changed_since_filing = v_digest_changed where id = v_row.id returning * into v_row;
      if v_digest_changed then
        perform public._ipas_write_event(v_row.id, v_actor, 'odoo_changed_since_filing', jsonb_build_object(
          'note', public._ipas_change_note(v_before.odoo_copy, p_odoo_copy, v_before.odoo_fetched_at)
        ));
      end if;
    end if;
    return jsonb_build_object(
      'ipas', to_jsonb(v_row),
      'changed', false,
      'filed', true,
      'approvals_cleared', '[]'::jsonb,
      'preparer_ids', '[]'::jsonb
    );
  end if;

  v_note := public._ipas_change_note(v_row.odoo_copy, p_odoo_copy, v_row.odoo_fetched_at);
  v_lines_changed := v_note is not null;
  v_state_from := public._ipas_po_state_class(v_row.odoo_copy);
  v_state_to := public._ipas_po_state_class(p_odoo_copy);

  -- The trigger fills a blank contact and P.I # from the new copy.
  update public.ipas
     set odoo_copy = p_odoo_copy,
         odoo_fetched_at = now(),
         odoo_po_id = case when (p_odoo_copy->'po'->>'id') ~ '^[0-9]+$' then (p_odoo_copy->'po'->>'id')::integer else odoo_po_id end,
         odoo_change_note = case
           when v_note is null then odoo_change_note
           else v_note || jsonb_build_object('at', now())
         end
   where id = v_row.id
  returning * into v_row;

  if v_row.supplier_contact is distinct from v_before.supplier_contact then
    v_filled := array_append(v_filled, 'supplier_contact');
  end if;
  if v_row.pi_number is distinct from v_before.pi_number then
    v_filled := array_append(v_filled, 'pi_number');
  end if;
  if cardinality(v_filled) > 0 then
    perform public._ipas_write_event(v_row.id, v_actor, 'filled_from_odoo', jsonb_build_object(
      'fields', to_jsonb(v_filled),
      'supplier_contact', case when 'supplier_contact' = any (v_filled) then v_row.supplier_contact end,
      'pi_number', case when 'pi_number' = any (v_filled) then v_row.pi_number end
    ));
  end if;

  if v_lines_changed or v_state_from is distinct from v_state_to then
    perform public._ipas_write_event(v_row.id, v_actor, 'odoo_copy_changed', jsonb_build_object(
      'note', v_note,
      'po_state_from', v_before.odoo_copy->'po'->>'state',
      'po_state_to', p_odoo_copy->'po'->>'state'
    ));
  end if;

  -- Lines or the total changed: the live section 1 and 3 approvals no longer
  -- approve what is being bought. #247 creates ipas_signoffs; until then there
  -- is nothing to clear.
  if v_lines_changed and to_regclass('public.ipas_signoffs') is not null then
    execute $q$
      with cleared as (
        update public.ipas_signoffs s
           set cleared_at = now(), cleared_reason = 'PO changed in Odoo'
         where s.ipas_id = $1
           and s.section in (1, 3)
           and s.role = 'approved'
           and s.cleared_at is null
        returning s.section
      )
      select coalesce(array_agg(distinct section::integer), '{}'::integer[]) from cleared
    $q$ into v_sections using v_row.id;

    if cardinality(v_sections) > 0 then
      execute $q$
        select coalesce(array_agg(distinct s.signed_by), '{}'::uuid[])
          from public.ipas_signoffs s
         where s.ipas_id = $1
           and s.section = any ($2)
           and s.role = 'prepared'
           and s.cleared_at is null
           and s.signed_by is not null
      $q$ into v_preparers using v_row.id, v_sections;

      perform public._ipas_write_event(v_row.id, v_actor, 'approvals_cleared', jsonb_build_object(
        'reason', 'PO changed in Odoo',
        'sections', to_jsonb(v_sections)
      ));
    end if;
  end if;

  return jsonb_build_object(
    'ipas', to_jsonb(v_row),
    'changed', v_lines_changed,
    'filed', false,
    'approvals_cleared', to_jsonb(v_sections),
    'preparer_ids', to_jsonb(v_preparers)
  );
end;
$$;

-- ipas_override_field (latest: 20261013100300_ipas_odoo_copy.sql)
create or replace function public.ipas_override_field(p_ipas_id uuid, p_field text, p_value text)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_value text := nullif(btrim(p_value), '');
  v_row public.ipas;
  v_from text;
begin
  if v_actor is null then
    raise exception 'ipas_override_field: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_override_field: only Purchasing overrides an Odoo field' using errcode = '42501';
  end if;
  if p_field is null or p_field not in ('entity', 'source_doc', 'analytic') then
    raise exception 'ipas_override_field: % can''t be overridden; only Entity, Source Doc. and Analytic Dist. can (Currency, Supplier, item lines and Brand are fixed on the PO in Odoo)',
      coalesce(p_field, 'null')
      using errcode = '22023';
  end if;
  if v_value is null then
    raise exception 'ipas_override_field: type a value, or reset the field to Odoo' using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_override_field: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_override_field: % is filed; a Super Admin reopens it first', v_row.number using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_override_field: % is cancelled', v_row.number using errcode = '22023';
  end if;

  v_from := case p_field
    when 'entity' then v_row.entity_override
    when 'source_doc' then v_row.source_doc_override
    else v_row.analytic_override
  end;
  if v_from is not distinct from v_value then
    return v_row;
  end if;

  update public.ipas
     set entity_override     = case when p_field = 'entity' then v_value else entity_override end,
         source_doc_override = case when p_field = 'source_doc' then v_value else source_doc_override end,
         analytic_override   = case when p_field = 'analytic' then v_value else analytic_override end
   where id = v_row.id
  returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'override_set', jsonb_build_object(
    'field', p_field,
    'from', v_from,
    'to', v_value,
    'odoo', public._ipas_odoo_value(v_row.odoo_copy, p_field)
  ));

  return v_row;
end;
$$;

-- ipas_reset_override (latest: 20261013100300_ipas_odoo_copy.sql)
create or replace function public.ipas_reset_override(p_ipas_id uuid, p_field text)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas;
  v_from text;
begin
  if v_actor is null then
    raise exception 'ipas_reset_override: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_reset_override: only Purchasing resets an Odoo field' using errcode = '42501';
  end if;
  if p_field is null or p_field not in ('entity', 'source_doc', 'analytic') then
    raise exception 'ipas_reset_override: % isn''t an overridable field', coalesce(p_field, 'null') using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_reset_override: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_reset_override: % is filed; a Super Admin reopens it first', v_row.number using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_reset_override: % is cancelled', v_row.number using errcode = '22023';
  end if;

  v_from := case p_field
    when 'entity' then v_row.entity_override
    when 'source_doc' then v_row.source_doc_override
    else v_row.analytic_override
  end;
  if v_from is null then
    return v_row;
  end if;

  update public.ipas
     set entity_override     = case when p_field = 'entity' then null else entity_override end,
         source_doc_override = case when p_field = 'source_doc' then null else source_doc_override end,
         analytic_override   = case when p_field = 'analytic' then null else analytic_override end
   where id = v_row.id
  returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'override_reset', jsonb_build_object(
    'field', p_field,
    'from', v_from,
    'odoo', public._ipas_odoo_value(v_row.odoo_copy, p_field)
  ));

  return v_row;
end;
$$;

-- ipas_set_header (latest: 20261023160000_ipas_remarks_editable.sql)
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
    raise exception 'ipas_set_header: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_set_header: % is filed; a Super Admin reopens it first', v_row.number using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_set_header: % is cancelled', v_row.number using errcode = '22023';
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

-- _ipas_lock_open (latest: 20261013100400_ipas_payments_charges.sql)
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
    raise exception '%: IPAS % not found', p_fn, p_ipas_id using errcode = '22023';
  end if;
  if v_row.state = 'filed' then
    raise exception '%: % is filed; a Super Admin reopens it first', p_fn, v_row.number using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception '%: % is cancelled', p_fn, v_row.number using errcode = '22023';
  end if;
  return v_row;
end;
$$;

-- ipas_update_payment (latest: 20261013100400_ipas_payments_charges.sql)
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

-- ipas_remove_payment (latest: 20261013100400_ipas_payments_charges.sql)
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
    raise exception 'ipas_remove_payment: payment % not found', p_payment_id using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_remove_payment', v_ipas_id);
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

  return v_row;
end;
$$;

-- ipas_update_charge (latest: 20261013100400_ipas_payments_charges.sql)
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

-- ipas_remove_charge (latest: 20261013100400_ipas_payments_charges.sql)
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
    raise exception 'ipas_remove_charge: charge % not found', p_charge_id using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_remove_charge', v_ipas_id);
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

  return v_row;
end;
$$;

-- _ipas_lock_document (latest: 20261013100600_ipas_documents_statuses.sql)
create or replace function public._ipas_lock_document(p_fn text, p_document_id uuid)
returns public.ipas_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ipas_documents;
begin
  select * into v_row from public.ipas_documents where id = p_document_id;
  if v_row.id is null then
    raise exception '%: document % not found', p_fn, p_document_id using errcode = '22023';
  end if;
  perform public._ipas_lock_open(p_fn, v_row.ipas_id);
  select * into v_row from public.ipas_documents where id = p_document_id for update;
  if v_row.id is null then
    raise exception '%: document % not found', p_fn, p_document_id using errcode = '22023';
  end if;
  return v_row;
end;
$$;

-- ipas_remove_document (latest: 20261013101100_ipas_followups.sql)
create or replace function public.ipas_remove_document(p_document_id uuid)
returns public.ipas_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_remove_document');
  v_row public.ipas_documents;
  v_label text;
begin
  v_row := public._ipas_lock_document('ipas_remove_document', p_document_id);
  if v_row.kind_id is not null then
    raise exception 'ipas_remove_document: % is a listed document kind; only a document added by hand can be removed', public._ipas_document_label(v_row)
      using errcode = '22023';
  end if;
  if v_row.finance_has then
    raise exception 'ipas_remove_document: Finance has ticked this document; ask Finance to untick it first'
      using errcode = '22023';
  end if;
  v_label := public._ipas_document_label(v_row);

  delete from public.ipas_documents where id = v_row.id;

  perform public._ipas_write_event(v_row.ipas_id, v_actor, 'document_removed', jsonb_build_object(
    'document_id', v_row.id,
    'label', v_label,
    'purchasing_has', v_row.purchasing_has,
    'had_attachment', v_row.attachment_url is not null
  ));

  return v_row;
end;
$$;

-- _ipas_clear_approvals (latest: 20261013100700_ipas_signoffs.sql)
create or replace function public._ipas_clear_approvals(
  p_ipas_id uuid,
  p_actor uuid,
  p_reason text,
  out sections integer[],
  out preparer_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
begin
  with cleared as (
    update public.ipas_signoffs s
       set cleared_at = now(), cleared_by = p_actor, cleared_reason = p_reason
     where s.ipas_id = p_ipas_id
       and s.section in (1, 3)
       and s.role = 'approved'
       and s.cleared_at is null
    returning s.section
  )
  select coalesce(array_agg(distinct section::integer), '{}'::integer[]) into sections from cleared;

  preparer_ids := '{}'::uuid[];
  if cardinality(sections) > 0 then
    select coalesce(array_agg(distinct s.signed_by), '{}'::uuid[])
      into preparer_ids
      from public.ipas_signoffs s
     where s.ipas_id = p_ipas_id
       and s.section = any (sections)
       and s.role = 'prepared'
       and s.cleared_at is null;

    perform public._ipas_write_event(p_ipas_id, p_actor, 'approvals_cleared', jsonb_build_object(
      'reason', p_reason,
      'sections', to_jsonb(sections)
    ));
  end if;
end;
$$;

revoke all on function public._ipas_clear_approvals(uuid, uuid, text) from public, anon, authenticated;

-- ipas_record_odoo_copy and ipas_set_bank_details are re-created here, from
-- their #243 and #245 bodies, with the dynamic SQL replaced by a call to the
-- helper above. Nothing else in them changes.
create or replace function public.ipas_record_odoo_copy(p_ipas_id uuid, p_odoo_copy jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas;
  v_before public.ipas;
  v_note jsonb;
  v_lines_changed boolean;
  v_digest_changed boolean;
  v_state_from text;
  v_state_to text;
  v_filled text[] := '{}';
  v_sections integer[] := '{}';
  v_preparers uuid[] := '{}';
begin
  if v_actor is null then
    raise exception 'ipas_record_odoo_copy: not signed in' using errcode = '42501';
  end if;
  if not public.ipas_can_read() then
    raise exception 'ipas_record_odoo_copy: you can''t read IPAS' using errcode = '42501';
  end if;

  if p_odoo_copy is null
     or jsonb_typeof(p_odoo_copy) <> 'object'
     or jsonb_typeof(p_odoo_copy->'po') is distinct from 'object'
     or jsonb_typeof(p_odoo_copy->'lines') is distinct from 'array' then
    raise exception 'ipas_record_odoo_copy: the Odoo copy is missing' using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_record_odoo_copy: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if upper(btrim(p_odoo_copy->'po'->>'name')) is distinct from v_row.po_number then
    raise exception 'ipas_record_odoo_copy: the Odoo copy is for %, not %',
      coalesce(p_odoo_copy->'po'->>'name', 'no PO'), v_row.po_number
      using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_record_odoo_copy: % is cancelled and keeps the copy it had', v_row.number
      using errcode = '22023';
  end if;

  v_before := v_row;
  v_digest_changed := public._ipas_copy_digest(v_row.odoo_copy) is distinct from public._ipas_copy_digest(p_odoo_copy);

  -- A filed IPAS keeps its frozen copy. All that moves is the flag, in step with
  -- whether the PO still matches what was filed.
  if v_row.state = 'filed' then
    if v_digest_changed is distinct from v_row.odoo_changed_since_filing then
      update public.ipas set odoo_changed_since_filing = v_digest_changed where id = v_row.id returning * into v_row;
      if v_digest_changed then
        perform public._ipas_write_event(v_row.id, v_actor, 'odoo_changed_since_filing', jsonb_build_object(
          'note', public._ipas_change_note(v_before.odoo_copy, p_odoo_copy, v_before.odoo_fetched_at)
        ));
      end if;
    end if;
    return jsonb_build_object(
      'ipas', to_jsonb(v_row),
      'changed', false,
      'filed', true,
      'approvals_cleared', '[]'::jsonb,
      'preparer_ids', '[]'::jsonb
    );
  end if;

  v_note := public._ipas_change_note(v_row.odoo_copy, p_odoo_copy, v_row.odoo_fetched_at);
  v_lines_changed := v_note is not null;
  v_state_from := public._ipas_po_state_class(v_row.odoo_copy);
  v_state_to := public._ipas_po_state_class(p_odoo_copy);

  -- The trigger fills a blank contact and P.I # from the new copy.
  update public.ipas
     set odoo_copy = p_odoo_copy,
         odoo_fetched_at = now(),
         odoo_po_id = case when (p_odoo_copy->'po'->>'id') ~ '^[0-9]+$' then (p_odoo_copy->'po'->>'id')::integer else odoo_po_id end,
         odoo_change_note = case
           when v_note is null then odoo_change_note
           else v_note || jsonb_build_object('at', now())
         end
   where id = v_row.id
  returning * into v_row;

  if v_row.supplier_contact is distinct from v_before.supplier_contact then
    v_filled := array_append(v_filled, 'supplier_contact');
  end if;
  if v_row.pi_number is distinct from v_before.pi_number then
    v_filled := array_append(v_filled, 'pi_number');
  end if;
  if cardinality(v_filled) > 0 then
    perform public._ipas_write_event(v_row.id, v_actor, 'filled_from_odoo', jsonb_build_object(
      'fields', to_jsonb(v_filled),
      'supplier_contact', case when 'supplier_contact' = any (v_filled) then v_row.supplier_contact end,
      'pi_number', case when 'pi_number' = any (v_filled) then v_row.pi_number end
    ));
  end if;

  if v_lines_changed or v_state_from is distinct from v_state_to then
    perform public._ipas_write_event(v_row.id, v_actor, 'odoo_copy_changed', jsonb_build_object(
      'note', v_note,
      'po_state_from', v_before.odoo_copy->'po'->>'state',
      'po_state_to', p_odoo_copy->'po'->>'state'
    ));
  end if;

  -- Lines or the total changed: the live section 1 and 3 approvals no longer
  -- approve what is being bought. Prepared stays, so the section goes back to
  -- awaiting approval.
  if v_lines_changed then
    select c.sections, c.preparer_ids
      into v_sections, v_preparers
      from public._ipas_clear_approvals(v_row.id, v_actor, 'PO changed in Odoo') c;
  end if;

  return jsonb_build_object(
    'ipas', to_jsonb(v_row),
    'changed', v_lines_changed,
    'filed', false,
    'approvals_cleared', to_jsonb(v_sections),
    'preparer_ids', to_jsonb(v_preparers)
  );
end;
$$;

-- ipas_sign (latest: 20261014120000_ipas_return_undo_lc_status.sql)
create or replace function public.ipas_sign(
  p_ipas_id uuid,
  p_section integer,
  p_role text,
  p_decline_signature boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_ipas public.ipas;
  v_prepared public.ipas_signoffs;
  v_row public.ipas_signoffs;
  v_list_key text;
  v_signature text;
  v_notify uuid[] := '{}';
  v_stage text;
  v_filed boolean := false;
  v_other integer;
begin
  if v_actor is null then
    raise exception 'ipas_sign: not signed in' using errcode = '42501';
  end if;
  if p_section is null or p_role is null or not public._ipas_signoff_pair_ok(p_section, p_role) then
    raise exception 'ipas_sign: section % has no % sign-off', coalesce(p_section::text, 'null'), coalesce(p_role, 'null')
      using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_sign', p_ipas_id);
  v_list_key := public._ipas_signoff_list_key(p_section, p_role);

  if p_role = 'prepared' then
    if not public.has_purchasing_access() then
      raise exception 'ipas_sign: only Purchasing prepares a section' using errcode = '42501';
    end if;
  elsif not public._ipas_on_list(v_list_key, v_actor) then
    -- Every other sign-off belongs to its list, and a Super Admin is no
    -- exception: they sign when they are on it.
    raise exception 'ipas_sign: you are not on the list that may give this sign-off' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.ipas_signoffs s
     where s.ipas_id = v_ipas.id and s.section = p_section and s.role = p_role and s.cleared_at is null
  ) then
    raise exception 'ipas_sign: section % is already % on %', p_section, p_role, v_ipas.number using errcode = '22023';
  end if;

  if p_role = 'approved' and p_section in (1, 3) then
    select * into v_prepared
      from public.ipas_signoffs s
     where s.ipas_id = v_ipas.id and s.section = p_section and s.role = 'prepared' and s.cleared_at is null;
    if v_prepared.id is null then
      raise exception 'ipas_sign: section % hasn''t been prepared yet', p_section using errcode = '22023';
    end if;
    if v_prepared.signed_by = v_actor then
      raise exception 'ipas_sign: you prepared section %, so someone else approves it', p_section using errcode = '42501';
    end if;
  end if;

  if p_section = 7 then
    -- Section 7 opens once sections 1 and 3 are approved (checked at every step:
    -- an approval undone by an Odoo change closes it again).
    if not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 1 and s.role = 'approved' and s.cleared_at is null
    ) or not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 3 and s.role = 'approved' and s.cleared_at is null
    ) then
      raise exception 'ipas_sign: section 7 opens once sections 1 and 3 are approved' using errcode = '22023';
    end if;

    -- Received first; Noted and Checked after it, in any order.
    if p_role in ('noted', 'checked') and not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 7 and s.role = 'received' and s.cleared_at is null
    ) then
      raise exception 'ipas_sign: Received comes first; % can only be given after it', initcap(p_role) using errcode = '22023';
    end if;

    if p_role = 'approved' then
      if (
        select count(*) from public.ipas_signoffs s
         where s.ipas_id = v_ipas.id and s.section = 7 and s.role in ('received', 'noted', 'checked') and s.cleared_at is null
      ) < 3 then
        raise exception 'ipas_sign: Approved needs Received, Noted and Checked first' using errcode = '22023';
      end if;
      if v_ipas.computation_status not in ('lc_odoo_done', 'checked') then
        raise exception 'ipas_sign: % can''t be filed until LC Odoo Done: Landed Cost is still provisional, and Filing freezes it as final', v_ipas.number
          using errcode = '22023';
      end if;
    end if;
  end if;

  if p_decline_signature then
    v_signature := null;
  else
    select e.signature_path into v_signature from public.employees e where e.id = v_actor;
  end if;

  insert into public.ipas_signoffs (ipas_id, section, role, signed_by, signature_declined, signature_version)
  values (v_ipas.id, p_section, p_role, v_actor, coalesce(p_decline_signature, false), v_signature)
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'signed', jsonb_build_object(
    'section', p_section,
    'role', p_role,
    'signoff_id', v_row.id,
    'signature_declined', v_row.signature_declined
  ));

  if p_section = 7 and p_role = 'approved' then
    -- The one point that locks the IPAS. The freeze lets this update through:
    -- the row is still open until it is made.
    update public.ipas
       set state = 'filed', filed_at = now()
     where id = v_ipas.id
    returning * into v_ipas;
    v_filed := true;
    v_stage := 'filed';

    perform public._ipas_write_event(v_ipas.id, v_actor, 'filed', jsonb_build_object(
      'computation_status', v_ipas.computation_status,
      'signoff_id', v_row.id
    ));
  elsif p_role = 'prepared' then
    -- Prepared is ready for approval: tell that section's approval list (never
    -- the person who just prepared it).
    v_stage := 'section_prepared';
    v_notify := public._ipas_list_members(array[public._ipas_signoff_list_key(p_section, 'approved')], v_actor);
  elsif p_section in (1, 3) then
    -- This section is approved. When the other is too and section 7 hasn't
    -- started, section 7 is ready for Received.
    v_other := case p_section when 1 then 3 else 1 end;
    if exists (
         select 1 from public.ipas_signoffs s
          where s.ipas_id = v_ipas.id and s.section = v_other and s.role = 'approved' and s.cleared_at is null
       )
       and not exists (
         select 1 from public.ipas_signoffs s
          where s.ipas_id = v_ipas.id and s.section = 7 and s.cleared_at is null
       ) then
      v_stage := 'received_ready';
      v_notify := public._ipas_list_members(array['s7_received'], v_actor);
    end if;
  elsif p_role = 'received' then
    v_stage := 'noted_checked_ready';
    v_notify := public._ipas_list_members(array['s7_noted', 's7_checked'], v_actor);
  elsif p_role in ('noted', 'checked') then
    -- Noted and Checked both given: Approved is ready.
    if exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 7
         and s.role = case p_role when 'noted' then 'checked' else 'noted' end
         and s.cleared_at is null
    ) then
      v_stage := 'approve_ready';
      v_notify := public._ipas_list_members(array['s7_approved'], v_actor);
    end if;
  end if;

  return jsonb_build_object(
    'signoff', to_jsonb(v_row),
    'ipas', to_jsonb(v_ipas),
    'section', p_section,
    'role', p_role,
    'stage', v_stage,
    'filed', v_filed,
    'notify_ids', to_jsonb(v_notify)
  );
end;
$$;

-- ipas_send_back (latest: 20261014120000_ipas_return_undo_lc_status.sql)
create or replace function public.ipas_send_back(
  p_ipas_id uuid,
  p_section integer,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_ipas public.ipas;
  v_roles text[];
  v_preparers uuid[];
  v_notify uuid[];
  v_cascade text[] := '{}'::text[];
  v_cascade_ids uuid[] := '{}'::uuid[];
begin
  if v_actor is null then
    raise exception 'ipas_send_back: not signed in' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_send_back: give a reason, so the people who signed know what to fix' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'ipas_send_back: the reason is 500 characters at most' using errcode = '22023';
  end if;
  if p_section is null or p_section not in (1, 3, 7) then
    raise exception 'ipas_send_back: only sections 1, 3 and 7 can be returned' using errcode = '22023';
  end if;

  -- Refuses a filed or cancelled IPAS (55000): a filed one is reopened, not returned.
  v_ipas := public._ipas_lock_open('ipas_send_back', p_ipas_id);

  if p_section = 7 then
    -- Anyone on a section 7 list, whichever sign-off they give.
    if not public._ipas_can_sign_section(7, v_actor) then
      raise exception 'ipas_send_back: only a signer of section 7 returns it' using errcode = '42501';
    end if;

    -- Section 7 is open once sections 1 and 3 are approved.
    if not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 1 and s.role = 'approved' and s.cleared_at is null
    ) or not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 3 and s.role = 'approved' and s.cleared_at is null
    ) then
      raise exception 'ipas_send_back: section 7 isn''t open yet; sections 1 and 3 must be approved first' using errcode = '22023';
    end if;

    with cleared as (
      update public.ipas_signoffs s
         set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Returned: ' || v_reason
       where s.ipas_id = v_ipas.id
         and s.section = 7
         and s.role in ('received', 'noted', 'checked')
         and s.cleared_at is null
      returning s.role, s.signed_by
    )
    select coalesce(array_agg(role order by role), '{}'::text[]),
           coalesce(array_agg(distinct signed_by) filter (where signed_by is distinct from v_actor), '{}'::uuid[])
      into v_roles, v_notify
      from cleared;

    v_preparers := '{}'::uuid[];
  else
    if not public._ipas_can_sign_section(p_section, v_actor) then
      raise exception 'ipas_send_back: only a signer of section % returns it', p_section using errcode = '42501';
    end if;

    with cleared as (
      update public.ipas_signoffs s
         set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Returned: ' || v_reason
       where s.ipas_id = v_ipas.id
         and s.section = p_section
         and s.role in ('prepared', 'approved')
         and s.cleared_at is null
      returning s.role, s.signed_by
    )
    select coalesce(array_agg(role order by role), '{}'::text[]),
           coalesce(array_agg(distinct signed_by) filter (where role = 'prepared'), '{}'::uuid[])
      into v_roles, v_preparers
      from cleared;

    v_notify := v_preparers;

    -- Section 4 no longer has two approved sections behind it: its open sign-offs go too.
    if cardinality(v_roles) > 0 then
      with cleared as (
        update public.ipas_signoffs s
           set cleared_at = now(), cleared_by = v_actor,
               cleared_reason = 'Section ' || p_section || ' returned: ' || v_reason
         where s.ipas_id = v_ipas.id
           and s.section = 7
           and s.role in ('received', 'noted', 'checked')
           and s.cleared_at is null
        returning s.role, s.signed_by
      )
      select coalesce(array_agg(role order by role), '{}'::text[]),
             coalesce(array_agg(distinct signed_by) filter (where signed_by is distinct from v_actor), '{}'::uuid[])
        into v_cascade, v_cascade_ids
        from cleared;
      v_notify := (select coalesce(array_agg(distinct x), '{}'::uuid[]) from unnest(v_notify || v_cascade_ids) as x);
    end if;
  end if;

  if cardinality(v_roles) = 0 then
    raise exception 'ipas_send_back: section % has nothing to return', p_section using errcode = '22023';
  end if;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'sent_back', jsonb_build_object(
    'section', p_section,
    'reason', v_reason,
    'cleared', to_jsonb(v_roles),
    'cleared_section_7', to_jsonb(v_cascade)
  ));

  return jsonb_build_object(
    'ipas', to_jsonb(v_ipas),
    'section', p_section,
    'actor_id', v_actor,
    'cleared_roles', to_jsonb(v_roles),
    'cleared_section_7', to_jsonb(v_cascade),
    'preparer_ids', to_jsonb(v_preparers),
    'notify_ids', to_jsonb(v_notify)
  );
end;
$$;

-- ipas_freeze_guard (latest: 20261013100800_ipas_filing.sql)
create or replace function public.ipas_freeze_guard()
returns trigger
language plpgsql
as $$
begin
  if old.state is distinct from 'filed' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'ipas: % is filed and frozen; it can''t be deleted', old.number using errcode = '22023';
  end if;

  if coalesce(current_setting('ipas.reopening', true), '') = 'on' then
    return new;
  end if;

  -- "Odoo has changed since filing" moves both ways; updated_at moves with it.
  if (to_jsonb(new) - 'odoo_changed_since_filing' - 'updated_at')
     = (to_jsonb(old) - 'odoo_changed_since_filing' - 'updated_at') then
    return new;
  end if;

  raise exception 'ipas: % is filed and frozen; a Super Admin reopens it first', old.number using errcode = '22023';
end;
$$;

-- ipas_children_freeze_guard (latest: 20261013100800_ipas_filing.sql)
create or replace function public.ipas_children_freeze_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_number text;
begin
  if tg_op = 'INSERT' then
    v_ids := array[new.ipas_id];
  elsif tg_op = 'DELETE' then
    v_ids := array[old.ipas_id];
  else
    v_ids := array[old.ipas_id, new.ipas_id];
  end if;

  select i.number into v_number
    from public.ipas i
   where i.id = any (v_ids) and i.state = 'filed'
   limit 1
     for share;

  if v_number is not null then
    raise exception '%: % is filed and frozen; a Super Admin reopens it first', tg_table_name, v_number
      using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- ipas_reopen (latest: 20261013100800_ipas_filing.sql)
create or replace function public.ipas_reopen(p_ipas_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_row public.ipas;
  v_roles text[];
begin
  if v_actor is null then
    raise exception 'ipas_reopen: not signed in' using errcode = '42501';
  end if;
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'ipas_reopen: only a Super Admin reopens a filed IPAS' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_reopen: give the reason this IPAS is being reopened' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'ipas_reopen: the reason is 500 characters at most' using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_reopen: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if v_row.state <> 'filed' then
    raise exception 'ipas_reopen: % isn''t filed', v_row.number using errcode = '22023';
  end if;

  -- The freeze lets this one update through; the setting lasts for this
  -- transaction and is switched off again straight after.
  perform set_config('ipas.reopening', 'on', true);
  update public.ipas
     set state = 'open', filed_at = null, odoo_changed_since_filing = false
   where id = v_row.id
  returning * into v_row;
  perform set_config('ipas.reopening', 'off', true);

  with cleared as (
    update public.ipas_signoffs s
       set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Reopened: ' || v_reason
     where s.ipas_id = v_row.id
       and s.section = 7
       and s.cleared_at is null
    returning s.role
  )
  select coalesce(array_agg(role order by role), '{}'::text[]) into v_roles from cleared;

  perform public._ipas_write_event(v_row.id, v_actor, 'reopened', jsonb_build_object(
    'reason', v_reason,
    'cleared', to_jsonb(v_roles)
  ));

  return jsonb_build_object(
    'ipas', to_jsonb(v_row),
    'actor_id', v_actor,
    'cleared_roles', to_jsonb(v_roles)
  );
end;
$$;

-- ipas_set_signer_list (latest: 20261015100000_transmittals_tracer.sql)
create or replace function public.ipas_set_signer_list(
  p_list_key text,
  p_employee_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_wanted uuid[];
  v_have uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_missing uuid;
begin
  if v_actor is null then
    raise exception 'ipas_set_signer_list: not signed in' using errcode = '42501';
  end if;
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'ipas_set_signer_list: only a Super Admin changes who is on a sign-off list' using errcode = '42501';
  end if;
  if p_list_key is null or p_list_key not in (
    's1_approved', 's3_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved',
    'transmittal_warehouse', 'transmittal_technical', 'transmittal_logistics', 'transmittal_check_by'
  ) then
    raise exception 'ipas_set_signer_list: % isn''t a sign-off list', coalesce(p_list_key, 'null') using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[])
    into v_wanted
    from unnest(coalesce(p_employee_ids, '{}'::uuid[])) as x
   where x is not null;

  -- One change to a list at a time.
  perform pg_advisory_xact_lock(hashtext('ipas_signer_list:' || p_list_key));

  select coalesce(array_agg(l.employee_id), '{}'::uuid[])
    into v_have
    from public.ipas_signer_lists l
   where l.list_key = p_list_key;

  select x into v_missing
    from unnest(v_wanted) as x
   where x <> all (v_have)
     and not exists (
       select 1 from public.employees e where e.id = x and not coalesce(e.is_deleted, false)
     )
   limit 1;
  if v_missing is not null then
    raise exception 'ipas_set_signer_list: employee % isn''t an active employee', v_missing using errcode = '22023';
  end if;

  select coalesce(array_agg(x), '{}'::uuid[]) into v_added from unnest(v_wanted) as x where x <> all (v_have);
  select coalesce(array_agg(x), '{}'::uuid[]) into v_removed from unnest(v_have) as x where x <> all (v_wanted);

  if cardinality(v_removed) > 0 then
    delete from public.ipas_signer_lists
     where list_key = p_list_key and employee_id = any (v_removed);
  end if;
  if cardinality(v_added) > 0 then
    insert into public.ipas_signer_lists (list_key, employee_id)
    select p_list_key, x from unnest(v_added) as x;
  end if;

  insert into public.ipas_signer_list_log (list_key, employee_id, action, actor_id)
  select p_list_key, x, 'removed', v_actor from unnest(v_removed) as x
  union all
  select p_list_key, x, 'added', v_actor from unnest(v_added) as x;

  return jsonb_build_object(
    'list_key', p_list_key,
    'added', to_jsonb(v_added),
    'removed', to_jsonb(v_removed)
  );
end;
$$;

-- ipas_options_filed_guard (latest: 20261013101200_ipas_options_filed_guard.sql)
create or replace function public.ipas_options_filed_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.label is distinct from old.label
    or new.applies_to is distinct from old.applies_to
    or new.used_for is distinct from old.used_for
  ) and public.ipas_option_on_filed(old.id) then
    raise exception 'ipas_options: "%" is used on a filed IPAS. Deactivate it and add a new one instead.', old.label
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- ipas_undo_approval (latest: 20261014120000_ipas_return_undo_lc_status.sql)
create or replace function public.ipas_undo_approval(
  p_ipas_id uuid,
  p_section integer,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_ipas public.ipas;
  v_approver uuid;
  v_cascade text[] := '{}'::text[];
  v_cascade_ids uuid[] := '{}'::uuid[];
  v_notify uuid[] := '{}'::uuid[];
begin
  if v_actor is null then
    raise exception 'ipas_undo_approval: not signed in' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_undo_approval: give a reason, so the approver knows why' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'ipas_undo_approval: the reason is 500 characters at most' using errcode = '22023';
  end if;
  if p_section is null or p_section not in (1, 3) then
    raise exception 'ipas_undo_approval: only sections 1 and 3 have an approval to undo' using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_undo_approval', p_ipas_id);

  if not public._ipas_can_sign_section(p_section, v_actor) then
    raise exception 'ipas_undo_approval: only a signer of section % undoes its approval', p_section using errcode = '42501';
  end if;

  update public.ipas_signoffs s
     set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Approval undone: ' || v_reason
   where s.ipas_id = v_ipas.id and s.section = p_section and s.role = 'approved' and s.cleared_at is null
  returning s.signed_by into v_approver;

  if not found then
    raise exception 'ipas_undo_approval: section % has no approval to undo', p_section using errcode = '22023';
  end if;

  -- Section 4 stood on both approvals: its open sign-offs go too.
  with cleared as (
    update public.ipas_signoffs s
       set cleared_at = now(), cleared_by = v_actor,
           cleared_reason = 'Section ' || p_section || ' approval undone: ' || v_reason
     where s.ipas_id = v_ipas.id
       and s.section = 7
       and s.role in ('received', 'noted', 'checked')
       and s.cleared_at is null
    returning s.role, s.signed_by
  )
  select coalesce(array_agg(role order by role), '{}'::text[]),
         coalesce(array_agg(distinct signed_by) filter (where signed_by is distinct from v_actor), '{}'::uuid[])
    into v_cascade, v_cascade_ids
    from cleared;

  v_notify := v_cascade_ids;
  if v_approver is not null and v_approver is distinct from v_actor then
    v_notify := v_notify || v_approver;
  end if;
  v_notify := (select coalesce(array_agg(distinct x), '{}'::uuid[]) from unnest(v_notify) as x);

  perform public._ipas_write_event(v_ipas.id, v_actor, 'approval_undone', jsonb_build_object(
    'section', p_section,
    'reason', v_reason,
    'approver_id', v_approver,
    'cleared_section_7', to_jsonb(v_cascade)
  ));

  return jsonb_build_object(
    'ipas', to_jsonb(v_ipas),
    'section', p_section,
    'actor_id', v_actor,
    'approver_id', v_approver,
    'cleared_section_7', to_jsonb(v_cascade),
    'notify_ids', to_jsonb(v_notify)
  );
end;
$$;

-- _transmittal_write_children (latest: 20261017200000_transmittal_check_by_decline.sql)
create or replace function public._transmittal_write_children(p_transmittal_id uuid, p_product_ids uuid[], p_reference_ids uuid[], p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entity text;
  v_number text;
  v_line jsonb;
  v_position integer := 0;
  v_kind text;
  v_ipas public.ipas;
  v_po_line jsonb;
  v_ipas_entity text;
  v_quantity numeric;
  v_opportunity uuid;
  v_sor_count integer;
  v_warnings jsonb := '[]'::jsonb;
  v_products uuid[];
  v_references uuid[];
begin
  select t.entity, t.number into v_entity, v_number from public.transmittals t where t.id = p_transmittal_id;

  v_products := coalesce(p_product_ids, '{}'::uuid[]);
  v_references := coalesce(p_reference_ids, '{}'::uuid[]);

  if cardinality(v_products) > 0 and (
       select count(*) from public.ipas_options o
        where o.id = any (v_products) and o.list = 'transmittal_product' and o.active
     ) <> (select count(distinct x) from unnest(v_products) x) then
    raise exception 'transmittal: a Product isn''t on the list' using errcode = '22023';
  end if;
  if cardinality(v_references) > 0 and (
       select count(*) from public.ipas_options o
        where o.id = any (v_references) and o.list = 'transmittal_reference' and o.active
     ) <> (select count(distinct x) from unnest(v_references) x) then
    raise exception 'transmittal: a Reference Checklist item isn''t on the list' using errcode = '22023';
  end if;

  delete from public.transmittal_lines where transmittal_id = p_transmittal_id;
  delete from public.transmittal_products where transmittal_id = p_transmittal_id;
  delete from public.transmittal_references where transmittal_id = p_transmittal_id;

  insert into public.transmittal_products (transmittal_id, option_id)
  select p_transmittal_id, x from unnest(v_products) as x;

  insert into public.transmittal_references (transmittal_id, option_id)
  select p_transmittal_id, x from unnest(v_references) as x;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as value loop
    v_position := v_position + 1;
    v_kind := nullif(btrim(v_line->>'kind'), '');
    v_quantity := nullif(v_line->>'quantity', '')::numeric;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'transmittal: line % needs a quantity above zero', v_position using errcode = '22023';
    end if;

    if v_kind = 'po_line' then
      select * into v_ipas
        from public.ipas i
       where i.id = nullif(v_line->>'ipas_id', '')::uuid;
      if not found or v_ipas.state = 'cancelled' then
        raise exception 'transmittal: line % names an IPAS that isn''t live', v_position using errcode = '22023';
      end if;

      select l into v_po_line
        from jsonb_array_elements(coalesce(v_ipas.odoo_copy -> 'lines', '[]'::jsonb)) as l
       where (l->>'line_id')::integer = (v_line->>'odoo_po_line_id')::integer
       limit 1;
      if v_po_line is null then
        raise exception 'transmittal: line % isn''t on % Odoo copy', v_position, v_ipas.po_number
          using errcode = '22023';
      end if;

      v_ipas_entity := coalesce(
        nullif(btrim(v_ipas.entity_override), ''),
        nullif(btrim(v_ipas.odoo_copy #>> '{po,company}'), '')
      );
      if v_ipas_entity is not null
         and lower(regexp_replace(btrim(v_ipas_entity), '\s+', ' ', 'g'))
             is distinct from lower(regexp_replace(btrim(coalesce(v_entity, '')), '\s+', ' ', 'g')) then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'kind', 'entity', 'position', v_position, 'po_number', v_ipas.po_number, 'entity', v_ipas_entity
        ));
      end if;

      v_opportunity := nullif(v_line->>'opportunity_id', '')::uuid;
      if v_opportunity is null then
        select count(*) into v_sor_count from public.ipas_sors s where s.ipas_id = v_ipas.id;
        if v_sor_count = 1 then
          select s.opportunity_id into v_opportunity from public.ipas_sors s where s.ipas_id = v_ipas.id;
        end if;
      end if;
      if v_opportunity is not null and not exists (
           select 1 from public.sales_opportunities o
            where o.id = v_opportunity and not coalesce(o.is_deleted, false)
         ) then
        raise exception 'transmittal: line % names an SOR that no longer exists', v_position using errcode = '22023';
      end if;

      insert into public.transmittal_lines (
        transmittal_id, position, kind, ipas_id, odoo_po_line_id, description, quantity, unit,
        opportunity_id, serial_numbers, box_quantity
      ) values (
        p_transmittal_id, v_position, 'po_line', v_ipas.id, (v_po_line->>'line_id')::integer,
        coalesce(nullif(btrim(v_po_line->>'name'), ''), 'PO line ' || (v_po_line->>'line_id')),
        v_quantity,
        nullif(btrim(v_po_line->>'unit'), ''),
        v_opportunity,
        nullif(btrim(v_line->>'serial_numbers'), ''),
        nullif(btrim(v_line->>'box_quantity'), '')
      );

    elsif v_kind = 'typed' then
      if nullif(btrim(v_line->>'description'), '') is null then
        raise exception 'transmittal: line % needs a description', v_position using errcode = '22023';
      end if;
      if nullif(btrim(v_line->>'unit'), '') is null then
        raise exception 'transmittal: line % needs a unit', v_position using errcode = '22023';
      end if;
      v_opportunity := nullif(v_line->>'opportunity_id', '')::uuid;
      if v_opportunity is not null and not exists (
           select 1 from public.sales_opportunities o
            where o.id = v_opportunity and not coalesce(o.is_deleted, false)
         ) then
        raise exception 'transmittal: line % names an SOR that no longer exists', v_position using errcode = '22023';
      end if;

      insert into public.transmittal_lines (
        transmittal_id, position, kind, description, quantity, unit,
        opportunity_id, serial_numbers, box_quantity
      ) values (
        p_transmittal_id, v_position, 'typed', btrim(v_line->>'description'), v_quantity,
        btrim(v_line->>'unit'), v_opportunity,
        nullif(btrim(v_line->>'serial_numbers'), ''),
        nullif(btrim(v_line->>'box_quantity'), '')
      );

    else
      raise exception 'transmittal: line % has no kind (po_line or typed)', v_position using errcode = '22023';
    end if;
  end loop;

  return v_warnings;
end;
$function$
;

-- transmittal_update_draft (latest: 20261015100000_transmittals_tracer.sql)
create or replace function public.transmittal_update_draft(
  p_transmittal_id uuid,
  p_fields jsonb,
  p_product_ids uuid[],
  p_reference_ids uuid[],
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_header jsonb;
  v_warnings jsonb;
begin
  if v_actor is null then
    raise exception 'transmittal_update_draft: not signed in' using errcode = '42501';
  end if;
  if not public.transmittal_can_prepare() then
    raise exception 'transmittal_update_draft: only a Transmittal preparer changes a slip' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_update_draft: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if not (v_row.prepared_by = v_actor or coalesce(public.has_purchasing_access(), false)) then
    raise exception 'transmittal_update_draft: only the preparer or Purchasing changes a slip' using errcode = '42501';
  end if;
  if v_row.state <> 'draft' then
    raise exception 'transmittal_update_draft: % is %; only a draft changes', v_row.number, v_row.state
      using errcode = '42501';
  end if;

  v_header := public._transmittal_clean_header(coalesce(p_fields, '{}'::jsonb));

  update public.transmittals set
    origin = v_header->>'origin',
    origin_other = v_header->>'origin_other',
    check_warehouse = (v_header->>'check_warehouse')::boolean,
    check_technical = (v_header->>'check_technical')::boolean,
    check_other = v_header->>'check_other',
    priority = v_header->>'priority',
    entity = v_header->>'entity',
    product_other = v_header->>'product_other',
    item_location_id = nullif(v_header->>'item_location_id', '')::uuid
   where id = p_transmittal_id;

  v_warnings := public._transmittal_write_children(p_transmittal_id, p_product_ids, p_reference_ids, p_lines);

  perform public._transmittal_event(p_transmittal_id, v_actor, 'draft_updated', jsonb_build_object(
    'number', v_row.number,
    'lines', coalesce(jsonb_array_length(coalesce(p_lines, '[]'::jsonb)), 0)
  ));

  return jsonb_build_object('id', p_transmittal_id, 'number', v_row.number, 'warnings', v_warnings);
end;
$$;

-- transmittal_submit (latest: 20261015100000_transmittals_tracer.sql)
create or replace function public.transmittal_submit(p_transmittal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_first text;
  v_notify text;
begin
  if v_actor is null then
    raise exception 'transmittal_submit: not signed in' using errcode = '42501';
  end if;
  if not public.transmittal_can_prepare() then
    raise exception 'transmittal_submit: only a Transmittal preparer submits a slip' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_submit: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if not (v_row.prepared_by = v_actor or coalesce(public.has_purchasing_access(), false)) then
    raise exception 'transmittal_submit: only the preparer or Purchasing submits a slip' using errcode = '42501';
  end if;
  if v_row.state <> 'draft' then
    raise exception 'transmittal_submit: % is already %', v_row.number, v_row.state using errcode = '22023';
  end if;
  if not exists (select 1 from public.transmittal_lines l where l.transmittal_id = p_transmittal_id) then
    raise exception 'transmittal_submit: % needs at least one line', v_row.number using errcode = '22023';
  end if;

  v_first := case when v_row.check_warehouse then 'warehouse_checking' else 'technical_inspection' end;
  v_notify := case when v_row.check_warehouse then 'transmittal_warehouse' else 'transmittal_technical' end;

  if v_row.check_warehouse then
    insert into public.transmittal_stages (transmittal_id, stage) values (p_transmittal_id, 'warehouse_checking');
  end if;
  if v_row.check_warehouse and v_row.check_technical then
    insert into public.transmittal_stages (transmittal_id, stage) values (p_transmittal_id, 'warehouse_releasing');
  end if;
  if v_row.check_technical then
    insert into public.transmittal_stages (transmittal_id, stage) values (p_transmittal_id, 'technical_inspection');
  end if;

  update public.transmittals
     set state = v_first, submitted_at = now()
   where id = p_transmittal_id;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'submitted', jsonb_build_object(
    'number', v_row.number,
    'first_stage', v_first
  ));

  -- The list's members are read here, not by the caller: the staff lists are
  -- not readable to a preparer under row level security.
  return jsonb_build_object(
    'id', p_transmittal_id,
    'number', v_row.number,
    'state', v_first,
    'notify_list', v_notify,
    'notify_ids', coalesce((
      select jsonb_agg(l.employee_id)
        from public.ipas_signer_lists l
        join public.employees e on e.id = l.employee_id
       where l.list_key = v_notify
         and not coalesce(e.is_deleted, false)
    ), '[]'::jsonb)
  );
end;
$$;

-- transmittal_cancel (latest: 20261015100000_transmittals_tracer.sql)
create or replace function public.transmittal_cancel(p_transmittal_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null then
    raise exception 'transmittal_cancel: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_cancel: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if not (v_row.prepared_by = v_actor or coalesce(public.has_purchasing_access(), false)) then
    raise exception 'transmittal_cancel: only the preparer or Purchasing cancels a slip' using errcode = '42501';
  end if;
  if v_row.state in ('closed', 'cancelled') then
    raise exception 'transmittal_cancel: % is already %', v_row.number, v_row.state using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'transmittal_cancel: a cancel needs a reason' using errcode = '22023';
  end if;
  if exists (
       select 1 from public.transmittal_stages s
        where s.transmittal_id = p_transmittal_id and s.completed_at is not null
     ) then
    raise exception 'transmittal_cancel: % has a signed stage and can''t be cancelled', v_row.number
      using errcode = '42501';
  end if;

  update public.transmittals
     set state = 'cancelled',
         cancelled_by = v_actor,
         cancelled_at = now(),
         cancel_reason = v_reason
   where id = p_transmittal_id;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'cancelled', jsonb_build_object(
    'number', v_row.number,
    'reason', v_reason,
    'from_state', v_row.state
  ));

  -- The preparer hears of a cancel by someone else; nobody hears their own.
  return jsonb_build_object(
    'id', p_transmittal_id,
    'number', v_row.number,
    'notify_id', case when v_row.prepared_by = v_actor then null else v_row.prepared_by end
  );
end;
$$;

-- transmittal_rate (latest: 20261016100000_transmittal_review_fixes.sql)
create or replace function public.transmittal_rate(p_transmittal_id uuid, p_line_ratings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_stage public.transmittal_stages;
  v_item jsonb;
  v_line public.transmittal_lines;
  v_rating text;
  v_remark text;
  v_in_charge uuid;
  v_received numeric;
  v_count int := 0;
  v_tech boolean;
begin
  if v_actor is null then
    raise exception 'transmittal_rate: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_rate: that Transmittal doesn''t exist' using errcode = '22023';
  end if;

  -- Technical inspection is rated by the Technical list; Warehouse checking by the Warehouse list.
  v_tech := v_row.state = 'technical_inspection';
  if v_tech then
    if not public.transmittal_on_list('transmittal_technical') then
      raise exception 'transmittal_rate: only the Technical list rates the lines' using errcode = '42501';
    end if;
  elsif not public.transmittal_on_list('transmittal_warehouse') then
    raise exception 'transmittal_rate: only the Warehouse list rates the lines' using errcode = '42501';
  end if;
  if jsonb_typeof(p_line_ratings) is distinct from 'array' then
    raise exception 'transmittal_rate: the ratings are a list' using errcode = '22023';
  end if;

  select * into v_stage from public.transmittal_stages s
   where s.transmittal_id = p_transmittal_id
     and s.stage = case when v_tech then 'technical_inspection' else 'warehouse_checking' end;
  if not found or v_stage.completed_at is not null
     or v_row.state not in ('warehouse_checking', 'technical_inspection') then
    raise exception 'transmittal_rate: % is not open on %', case when v_tech then 'Technical inspection' else 'Warehouse checking' end,
      v_row.number using errcode = '42501';
  end if;
  if not v_tech and v_row.state <> 'warehouse_checking' then
    raise exception 'transmittal_rate: Warehouse checking is not open on %', v_row.number using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(p_line_ratings) loop
    select * into v_line from public.transmittal_lines l
     where l.id = nullif(v_item->>'line_id', '')::uuid and l.transmittal_id = p_transmittal_id;
    if not found then
      raise exception 'transmittal_rate: that line isn''t on %', v_row.number using errcode = '22023';
    end if;

    v_rating := lower(coalesce(v_item->>'rating', ''));
    if v_rating not in ('gc', 'na') then
      raise exception 'transmittal_rate: each line is GC or NA' using errcode = '22023';
    end if;

    v_remark := nullif(btrim(coalesce(v_item->>'remark', '')), '');
    if v_rating = 'na' and v_remark is null then
      raise exception 'transmittal_rate: an NA needs a remark' using errcode = '22023';
    end if;

    v_in_charge := coalesce(nullif(v_item->>'in_charge_id', '')::uuid, v_actor);
    if not exists (
      select 1 from public.ipas_signer_lists l
       where l.list_key = case when v_tech then 'transmittal_technical' else 'transmittal_warehouse' end
         and l.employee_id = v_in_charge
    ) then
      raise exception 'transmittal_rate: the in-charge is on the % list',
        case when v_tech then 'Technical' else 'Warehouse' end using errcode = '22023';
    end if;

    -- One quantity received per line: the Warehouse's, or Technical's on a
    -- slip with no Warehouse checking.
    v_received := nullif(v_item->>'quantity_received', '')::numeric;
    if v_received is not null and v_received < 0 then
      raise exception 'transmittal_rate: a quantity received is zero or more' using errcode = '22023';
    end if;
    if v_received = v_line.quantity then
      v_received := null;
    end if;

    if v_tech then
      update public.transmittal_lines
         set tech_in_charge_id = v_in_charge,
             tech_rating = v_rating,
             tech_remark = v_remark,
             quantity_received = case when v_row.check_warehouse then quantity_received else v_received end
       where id = v_line.id;
    else
      update public.transmittal_lines
         set wh_in_charge_id = v_in_charge,
             wh_rating = v_rating,
             wh_remark = v_remark,
             quantity_received = v_received
       where id = v_line.id;
    end if;
    v_count := v_count + 1;
  end loop;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'rated', jsonb_build_object(
    'number', v_row.number,
    'lines', v_count,
    'stage', case when v_tech then 'technical_inspection' else 'warehouse_checking' end
  ));

  return jsonb_build_object('id', p_transmittal_id, 'number', v_row.number, 'rated', v_count);
end;
$function$
;

-- transmittal_confirm_signature (latest: 20261016100000_transmittal_review_fixes.sql)
create or replace function public.transmittal_confirm_signature(p_stage_id uuid, p_confirm boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_stage public.transmittal_stages;
  v_number text;
  v_first boolean;
begin
  if v_actor is null then
    raise exception 'transmittal_confirm_signature: not signed in' using errcode = '42501';
  end if;

  select * into v_stage from public.transmittal_stages s where s.id = p_stage_id for update;
  if not found then
    raise exception 'transmittal_confirm_signature: that stage doesn''t exist' using errcode = '22023';
  end if;
  if v_stage.completed_at is null then
    raise exception 'transmittal_confirm_signature: the stage isn''t signed yet' using errcode = '22023';
  end if;
  -- The co-signer is whichever slot the completer didn't sign: the second,
  -- or the first when the completer signed as the second.
  -- When one person holds both slots, the co-signer's is the one still open.
  if v_stage.first_signer_id = v_actor and v_stage.second_signer_id = v_actor then
    if not v_stage.first_confirmed or v_stage.first_signature_declined then
      v_first := true;
    elsif not v_stage.second_confirmed or v_stage.second_signature_declined then
      v_first := false;
    else
      raise exception 'transmittal_confirm_signature: both signatures are already confirmed' using errcode = '22023';
    end if;
  elsif v_stage.second_signer_id = v_actor and v_actor is distinct from v_stage.completed_by then
    v_first := false;
  elsif v_stage.first_signer_id = v_actor and v_actor is distinct from v_stage.completed_by then
    v_first := true;
  else
    raise exception 'transmittal_confirm_signature: only the co-signer confirms this signature' using errcode = '42501';
  end if;

  if v_first then
    update public.transmittal_stages
       set first_confirmed = coalesce(p_confirm, false), first_signature_declined = not coalesce(p_confirm, false)
     where id = p_stage_id;
  else
    update public.transmittal_stages
       set second_confirmed = coalesce(p_confirm, false), second_signature_declined = not coalesce(p_confirm, false)
     where id = p_stage_id;
  end if;

  select number into v_number from public.transmittals where id = v_stage.transmittal_id;
  perform public._transmittal_event(v_stage.transmittal_id, v_actor,
    case when coalesce(p_confirm, false) then 'signature_confirmed' else 'signature_declined' end,
    jsonb_build_object('number', v_number, 'stage', v_stage.stage));

  return jsonb_build_object(
    'id', v_stage.transmittal_id,
    'stage_id', p_stage_id,
    'confirmed', coalesce(p_confirm, false),
    'notify_id', case when coalesce(p_confirm, false) then null else v_stage.completed_by end
  );
end;
$function$
;

-- transmittal_received_in_odoo (latest: 20261015110000_transmittals_warehouse_checking.sql)
create or replace function public.transmittal_received_in_odoo(p_transmittal_id uuid, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
  v_at timestamptz := now();
begin
  if v_actor is null then
    raise exception 'transmittal_received_in_odoo: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_received_in_odoo: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if not (public.transmittal_on_list('transmittal_warehouse') or coalesce(public.has_purchasing_access(), false)) then
    raise exception 'transmittal_received_in_odoo: only the Warehouse list or Purchasing records the Odoo receipt'
      using errcode = '42501';
  end if;
  if v_row.state not in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection', 'awaiting_check') then
    raise exception 'transmittal_received_in_odoo: % is %; the Odoo receipt is recorded from submission until close',
      v_row.number, v_row.state using errcode = '22023';
  end if;
  if v_row.odoo_received_at is not null then
    raise exception 'transmittal_received_in_odoo: % already has its Odoo receipt', v_row.number using errcode = '22023';
  end if;

  update public.transmittals
     set odoo_received_by = v_actor, odoo_received_at = v_at, odoo_receipt_ref = v_ref
   where id = p_transmittal_id;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'received_in_odoo', jsonb_build_object(
    'number', v_row.number,
    'receipt_ref', v_ref
  ));

  return jsonb_build_object('id', p_transmittal_id, 'number', v_row.number, 'received_at', v_at, 'receipt_ref', v_ref);
end;
$$;

-- transmittal_attach_evidence (latest: 20261015110000_transmittals_warehouse_checking.sql)
create or replace function public.transmittal_attach_evidence(
  p_stage_id uuid,
  p_kind text,
  p_path text,
  p_file_name text,
  p_mime text,
  p_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_stage public.transmittal_stages;
  v_row public.transmittals;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'transmittal_attach_evidence: not signed in' using errcode = '42501';
  end if;

  select * into v_stage from public.transmittal_stages s where s.id = p_stage_id;
  if not found then
    raise exception 'transmittal_attach_evidence: that stage doesn''t exist' using errcode = '22023';
  end if;
  select * into v_row from public.transmittals t where t.id = v_stage.transmittal_id;

  if v_stage.completed_at is not null or v_row.state in ('closed', 'cancelled') then
    raise exception 'transmittal_attach_evidence: the stage of % is signed; its files can''t change', v_row.number
      using errcode = '42501';
  end if;
  if not public.transmittal_on_list(
       case when v_stage.stage = 'technical_inspection' then 'transmittal_technical' else 'transmittal_warehouse' end
     ) then
    raise exception 'transmittal_attach_evidence: only the stage''s list adds files' using errcode = '42501';
  end if;
  if p_kind not in ('picture', 'video') then
    raise exception 'transmittal_attach_evidence: a file is a picture or a video' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > 52428800 then
    raise exception 'transmittal_attach_evidence: a file is 50 MB or less' using errcode = '22023';
  end if;
  if p_path is null
     or public._pms_evidence_transmittal_id(p_path) is distinct from v_row.id
     or (storage.foldername(p_path))[2] is distinct from p_stage_id::text then
    raise exception 'transmittal_attach_evidence: that file isn''t stored for this stage' using errcode = '22023';
  end if;

  insert into public.pms_evidence (
    record_type, record_id, transmittal_id, kind, storage_path, file_name, mime_type, size_bytes, uploaded_by
  ) values (
    'transmittal_stage', p_stage_id, v_row.id, p_kind, p_path,
    coalesce(nullif(btrim(p_file_name), ''), 'file'), p_mime, p_size, v_actor
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'transmittal_id', v_row.id, 'stage_id', p_stage_id);
end;
$$;

-- transmittal_remove_evidence (latest: 20261015110000_transmittals_warehouse_checking.sql)
create or replace function public.transmittal_remove_evidence(p_evidence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_ev public.pms_evidence;
begin
  if v_actor is null then
    raise exception 'transmittal_remove_evidence: not signed in' using errcode = '42501';
  end if;

  select * into v_ev from public.pms_evidence e where e.id = p_evidence_id for update;
  if not found then
    raise exception 'transmittal_remove_evidence: that file doesn''t exist' using errcode = '22023';
  end if;
  if v_ev.uploaded_by is distinct from v_actor then
    raise exception 'transmittal_remove_evidence: only the uploader removes a file' using errcode = '42501';
  end if;

  delete from public.pms_evidence where id = p_evidence_id;

  perform public._transmittal_event(v_ev.transmittal_id, v_actor, 'evidence_removed', jsonb_build_object(
    'file_name', v_ev.file_name,
    'stage_id', v_ev.record_id
  ));

  return jsonb_build_object('id', p_evidence_id, 'storage_path', v_ev.storage_path);
end;
$$;

-- transmittal_check (latest: 20261017200000_transmittal_check_by_decline.sql)
create or replace function public.transmittal_check(p_transmittal_id uuid, p_slot integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_open_stages int;
  v_po_lines int;
  v_closed boolean := false;
begin
  if v_actor is null then
    raise exception 'transmittal_check: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_check: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if not public.transmittal_on_list('transmittal_check_by') then
    raise exception 'transmittal_check: only the Check by list signs a Transmittal' using errcode = '42501';
  end if;
  if p_slot is null or p_slot not in (1, 2) then
    raise exception 'transmittal_check: the slot is 1 or 2' using errcode = '22023';
  end if;
  if v_row.state <> 'awaiting_check' then
    raise exception 'transmittal_check: % is %, not awaiting Check by', v_row.number, v_row.state using errcode = '42501';
  end if;
  if v_row.prepared_by = v_actor then
    raise exception 'transmittal_check: the preparer can''t check their own slip' using errcode = '42501';
  end if;

  if p_slot = 1 and v_row.check_by_first_id is not null
     or p_slot = 2 and v_row.check_by_second_id is not null then
    raise exception 'transmittal_check: that Check by slot is signed already' using errcode = '22023';
  end if;
  if (v_row.check_by_first_id = v_actor and p_slot = 2)
     or (v_row.check_by_second_id = v_actor and p_slot = 1) then
    raise exception 'transmittal_check: the same person can''t sign both Check by slots' using errcode = '42501';
  end if;

  select count(*) into v_open_stages from public.transmittal_stages s
   where s.transmittal_id = p_transmittal_id and s.completed_at is null;
  if v_open_stages > 0 then
    raise exception 'transmittal_check: % has a stage still open', v_row.number using errcode = '22023';
  end if;

  select count(*) into v_po_lines from public.transmittal_lines l
   where l.transmittal_id = p_transmittal_id and l.kind = 'po_line';
  if v_po_lines > 0 and v_row.odoo_received_at is null then
    raise exception 'transmittal_check: % is a PO slip; record Received in Odoo first', v_row.number using errcode = '22023';
  end if;

  if p_slot = 1 then
    update public.transmittals
       set check_by_first_id = v_actor, check_by_first_at = now(), check_by_first_signature_declined = false
     where id = p_transmittal_id;
  else
    update public.transmittals
       set check_by_second_id = v_actor, check_by_second_at = now(), check_by_second_signature_declined = false
     where id = p_transmittal_id;
  end if;

  -- The second signature closes the slip.
  if (p_slot = 1 and v_row.check_by_second_id is not null)
     or (p_slot = 2 and v_row.check_by_first_id is not null) then
    v_closed := true;
    update public.transmittals
       set state = 'closed', closed_at = now()
     where id = p_transmittal_id;
  end if;

  perform public._transmittal_event(p_transmittal_id, v_actor,
    case when v_closed then 'closed' else 'check_signed' end,
    jsonb_build_object('number', v_row.number, 'slot', p_slot));

  return jsonb_build_object(
    'id', p_transmittal_id,
    'number', v_row.number,
    'slot', p_slot,
    'state', case when v_closed then 'closed' else 'awaiting_check' end,
    'closed', v_closed,
    'notify_id', case when v_closed then v_row.prepared_by else null end
  );
end;
$function$
;

-- ipas_actual_checking_hand_guard (latest: 20261015130000_ipas_transmittal_reads.sql)
create or replace function public.ipas_actual_checking_hand_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.actual_checking_by is not null
     and (new.actual_checking_by is distinct from old.actual_checking_by
          or new.actual_checking_at is distinct from old.actual_checking_at)
     and exists (
       select 1
         from public.transmittal_lines l
         join public.transmittals t on t.id = l.transmittal_id
        where l.ipas_id = new.id
          and t.state not in ('draft', 'cancelled')
     ) then
    raise exception 'Actual Checking is stamped by the Transmittals once one is submitted for this IPAS'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- transmittal_complete_stage (latest: 20261016100000_transmittal_review_fixes.sql)
create or replace function public.transmittal_complete_stage(p_transmittal_id uuid, p_stage text, p_other_signer_id uuid, p_other_signer_name text, p_remarks text, p_no_pictures_reason text, p_sign_as_second boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_stage public.transmittal_stages;
  v_other_name text;
  v_reason text := nullif(btrim(coalesce(p_no_pictures_reason, '')), '');
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  v_unrated int;
  v_na int := 0;
  v_pictures int;
  v_next_state text;
  v_next_list text := null;
  v_next_ids jsonb := '[]'::jsonb;
  v_na_ids uuid[] := '{}';
  v_tech boolean := p_stage = 'technical_inspection';
  v_as_second boolean := coalesce(p_sign_as_second, false);
  v_actor_name text;
begin
  if v_actor is null then
    raise exception 'transmittal_complete_stage: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_complete_stage: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if v_row.state in ('closed', 'cancelled') then
    raise exception 'transmittal_complete_stage: % is %', v_row.number, v_row.state using errcode = '42501';
  end if;
  if p_stage not in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection') then
    raise exception 'transmittal_complete_stage: the stage is Warehouse checking, releasing or Technical inspection'
      using errcode = '22023';
  end if;
  if v_tech then
    if not public.transmittal_on_list('transmittal_technical') then
      raise exception 'transmittal_complete_stage: only the Technical list signs Technical inspection' using errcode = '42501';
    end if;
  elsif not public.transmittal_on_list('transmittal_warehouse') then
    raise exception 'transmittal_complete_stage: only the Warehouse list signs the Warehouse stages' using errcode = '42501';
  end if;

  select * into v_stage from public.transmittal_stages s
   where s.transmittal_id = p_transmittal_id and s.stage = p_stage
   for update;
  if not found then
    if p_stage = 'warehouse_releasing' and not v_row.check_technical then
      insert into public.transmittal_stages (transmittal_id, stage)
      values (p_transmittal_id, p_stage)
      returning * into v_stage;
    else
      raise exception 'transmittal_complete_stage: % has no % stage', v_row.number, p_stage using errcode = '22023';
    end if;
  end if;

  if v_stage.completed_at is not null then
    raise exception 'transmittal_complete_stage: the % stage of % is already signed', p_stage, v_row.number
      using errcode = '42501';
  end if;
  if p_stage = 'warehouse_checking' and v_row.state <> 'warehouse_checking' then
    raise exception 'transmittal_complete_stage: Warehouse checking is not open on %', v_row.number using errcode = '42501';
  end if;
  if p_stage = 'warehouse_releasing' and v_row.check_technical and v_row.state <> 'warehouse_releasing' then
    raise exception 'transmittal_complete_stage: releasing is not open on %', v_row.number using errcode = '42501';
  end if;
  if v_tech and v_row.state <> 'technical_inspection' then
    raise exception 'transmittal_complete_stage: Technical inspection is not open on %', v_row.number using errcode = '42501';
  end if;

  -- Releasing's caller is Released by: Received by is the receiving side.
  if v_as_second and p_stage = 'warehouse_releasing' then
    raise exception 'transmittal_complete_stage: the Warehouse signs releasing as Released by' using errcode = '22023';
  end if;

  -- The other signatory.
  if p_stage = 'warehouse_checking' then
    if p_other_signer_id is null or not exists (
         select 1 from public.ipas_signer_lists l
          where l.list_key = 'transmittal_warehouse' and l.employee_id = p_other_signer_id
       ) then
      raise exception 'transmittal_complete_stage: name the other signatory from the Warehouse list' using errcode = '22023';
    end if;
  elsif v_tech or v_row.check_technical then
    if p_other_signer_id is null or not exists (
         select 1 from public.ipas_signer_lists l
          where l.list_key = 'transmittal_technical' and l.employee_id = p_other_signer_id
       ) then
      raise exception 'transmittal_complete_stage: the other signatory is on the Technical list' using errcode = '22023';
    end if;
  end if;

  if p_other_signer_id is not null then
    select e.name into v_other_name from public.employees e where e.id = p_other_signer_id;
    if not found then
      raise exception 'transmittal_complete_stage: that signatory doesn''t exist' using errcode = '22023';
    end if;
  else
    v_other_name := nullif(btrim(coalesce(p_other_signer_name, '')), '');
  end if;
  if v_other_name is null then
    raise exception 'transmittal_complete_stage: name who signs with you' using errcode = '22023';
  end if;

  select e.name into v_actor_name from public.employees e where e.id = v_actor;

  select count(*) into v_pictures from public.pms_evidence e
   where e.record_type = 'transmittal_stage' and e.record_id = v_stage.id;

  if p_stage = 'warehouse_checking' then
    select count(*) into v_unrated from public.transmittal_lines l
     where l.transmittal_id = p_transmittal_id and (l.wh_rating is null or l.wh_in_charge_id is null);
    if v_unrated > 0 then
      raise exception 'transmittal_complete_stage: % line(s) of % still need a GC or NA rating',
        v_unrated, v_row.number using errcode = '22023';
    end if;
  elsif v_tech then
    select count(*) into v_unrated from public.transmittal_lines l
     where l.transmittal_id = p_transmittal_id and (l.tech_rating is null or l.tech_in_charge_id is null);
    if v_unrated > 0 then
      raise exception 'transmittal_complete_stage: % line(s) of % still need a GC or NA rating from Technical',
        v_unrated, v_row.number using errcode = '22023';
    end if;
  end if;

  -- Every stage: "Provided Pictures & Videos" is No only with a reason (spec #251).
  if v_pictures = 0 and v_reason is null then
    raise exception 'transmittal_complete_stage: attach a picture or video, or give the reason none' using errcode = '22023';
  end if;

  if p_stage = 'warehouse_checking' then
    select count(*) into v_na from public.transmittal_lines l
     where l.transmittal_id = p_transmittal_id and l.wh_rating = 'na';
  elsif v_tech then
    select count(*) into v_na from public.transmittal_lines l
     where l.transmittal_id = p_transmittal_id and l.tech_rating = 'na';
  end if;

  update public.transmittal_stages
     set remarks = v_remarks,
         no_pictures_reason = case when v_pictures > 0 then null else v_reason end,
         completed_by = v_actor,
         completed_at = now(),
         first_signer_id = case when v_as_second then p_other_signer_id else v_actor end,
         first_signed_at = now(),
         first_confirmed = not v_as_second,
         second_signer_id = case when v_as_second then v_actor else p_other_signer_id end,
         second_signer_name = case when v_as_second then v_actor_name else v_other_name end,
         second_signed_at = now(),
         second_confirmed = v_as_second
   where id = v_stage.id;

  -- Advance the slip.
  if p_stage = 'warehouse_checking' then
    if v_row.check_technical then
      v_next_state := 'warehouse_releasing';
      v_next_list := 'transmittal_warehouse';
    else
      v_next_state := 'awaiting_check';
      v_next_list := 'transmittal_check_by';
    end if;
  elsif v_tech then
    v_next_state := 'awaiting_check';
    v_next_list := 'transmittal_check_by';
  elsif v_row.check_technical then
    v_next_state := 'technical_inspection';
    v_next_list := 'transmittal_technical';
  else
    v_next_state := v_row.state;
  end if;

  if v_next_state is distinct from v_row.state then
    update public.transmittals set state = v_next_state where id = p_transmittal_id;
  end if;

  if v_next_list is not null then
    v_next_ids := public._transmittal_list_ids(v_next_list);
  end if;

  if v_na > 0 then
    v_na_ids := array(
      select distinct u from unnest(
        array_cat(
          array[v_row.prepared_by],
          array(
            select l.employee_id from public.ipas_signer_lists l
              join public.employees e on e.id = l.employee_id
             where l.list_key = 'transmittal_check_by' and not coalesce(e.is_deleted, false)
          )
        )
      ) as u
    );
  end if;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'stage_signed', jsonb_build_object(
    'number', v_row.number,
    'stage', p_stage,
    'state_to', v_next_state,
    'na_count', v_na,
    'other_signer', v_other_name
  ));

  return jsonb_build_object(
    'id', p_transmittal_id,
    'number', v_row.number,
    'stage', p_stage,
    'state', v_next_state,
    'na_count', v_na,
    'notify_next_list', v_next_list,
    'notify_next_ids', v_next_ids,
    'notify_confirm_id', p_other_signer_id,
    'notify_na_ids', case when v_na > 0 then to_jsonb(v_na_ids) else '[]'::jsonb end
  );
end;
$function$
;

-- transmittal_undo_signature (latest: 20261017100000_transmittal_undo_signature.sql)
create or replace function public.transmittal_undo_signature(
  p_transmittal_id uuid,
  p_kind text,
  p_reason text,
  p_stage text default null,
  p_slot int default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_stage public.transmittal_stages;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_order int;
  v_state text;
  v_notify uuid[] := '{}';
  v_signer uuid;
  v_signer_name text;
  v_signed_at timestamptz;
  v_other uuid;
  v_other_name text;
  v_ref text;
begin
  if v_actor is null then
    raise exception 'transmittal_undo_signature: not signed in' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'transmittal_undo_signature: give the reason for undoing the signature' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('stage', 'odoo', 'check_by') then
    raise exception 'transmittal_undo_signature: undo a stage, Received in Odoo or a Check by' using errcode = '22023';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_undo_signature: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if v_row.state in ('draft', 'cancelled') then
    raise exception 'transmittal_undo_signature: % is %; nothing is signed', v_row.number, v_row.state
      using errcode = '42501';
  end if;

  if p_kind = 'stage' then
    if p_stage is null or p_stage not in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection') then
      raise exception 'transmittal_undo_signature: name the stage' using errcode = '22023';
    end if;
    -- Whoever may sign the stage may undo it.
    if p_stage = 'technical_inspection' then
      if not public.transmittal_on_list('transmittal_technical') then
        raise exception 'transmittal_undo_signature: only the Technical list undoes Technical inspection'
          using errcode = '42501';
      end if;
    elsif not public.transmittal_on_list('transmittal_warehouse') then
      raise exception 'transmittal_undo_signature: only the Warehouse list undoes a Warehouse stage'
        using errcode = '42501';
    end if;
    if v_row.state = 'closed' or v_row.check_by_first_id is not null or v_row.check_by_second_id is not null then
      raise exception 'transmittal_undo_signature: % has a Check by signed; undo that first', v_row.number
        using errcode = '42501';
    end if;

    select * into v_stage from public.transmittal_stages s
     where s.transmittal_id = p_transmittal_id and s.stage = p_stage
     for update;
    if not found or v_stage.completed_at is null then
      raise exception 'transmittal_undo_signature: the % stage of % isn''t signed', p_stage, v_row.number
        using errcode = '22023';
    end if;

    v_order := case p_stage when 'warehouse_checking' then 1 when 'warehouse_releasing' then 2 else 3 end;
    if exists (
      select 1 from public.transmittal_stages s
       where s.transmittal_id = p_transmittal_id
         and s.completed_at is not null
         and (case s.stage when 'warehouse_checking' then 1 when 'warehouse_releasing' then 2 else 3 end) > v_order
    ) then
      raise exception 'transmittal_undo_signature: a later stage of % is signed; undo that first', v_row.number
        using errcode = '42501';
    end if;

    v_signer := v_stage.first_signer_id;
    v_signed_at := v_stage.completed_at;
    v_other := v_stage.second_signer_id;
    v_other_name := v_stage.second_signer_name;
    select e.name into v_signer_name from public.employees e where e.id = v_signer;
    v_notify := array_remove(array[v_stage.first_signer_id, v_stage.second_signer_id, v_stage.completed_by], null);

    insert into public.transmittal_cleared_signatures
      (transmittal_id, kind, stage, signer_id, signer_name, signed_at, other_signer_id, other_signer_name,
       cleared_by, cleared_reason)
    values
      (p_transmittal_id, 'stage', p_stage, v_signer, v_signer_name, v_signed_at, v_other, v_other_name,
       v_actor, v_reason);

    perform set_config('app.transmittal_undo', 'on', true);
    update public.transmittal_stages
       set completed_by = null,
           completed_at = null,
           first_signer_id = null,
           first_signed_at = null,
           first_confirmed = false,
           first_signature_declined = false,
           second_signer_id = null,
           second_signer_name = null,
           second_signed_at = null,
           second_confirmed = false,
           second_signature_declined = false
     where id = v_stage.id;

    -- The stage is the one being worked again. Warehouse releasing on a
    -- Warehouse-only slip is optional and leaves the state where it is.
    v_state := case
      when p_stage = 'warehouse_releasing' and not v_row.check_technical then v_row.state
      else p_stage
    end;
    if v_state is distinct from v_row.state then
      update public.transmittals set state = v_state where id = p_transmittal_id;
    end if;
    perform set_config('app.transmittal_undo', 'off', true);

  elsif p_kind = 'odoo' then
    if not (public.transmittal_on_list('transmittal_warehouse') or coalesce(public.has_purchasing_access(), false)) then
      raise exception 'transmittal_undo_signature: only the Warehouse list or Purchasing undoes the Odoo receipt'
        using errcode = '42501';
    end if;
    if v_row.odoo_received_at is null then
      raise exception 'transmittal_undo_signature: % has no Odoo receipt to undo', v_row.number using errcode = '22023';
    end if;
    if v_row.state = 'closed' or v_row.check_by_first_id is not null or v_row.check_by_second_id is not null then
      raise exception 'transmittal_undo_signature: % has a Check by signed; undo that first', v_row.number
        using errcode = '42501';
    end if;

    v_signer := v_row.odoo_received_by;
    v_signed_at := v_row.odoo_received_at;
    v_ref := v_row.odoo_receipt_ref;
    select e.name into v_signer_name from public.employees e where e.id = v_signer;
    v_notify := array_remove(array[v_signer], null);

    insert into public.transmittal_cleared_signatures
      (transmittal_id, kind, signer_id, signer_name, signed_at, receipt_ref, cleared_by, cleared_reason)
    values
      (p_transmittal_id, 'odoo', v_signer, v_signer_name, v_signed_at, v_ref, v_actor, v_reason);

    perform set_config('app.transmittal_undo', 'on', true);
    update public.transmittals
       set odoo_received_by = null, odoo_received_at = null, odoo_receipt_ref = null
     where id = p_transmittal_id;
    perform set_config('app.transmittal_undo', 'off', true);
    v_state := v_row.state;

  else
    if not public.transmittal_on_list('transmittal_check_by') then
      raise exception 'transmittal_undo_signature: only the Check by list undoes a Check by' using errcode = '42501';
    end if;
    if v_row.prepared_by = v_actor then
      raise exception 'transmittal_undo_signature: the preparer can''t check their own slip' using errcode = '42501';
    end if;
    if p_slot is null or p_slot not in (1, 2) then
      raise exception 'transmittal_undo_signature: the slot is 1 or 2' using errcode = '22023';
    end if;

    v_signer := case p_slot when 1 then v_row.check_by_first_id else v_row.check_by_second_id end;
    v_signed_at := case p_slot when 1 then v_row.check_by_first_at else v_row.check_by_second_at end;
    if v_signer is null then
      raise exception 'transmittal_undo_signature: Check by (%) of % isn''t signed', p_slot, v_row.number
        using errcode = '22023';
    end if;
    select e.name into v_signer_name from public.employees e where e.id = v_signer;
    v_notify := array[v_signer];

    insert into public.transmittal_cleared_signatures
      (transmittal_id, kind, slot, signer_id, signer_name, signed_at, cleared_by, cleared_reason)
    values
      (p_transmittal_id, 'check_by', p_slot, v_signer, v_signer_name, v_signed_at, v_actor, v_reason);

    -- One statement: the slot goes and, on a closed slip, the slip reopens with it (a closed slip
    -- must hold its second signature, so the two can't be separate updates).
    perform set_config('app.transmittal_undo', 'on', true);
    update public.transmittals
       set check_by_first_id = case when p_slot = 1 then null else check_by_first_id end,
           check_by_first_at = case when p_slot = 1 then null else check_by_first_at end,
           check_by_second_id = case when p_slot = 2 then null else check_by_second_id end,
           check_by_second_at = case when p_slot = 2 then null else check_by_second_at end,
           state = case when state = 'closed' then 'awaiting_check' else state end,
           closed_at = case when state = 'closed' then null else closed_at end
     where id = p_transmittal_id
     returning state into v_state;
    perform set_config('app.transmittal_undo', 'off', true);
  end if;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'signature_undone', jsonb_build_object(
    'number', v_row.number,
    'kind', p_kind,
    'stage', p_stage,
    'slot', p_slot,
    'state_to', v_state,
    'reason', v_reason
  ));

  return jsonb_build_object(
    'id', p_transmittal_id,
    'number', v_row.number,
    'kind', p_kind,
    'state', v_state,
    'notify_ids', to_jsonb(array(
      select distinct u from unnest(array_append(v_notify, v_row.prepared_by)) as u
       where u is not null and u <> v_actor
    ))
  );
end;
$$;

-- transmittal_check_signature (latest: 20261017200000_transmittal_check_by_decline.sql)
create or replace function public.transmittal_check_signature(p_transmittal_id uuid, p_slot integer, p_decline boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_decline boolean := coalesce(p_decline, false);
begin
  if v_actor is null then
    raise exception 'transmittal_check_signature: not signed in' using errcode = '42501';
  end if;
  if p_slot is null or p_slot not in (1, 2) then
    raise exception 'transmittal_check_signature: the slot is 1 or 2' using errcode = '22023';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_check_signature: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if (case p_slot when 1 then v_row.check_by_first_id else v_row.check_by_second_id end) is distinct from v_actor then
    raise exception 'transmittal_check_signature: only the person who signed that Check by can decline or apply its signature'
      using errcode = '42501';
  end if;

  if p_slot = 1 then
    update public.transmittals set check_by_first_signature_declined = v_decline where id = p_transmittal_id;
  else
    update public.transmittals set check_by_second_signature_declined = v_decline where id = p_transmittal_id;
  end if;

  perform public._transmittal_event(p_transmittal_id, v_actor,
    case when v_decline then 'signature_declined' else 'signature_confirmed' end,
    jsonb_build_object('number', v_row.number, 'slot', p_slot, 'check_by', true));

  return jsonb_build_object('id', p_transmittal_id, 'number', v_row.number, 'slot', p_slot, 'declined', v_decline);
end;
$function$
;

-- costing_matrix_of (latest: 20261018100000_costing_matrix_tender_lines.sql)
create or replace function public.costing_matrix_of(p_table text, p_row jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_table  text := p_table;
  v_row    jsonb := p_row;
  v_def    public.costing_tables;
  v_parent jsonb;
  v_depth  integer := 0;
begin
  loop
    v_depth := v_depth + 1;
    if v_depth > 8 then
      raise exception 'costing_matrix_of: % nests too deep', p_table using errcode = '22023';
    end if;
    if v_table = 'costing_matrices' then
      return (v_row ->> 'id')::uuid;
    end if;
    select * into v_def from public.costing_tables where table_name = v_table;
    if not found then
      return null;
    end if;
    if v_def.parent_table is null then
      return (v_row ->> 'matrix_id')::uuid;
    end if;
    execute format('select to_jsonb(p) from public.%I p where p.%I = $1', v_def.parent_table, v_def.parent_key)
      into v_parent
      using (v_row ->> v_def.parent_column)::uuid;
    if v_parent is null then
      return null;
    end if;
    v_table := v_def.parent_table;
    v_row := v_parent;
  end loop;
end;
$$;

-- costing_matrix_filter (latest: 20261018100000_costing_matrix_tender_lines.sql)
create or replace function public.costing_matrix_filter(p_table text, p_alias text default 't', p_depth integer default 0)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_def public.costing_tables;
  v_inner text;
begin
  if p_table = 'costing_matrices' then
    return format('%s.id = $1', p_alias);
  end if;
  select * into v_def from public.costing_tables where table_name = p_table;
  if not found then
    raise exception 'costing_matrix_filter: % is not a costing table', p_table using errcode = '22023';
  end if;
  if v_def.parent_table is null then
    return format('%s.matrix_id = $1', p_alias);
  end if;
  v_inner := public.costing_matrix_filter(v_def.parent_table, 'p' || (p_depth + 1), p_depth + 1);
  return format(
    '%s.%I in (select %s.%I from public.%I %s where %s)',
    p_alias, v_def.parent_column, 'p' || (p_depth + 1), v_def.parent_key, v_def.parent_table, 'p' || (p_depth + 1), v_inner
  );
end;
$$;

-- costing_open_matrix (latest: 20261018160000_open_costing_matrix_action.sql)
create or replace function public.costing_open_matrix(p_opportunity_id uuid, p_config jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id          uuid;
  v_created     boolean;
  v_sales       uuid := nullif(p_config ->> 'sales_incharge_id', '')::uuid;
  v_buyer       uuid := nullif(p_config ->> 'purchasing_incharge_id', '')::uuid;
  v_preset      public.costing_markup_presets;
  v_visit       uuid := nullif(p_config ->> 'opened_visit_id', '')::uuid;
  v_until       text := coalesce(nullif(p_config ->> 'access_until', ''), 'stage_left');
  v_until_stage uuid := nullif(p_config ->> 'access_until_stage_id', '')::uuid;
  v_actor       uuid := public.get_employee_id();
  v_label       text;
  v_emp         uuid;
begin
  if not exists (select 1 from public.sales_opportunities where id = p_opportunity_id) then
    raise exception 'costing_open_matrix: SOR not found' using errcode = '22023';
  end if;

  perform set_config('costing.bypass', 'on', true);

  insert into public.costing_matrices (opportunity_id, sales_incharge_id, purchasing_incharge_id)
  values (p_opportunity_id, v_sales, v_buyer)
  on conflict (opportunity_id) do nothing
  returning id into v_id;
  v_created := v_id is not null;

  if not v_created then
    select id into v_id from public.costing_matrices where opportunity_id = p_opportunity_id;
    update public.costing_matrices
       set sales_incharge_id = coalesce(sales_incharge_id, v_sales),
           purchasing_incharge_id = coalesce(purchasing_incharge_id, v_buyer)
     where id = v_id
       and ((sales_incharge_id is null and v_sales is not null)
         or (purchasing_incharge_id is null and v_buyer is not null));
  end if;

  insert into public.costing_matrix_money (matrix_id) values (v_id) on conflict (matrix_id) do nothing;

  -- The markup default: a typed factor, or one already chosen, stays.
  if nullif(p_config ->> 'default_preset_id', '') is not null then
    select * into v_preset from public.costing_markup_presets
     where id = (p_config ->> 'default_preset_id')::uuid and active;
    if found then
      update public.costing_matrix_money
         set default_preset_id = v_preset.id, default_factor = v_preset.factor
       where matrix_id = v_id and default_factor is null;
    end if;
  end if;

  select nullif(concat_ws(' · ', o.sales_reference, o.project_title), '') into v_label
    from public.sales_opportunities o where o.id = p_opportunity_id;

  -- Members: a window each, for whoever has no open one on this matrix.
  if v_visit is not null
     and jsonb_typeof(p_config -> 'member_ids') = 'array'
     and not public._sor_window_over(p_opportunity_id, v_visit, v_until, v_until_stage) then
    for v_emp in
      select distinct e.id
        from jsonb_array_elements_text(p_config -> 'member_ids') m
        join public.employees e on e.id = m::uuid and not coalesce(e.is_deleted, false)
    loop
      if not exists (
        select 1 from public.sor_stage_participants p
         where p.opportunity_id = p_opportunity_id
           and p.employee_id = v_emp
           and p.source = 'costing_matrix'
           and p.source_id = v_id
           and p.closed_at is null
      ) then
        insert into public.sor_stage_participants
          (opportunity_id, employee_id, source, source_id, opened_visit_id, until_rule, until_stage_id)
        values
          (p_opportunity_id, v_emp, 'costing_matrix', v_id, v_visit, v_until,
           case when v_until in ('stage_entered', 'later_stage_left') then v_until_stage end);

        if v_emp is distinct from v_actor then
          insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
          values (v_emp, v_actor, 'SOR_STAGE_PARTICIPANT_ADDED', 'Added to a deal',
                  format('You were added to %s to see its Costing Matrix.', coalesce(v_label, 'a deal')),
                  p_opportunity_id::text);
        end if;
      end if;
    end loop;
  end if;

  -- Opened with nobody to buy: tell whoever assigns one.
  if v_created
     and jsonb_typeof(p_config -> 'assigner_ids') = 'array'
     and exists (select 1 from public.costing_matrices where id = v_id and purchasing_incharge_id is null) then
    for v_emp in
      select distinct e.id
        from jsonb_array_elements_text(p_config -> 'assigner_ids') a
        join public.employees e on e.id = a::uuid and not coalesce(e.is_deleted, false)
    loop
      insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
      values (v_emp, v_actor, 'OPPORTUNITY_COSTING_INCHARGE_NEEDED', 'Costing Matrix needs a Purchasing Incharge',
              format('The Costing Matrix for %s opened with no Purchasing Incharge. Please name one.', coalesce(v_label, 'a deal')),
              p_opportunity_id::text);
    end loop;
  end if;

  perform set_config('costing.bypass', 'off', true);
  return v_id;
end;
$$;

-- costing_set_money (latest: 20261018130000_costing_summary_final_acquire.sql)
create or replace function public.costing_set_money(p_table text, p_row uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_def    public.costing_tables;
  v_matrix uuid;
  v_opp    uuid;
  v_key    text;
  v_sets   text;
  v_cols   text;
  v_count  integer;
  v_found  jsonb;
begin
  if public.get_employee_id() is null then
    raise exception 'costing_set_money: sign in first' using errcode = '42501';
  end if;
  select * into v_def from public.costing_tables where table_name = p_table and money;
  if not found then
    raise exception 'costing_set_money: % is not a money table', p_table using errcode = '22023';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'costing_set_money: nothing to change' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key = '*' or not exists (
      select 1 from public.costing_column_bands where table_name = p_table and column_name = v_key
    ) then
      raise exception 'costing_set_money: % is not a column of %', v_key, p_table using errcode = '22023';
    end if;
  end loop;

  if v_def.parent_table is null and v_def.key_column <> 'matrix_id' then
    execute format('select to_jsonb(t) from public.%I t where t.%I = $1', p_table, v_def.key_column)
      into v_found using p_row;
    v_matrix := public.costing_matrix_of(p_table, v_found);
  else
    v_matrix := public.costing_matrix_of(p_table, jsonb_build_object(v_def.key_column, p_row));
  end if;
  v_opp := public.costing_matrix_opp(v_matrix);
  if v_opp is null then
    raise exception 'costing_set_money: not found' using errcode = '22023';
  end if;
  -- A read tier is needed, with one exception (#270): Finance access alone has no tier on
  -- the SOR, yet Finance types Marketing and OPEX. That passes only when every column in the
  -- patch is one a Finance-band caller may write; the band trigger still judges each of them.
  if not public.costing_can_read(v_opp) then
    if not (
      public.has_finance_access()
      and not exists (
        select 1
        from jsonb_object_keys(p_patch) k
        where not exists (
          select 1 from public.costing_column_bands b
          where b.table_name = p_table and b.column_name = k and 'finance' = any (b.bands)
        )
      )
    ) then
      raise exception 'costing_set_money: not allowed' using errcode = '42501';
    end if;
  end if;

  select string_agg(format('%I = r.%I', k, k), ', '), string_agg(format('%I', k), ', ')
    into v_sets, v_cols
    from jsonb_object_keys(p_patch) k;

  execute format(
    'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.%I = $2',
    p_table, v_sets, p_table, v_def.key_column
  ) using p_patch, p_row;
  get diagnostics v_count = row_count;

  if v_count = 0 and (v_def.parent_table is not null or v_def.key_column = 'matrix_id') then
    execute format(
      'insert into public.%I (%I, %s) select $2, %s from jsonb_populate_record(null::public.%I, $1) r',
      p_table, v_def.key_column, v_cols,
      (select string_agg(format('r.%I', k), ', ') from jsonb_object_keys(p_patch) k),
      p_table
    ) using p_patch, p_row;
  end if;
end;
$$;

-- costing_reorder_tender_lines (latest: 20261018100000_costing_matrix_tender_lines.sql)
create or replace function public.costing_reorder_tender_lines(p_matrix_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp uuid := public.costing_matrix_opp(p_matrix_id);
  i     integer;
begin
  if v_opp is null then
    raise exception 'costing_reorder_tender_lines: not found' using errcode = '22023';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_reorder_tender_lines: not allowed' using errcode = '42501';
  end if;
  if (select count(*) from public.costing_tender_lines where matrix_id = p_matrix_id) <> coalesce(cardinality(p_ids), 0)
     or exists (
       select 1 from unnest(p_ids) u(id)
       where not exists (select 1 from public.costing_tender_lines l where l.id = u.id and l.matrix_id = p_matrix_id)
     )
     or (select count(distinct id) from unnest(p_ids) u(id)) <> coalesce(cardinality(p_ids), 0) then
    raise exception 'costing_reorder_tender_lines: the list must name each Tender Line once' using errcode = '22023';
  end if;
  for i in 1 .. coalesce(cardinality(p_ids), 0) loop
    update public.costing_tender_lines set position = i
     where id = p_ids[i] and matrix_id = p_matrix_id and position is distinct from i;
  end loop;
end;
$$;

-- costing_inclusion_needs_bundle (latest: 20261018110000_costing_matrix_components.sql)
create or replace function public.costing_inclusion_needs_bundle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.costing_components c where c.id = new.component_id and c.is_bundle) then
    raise exception 'costing_inclusion: an Inclusion can only sit under a bundle Component'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- costing_bundle_keeps_inclusions (latest: 20261018110000_costing_matrix_components.sql)
create or replace function public.costing_bundle_keeps_inclusions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_bundle and not new.is_bundle
     and exists (select 1 from public.costing_inclusions i where i.component_id = new.id) then
    raise exception 'costing_inclusion: move or remove this Component''s Inclusions before it stops being a bundle'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- costing_check_incharge (latest: 20261018110000_costing_matrix_components.sql)
create or replace function public.costing_check_incharge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp uuid;
  v_sor public.sales_opportunities;
begin
  -- A new matrix is not there to look up yet; it names its SOR itself.
  v_opp := case
    when tg_table_name = 'costing_matrices' then (to_jsonb(new) ->> 'opportunity_id')::uuid
    else public.costing_matrix_opp(public.costing_matrix_of(tg_table_name, to_jsonb(new)))
  end;
  if v_opp is null then
    return new;
  end if;
  -- costing_open_matrix inserts "on conflict do nothing": a row that is about to be
  -- dropped for the matrix the SOR already has is not judged.
  if tg_op = 'INSERT' and tg_table_name = 'costing_matrices'
     and exists (select 1 from public.costing_matrices m where m.opportunity_id = v_opp) then
    return new;
  end if;
  select * into v_sor from public.sales_opportunities where id = v_opp;

  if new.sales_incharge_id is not null
     and (tg_op = 'INSERT' or new.sales_incharge_id is distinct from old.sales_incharge_id)
     and not coalesce(public.sor_is_deal_team(v_sor, new.sales_incharge_id), false) then
    raise exception 'costing_incharge: the Sales incharge must be on the SOR''s Deal Team'
      using errcode = '22023';
  end if;

  if new.purchasing_incharge_id is not null
     and (tg_op = 'INSERT' or new.purchasing_incharge_id is distinct from old.purchasing_incharge_id)
     and not public._employee_has_purchasing_access(new.purchasing_incharge_id) then
    raise exception 'costing_incharge: the Purchasing incharge must have Purchasing access'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- costing_move_inclusion (latest: 20261018110000_costing_matrix_components.sql)
create or replace function public.costing_move_inclusion(p_inclusion_id uuid, p_component_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inc    public.costing_inclusions;
  v_target public.costing_components;
  v_from   uuid;
  v_to     uuid;
  v_opp    uuid;
begin
  select * into v_inc from public.costing_inclusions where id = p_inclusion_id;
  if not found then
    raise exception 'costing_move_inclusion: Inclusion not found' using errcode = '22023';
  end if;
  select * into v_target from public.costing_components where id = p_component_id;
  if not found then
    raise exception 'costing_move_inclusion: Component not found' using errcode = '22023';
  end if;

  v_from := public.costing_matrix_of('costing_inclusions', to_jsonb(v_inc));
  v_to := public.costing_matrix_of('costing_components', to_jsonb(v_target));
  v_opp := public.costing_matrix_opp(v_from);
  if v_opp is null or not public.costing_can_read(v_opp) then
    raise exception 'costing_move_inclusion: not allowed' using errcode = '42501';
  end if;
  if v_from is distinct from v_to then
    raise exception 'costing_move_inclusion: the Component is on another SOR''s matrix' using errcode = '22023';
  end if;
  if not v_target.is_bundle then
    raise exception 'costing_move_inclusion: an Inclusion can only sit under a bundle Component' using errcode = '22023';
  end if;
  if v_inc.component_id = p_component_id then
    return;
  end if;

  update public.costing_inclusions
     set component_id = p_component_id,
         position = coalesce((select max(i.position) from public.costing_inclusions i where i.component_id = p_component_id), 0) + 1
   where id = p_inclusion_id;
end;
$$;

-- costing_add_cost_row (latest: 20261018110000_costing_matrix_components.sql)
create or replace function public.costing_add_cost_row(p_matrix_id uuid, p_description text default '', p_quantity numeric default 1)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp uuid := public.costing_matrix_opp(p_matrix_id);
  v_id  uuid;
begin
  if v_opp is null then
    raise exception 'costing_add_cost_row: not found' using errcode = '22023';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_add_cost_row: not allowed' using errcode = '42501';
  end if;
  insert into public.costing_cost_rows (matrix_id, position, description, quantity)
  values (
    p_matrix_id,
    coalesce((select max(r.position) from public.costing_cost_rows r where r.matrix_id = p_matrix_id), 0) + 1,
    coalesce(p_description, ''),
    coalesce(p_quantity, 1)
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- costing_remove_cost_row (latest: 20261018110000_costing_matrix_components.sql)
create or replace function public.costing_remove_cost_row(p_row_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matrix uuid;
  v_opp    uuid;
begin
  select matrix_id into v_matrix from public.costing_cost_rows where id = p_row_id;
  v_opp := public.costing_matrix_opp(v_matrix);
  if v_opp is null then
    raise exception 'costing_remove_cost_row: not found' using errcode = '22023';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_remove_cost_row: not allowed' using errcode = '42501';
  end if;
  delete from public.costing_cost_rows where id = p_row_id;
end;
$$;

-- costing_sign (latest: 20261018200000_costing_print_signoffs.sql)
create or replace function public.costing_sign(p_matrix_id uuid, p_role text, p_decline_signature boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := public.get_employee_id();
  v_opp       uuid;
  v_incharge  uuid;
  v_missing   integer;
  v_signature text;
  v_row       public.costing_signoffs;
begin
  if v_actor is null then
    raise exception 'costing_sign: sign in first' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('prepared', 'costed', 'evaluation_approved', 'final_approved') then
    raise exception 'costing_sign: % is not a sign-off', coalesce(p_role, 'that') using errcode = '22023';
  end if;

  v_opp := public.costing_matrix_opp(p_matrix_id);
  if v_opp is null then
    raise exception 'costing_sign: not found' using errcode = '22023';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_sign: not allowed' using errcode = '42501';
  end if;

  if p_role = 'evaluation_approved' then
    if not public.costing_on_list('evaluation') then
      raise exception 'costing_sign: only someone on the evaluation list can approve the evaluation' using errcode = '42501';
    end if;
  elsif p_role = 'prepared' then
    select m.sales_incharge_id into v_incharge from public.costing_matrices m where m.id = p_matrix_id;
    if v_incharge is distinct from v_actor then
      raise exception 'costing_sign: only the Sales incharge can sign Prepared by' using errcode = '42501';
    end if;
  elsif p_role = 'costed' then
    select m.purchasing_incharge_id into v_incharge from public.costing_matrices m where m.id = p_matrix_id;
    if v_incharge is distinct from v_actor then
      raise exception 'costing_sign: only the Purchasing incharge can sign Costed by' using errcode = '42501';
    end if;
  elsif not public.costing_on_list('final_acquire') then
    raise exception 'costing_sign: only someone on the Final Acquire list can approve the Final Acquire and offer' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('costing_sign:' || p_matrix_id::text));

  if exists (
    select 1 from public.costing_signoffs s
    where s.matrix_id = p_matrix_id and s.role = p_role and s.cleared_at is null
  ) then
    if p_role = 'evaluation_approved' then
      raise exception 'costing_sign: the evaluation is already approved' using errcode = '22023';
    end if;
    raise exception 'costing_sign: that sign-off is already signed' using errcode = '22023';
  end if;

  if p_role = 'evaluation_approved' then
    select count(*) into v_missing
    from public.costing_components c
    join public.costing_tender_lines l on l.id = c.tender_line_id
    where l.matrix_id = p_matrix_id and c.compliance is null;
    if v_missing > 0 then
      raise exception 'costing_sign: % Component% no verdict yet',
        v_missing, case when v_missing = 1 then ' has' else 's have' end
        using errcode = '22023';
    end if;
  end if;

  if not coalesce(p_decline_signature, false) then
    select nullif(btrim(e.signature_path), '') into v_signature from public.employees e where e.id = v_actor;
  end if;

  insert into public.costing_signoffs (matrix_id, role, signed_by, signature_declined, signature_version)
  values (p_matrix_id, p_role, v_actor, coalesce(p_decline_signature, false), v_signature)
  returning * into v_row;

  return jsonb_build_object('signoff', to_jsonb(v_row));
end;
$$;

-- costing_decide_bid (latest: 20261018170000_costing_bid_decision.sql)
create or replace function public.costing_decide_bid(p_matrix_id uuid, p_verdict text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := public.get_employee_id();
  v_opp    uuid := public.costing_matrix_opp(p_matrix_id);
  v_totals record;
  v_id     uuid;
  v_title  text;
  v_label  text;
  v_member record;
begin
  if v_actor is null then
    raise exception 'costing_bid: sign in first' using errcode = '42501';
  end if;
  if v_opp is null then
    raise exception 'costing_bid: matrix not found' using errcode = '22023';
  end if;
  if public.costing_tier(v_opp) is distinct from 'closed_book' then
    raise exception 'costing_bid: only a Super Admin or the Final Acquire list can decide a bid' using errcode = '42501';
  end if;
  if p_verdict is null or p_verdict not in ('go', 'no_go', 'revise') then
    raise exception 'costing_bid: the verdict must be Go, No-go or Revise' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'costing_bid: write the reason for the decision' using errcode = '22023';
  end if;

  -- One decision at a time per matrix (ADR 0013).
  perform 1 from public.costing_matrices where id = p_matrix_id for update;

  select * into v_totals from public.costing_bid_totals(p_matrix_id);
  if v_totals.line_count = 0 or v_totals.missing_offer > 0 then
    raise exception 'costing_bid: every Tender Line needs a Final Offer before the bid can be decided' using errcode = '22023';
  end if;

  update public.costing_bid_decisions
     set cleared_at = now(), cleared_reason = 'Decided again'
   where matrix_id = p_matrix_id and cleared_at is null;

  insert into public.costing_bid_decisions (matrix_id, verdict, reason, decided_by, final_offer_total, abc_total)
  values (p_matrix_id, p_verdict, btrim(p_reason), v_actor, v_totals.final_offer_total, v_totals.abc_total)
  returning id into v_id;

  if p_verdict in ('no_go', 'revise') then
    select o.project_title into v_title from public.sales_opportunities o where o.id = v_opp;
    v_label := case p_verdict when 'no_go' then 'No-go' else 'Revise' end;
    -- The Deal Team, once each, never the decider. The message carries the verdict and the
    -- reason, and no figure: Sales never reads the numbers a decision was taken against.
    for v_member in
      select distinct t.employee_id
      from public.sales_opportunities o
      cross join lateral public._sor_deal_team_roles(o) t
      join public.employees e on e.id = t.employee_id
      where o.id = v_opp
        and t.employee_id <> v_actor
        and not coalesce(e.is_deleted, false)
    loop
      insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
      values (
        v_member.employee_id,
        v_actor,
        'SOR_BID_DECISION',
        format('Bid decision: %s', v_label),
        format('The bid on "%s" is %s: %s', coalesce(v_title, 'this deal'), v_label, btrim(p_reason)),
        v_opp::text
      );
    end loop;
  end if;

  return v_id;
end;
$$;

-- costing_accept_brand (latest: 20261019120000_canvass_winner_fills_matrix.sql)
create or replace function public.costing_accept_brand(p_component_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp   uuid;
  v_brand text;
begin
  if public.get_employee_id() is null then
    raise exception 'costing_accept_brand: sign in first' using errcode = '42501';
  end if;

  v_opp := public.canvass_component_opportunity(p_component_id);
  if v_opp is null then
    raise exception 'costing_accept_brand: not found' using errcode = '22023';
  end if;
  if not (public.costing_can_read(v_opp) and public.costing_in_band(v_opp, 'sales')) then
    raise exception 'costing_accept_brand: only the Deal Team can accept a brand' using errcode = '42501';
  end if;

  select nullif(btrim(coalesce(o.brand, '')), '') into v_brand
    from public.sor_canvasses c
    join public.sor_canvass_offers o on o.canvass_id = c.id and o.is_winner
   where c.component_id = p_component_id;
  if v_brand is null then
    raise exception 'costing_accept_brand: the Canvass has no winning brand' using errcode = '22023';
  end if;

  -- As the caller, so the Sales band trigger judges the write too.
  update public.costing_components set brand = v_brand where id = p_component_id;

  return jsonb_build_object('brand', v_brand);
end;
$$;

-- costing_component_delete_guard (latest: 20261019200000_landed_cost_flows_back.sql)
create or replace function public.costing_component_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link text;
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  v_link := public._costing_component_link(old.id, old.po_rfq_no);
  if v_link is not null then
    raise exception 'This Component is linked to %. Unlink it before deleting.', v_link
      using errcode = '22023', hint = 'costing_component_linked';
  end if;
  return old;
end;
$$;

-- costing_tender_line_delete_guard (latest: 20261019200000_landed_cost_flows_back.sql)
create or replace function public.costing_tender_line_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link text;
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  select public._costing_component_link(c.id, c.po_rfq_no) into v_link
  from public.costing_components c
  where c.tender_line_id = old.id and public._costing_component_link(c.id, c.po_rfq_no) is not null
  limit 1;
  if v_link is not null then
    raise exception 'A Component on this Tender Line is linked to %. Unlink it before deleting.', v_link
      using errcode = '22023', hint = 'costing_component_linked';
  end if;
  return old;
end;
$$;

-- ipas_raise_from_odoo (latest: 20261023150000_ipas_raise_server_fetches_odoo_copy.sql)
create or replace function public.ipas_raise_from_odoo(
  p_actor uuid,
  p_po_number text,
  p_priority text,
  p_source text,
  p_purpose text,
  p_sor_ids uuid[],
  p_remarks text,
  p_verdict text,
  p_odoo_copy jsonb
) returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po text := upper(btrim(p_po_number));
  v_sors uuid[];
  v_existing text;
  v_row public.ipas;
begin
  if p_actor is null or not public._employee_has_purchasing_access(p_actor) then
    raise exception 'ipas_create: only Purchasing raises an IPAS' using errcode = '42501';
  end if;

  if v_po is null or v_po !~ '^P[0-9]+$' then
    raise exception 'ipas_create: % isn''t an Odoo PO number ("P" then digits, e.g. P01234)', coalesce(p_po_number, 'null')
      using errcode = '22023';
  end if;
  if p_priority is null or p_priority not in ('very_high', 'high', 'medium') then
    raise exception 'ipas_create: % isn''t a Priority', coalesce(p_priority, 'null') using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('import', 'local') then
    raise exception 'ipas_create: % isn''t a Source', coalesce(p_source, 'null') using errcode = '22023';
  end if;
  if p_purpose is null or p_purpose not in ('project', 'inventory', 'supplies', 'events') then
    raise exception 'ipas_create: % isn''t a Purpose', coalesce(p_purpose, 'null') using errcode = '22023';
  end if;

  -- What Odoo said, as the server heard it.
  if p_verdict is distinct from 'found' then
    if p_verdict = 'not_found' then
      raise exception 'ipas_create: Odoo has no purchase order named %', v_po using errcode = '22023', hint = 'odoo_not_found';
    elsif p_verdict = 'unavailable' then
      raise exception 'ipas_create: Odoo couldn''t be asked about %; try again shortly', v_po using errcode = '22023', hint = 'odoo_unavailable';
    end if;
    raise exception 'ipas_create: % isn''t an Odoo verdict', coalesce(p_verdict, 'null') using errcode = '22023';
  end if;

  if p_odoo_copy is null
     or jsonb_typeof(p_odoo_copy) <> 'object'
     or jsonb_typeof(p_odoo_copy->'po') is distinct from 'object'
     or jsonb_typeof(p_odoo_copy->'lines') is distinct from 'array' then
    raise exception 'ipas_create: the Odoo copy is missing' using errcode = '22023';
  end if;
  if upper(btrim(p_odoo_copy->'po'->>'name')) is distinct from v_po then
    raise exception 'ipas_create: the Odoo copy is for %, not %', coalesce(p_odoo_copy->'po'->>'name', 'no PO'), v_po
      using errcode = '22023';
  end if;

  v_sors := public._ipas_clean_sor_ids('ipas_create', p_purpose, p_sor_ids);

  select i.number into v_existing
    from public.ipas i
   where i.po_number = v_po and i.state <> 'cancelled';
  if v_existing is not null then
    raise exception 'ipas_create: % already has a live IPAS (%); cancel it to raise a new one', v_po, v_existing
      using errcode = '23505';
  end if;

  insert into public.ipas (
    po_number, odoo_po_id, priority, source, purpose, remarks, odoo_copy, created_by
  ) values (
    v_po,
    case when (p_odoo_copy->'po'->>'id') ~ '^[0-9]+$' then (p_odoo_copy->'po'->>'id')::integer end,
    p_priority,
    p_source,
    p_purpose,
    nullif(btrim(p_remarks), ''),
    p_odoo_copy,
    p_actor
  )
  returning * into v_row;

  insert into public.ipas_sors (ipas_id, opportunity_id)
  select v_row.id, s from unnest(v_sors) s;

  perform public._ipas_write_event(v_row.id, p_actor, 'created', jsonb_build_object(
    'number', v_row.number,
    'po_number', v_row.po_number,
    'priority', v_row.priority,
    'source', v_row.source,
    'purpose', v_row.purpose,
    'sor_ids', to_jsonb(v_sors)
  ));

  return v_row;
end;
$$;

