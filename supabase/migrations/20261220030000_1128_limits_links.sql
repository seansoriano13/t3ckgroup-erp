-- #1128 (spec #1123 T5; tracker D1, D2, C1, A4): limits on typed values, plain sentences instead of database
-- text, and file links that must point at the app's own file store. Old rows stay as they are: every check
-- looks only at a value that is new or being changed.
--
--   * ipas: P.I # at most 60, Remarks at most 2,000, Supplier contact at most 200 and trimmed (blank is empty),
--     P.I/QT Amount at most 9,999,999,999.99. ipas_set_header says it first; a trigger covers every other way in.
--   * A second live IPAS on the same PO says "P01050 already has a live IPAS (TGIPAS_079)", also for the
--     raise that lost a race (it waits for the winner, then sees it), never "ipas_live_po_number_key".
--   * transmittals: the Odoo receipt reference is at most 60 characters.
--   * packing list boxes: weight 0..5,000 kg, marks and seal at most 200; contents: quantity above 0 and at most
--     100,000, a description. All before the table's own CHECKs, so no "Failing row contains".
--   * ipas_documents.attachment_url, ipas_payments.proof_url, ipas_charges.attachment_url (so ipas_add_document,
--     ipas_set_document_attachment, ipas_add_payment, ipas_update_payment, ipas_save_payment and ipas_fill_charge)
--     take only a link to Cloudinary or to the project's Supabase storage, which is where uploads go.

-- ---------------------------------------------------------------------------
-- Own-file links
-- ---------------------------------------------------------------------------
create or replace function public._ipas_is_own_file_link(p_url text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_url ~* '^https://res\.cloudinary\.com/[^[:space:]]+$'
      or p_url ~* '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/[^[:space:]]+$'
      or p_url ~* '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/storage/v1/object/[^[:space:]]+$';
$$;

revoke all on function public._ipas_is_own_file_link(text) from public, anon;

-- One guard for the three link columns. TG_ARGV[0] is the column. A link that is not changing stays.
create or replace function public.ipas_file_link_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_col text := tg_argv[0];
  v_new text := to_jsonb(new) ->> v_col;
  v_old text := case when tg_op = 'UPDATE' then to_jsonb(old) ->> v_col end;
begin
  if v_new is null or v_new is not distinct from v_old then
    return new;
  end if;
  if not public._ipas_is_own_file_link(btrim(v_new)) then
    raise exception 'ipas_file_link: attach a file you uploaded here, not a link to another site' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists ipas_documents_file_link on public.ipas_documents;
create trigger ipas_documents_file_link
  before insert or update of attachment_url on public.ipas_documents
  for each row execute function public.ipas_file_link_guard('attachment_url');

drop trigger if exists ipas_payments_file_link on public.ipas_payments;
create trigger ipas_payments_file_link
  before insert or update of proof_url on public.ipas_payments
  for each row execute function public.ipas_file_link_guard('proof_url');

drop trigger if exists ipas_charges_file_link on public.ipas_charges;
create trigger ipas_charges_file_link
  before insert or update of attachment_url on public.ipas_charges
  for each row execute function public.ipas_file_link_guard('attachment_url');

-- ---------------------------------------------------------------------------
-- ipas: limits, trimmed contact, one live IPAS per PO in words
-- ---------------------------------------------------------------------------
create or replace function public.ipas_limits_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
begin
  if tg_op = 'INSERT' or new.supplier_contact is distinct from old.supplier_contact then
    new.supplier_contact := nullif(btrim(new.supplier_contact), '');
    if length(new.supplier_contact) > 200 then
      raise exception 'ipas_limits: Supplier''s name can be at most 200 characters' using errcode = '22023';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.pi_number is distinct from old.pi_number) and length(btrim(new.pi_number)) > 60 then
    raise exception 'ipas_limits: P.I # can be at most 60 characters' using errcode = '22023';
  end if;
  if (tg_op = 'INSERT' or new.remarks is distinct from old.remarks) and length(btrim(new.remarks)) > 2000 then
    raise exception 'ipas_limits: Remarks can be at most 2,000 characters' using errcode = '22023';
  end if;
  if (tg_op = 'INSERT' or new.pi_qt_amount is distinct from old.pi_qt_amount) and new.pi_qt_amount > 9999999999.99 then
    raise exception 'ipas_limits: P.I/QT Amount is at most 9,999,999,999.99' using errcode = '22023';
  end if;

  -- Two raises for one PO at once: the second waits here for the first, then sees it.
  if tg_op = 'INSERT' and new.state <> 'cancelled' then
    perform pg_advisory_xact_lock(hashtextextended('ipas_live_po:' || new.po_number, 0));
    select i.number into v_existing
      from public.ipas i
     where i.po_number = new.po_number and i.state <> 'cancelled';
    if v_existing is not null then
      raise exception 'ipas_create: % already has a live IPAS (%); cancel it to raise a new one', new.po_number, v_existing
        using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ipas_limits_guard on public.ipas;
create trigger ipas_limits_guard
  before insert or update on public.ipas
  for each row execute function public.ipas_limits_guard();

-- ---------------------------------------------------------------------------
-- transmittals: the Odoo receipt reference
-- ---------------------------------------------------------------------------
create or replace function public.transmittals_receipt_ref_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.odoo_receipt_ref is distinct from old.odoo_receipt_ref and length(btrim(new.odoo_receipt_ref)) > 60 then
    raise exception 'transmittal_received_in_odoo: The Odoo receipt reference can be at most 60 characters' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists transmittals_receipt_ref_guard on public.transmittals;
create trigger transmittals_receipt_ref_guard
  before update of odoo_receipt_ref on public.transmittals
  for each row execute function public.transmittals_receipt_ref_guard();

-- ---------------------------------------------------------------------------
-- Packing list boxes and contents: the 20261220010000 guards, plus the limits in words
-- ---------------------------------------------------------------------------
create or replace function public.packing_list_boxes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_list uuid := coalesce(new.packing_list_id, old.packing_list_id);
begin
  if exists (select 1 from public.packing_lists p where p.id = v_list and p.state in ('packed', 'cancelled')) then
    raise exception 'packing_list_boxes: a packed or cancelled Packing List''s boxes can''t be changed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;

  if tg_op = 'INSERT' or new.gross_weight_kg is distinct from old.gross_weight_kg then
    if new.gross_weight_kg < 0 then
      raise exception 'packing list: A box can''t weigh less than 0 kg' using errcode = '22023';
    end if;
    if new.gross_weight_kg > 5000 then
      raise exception 'packing list: A box can weigh at most 5,000 kg' using errcode = '22023';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.marks is distinct from old.marks) and length(new.marks) > 200 then
    raise exception 'packing list: Marks can be at most 200 characters' using errcode = '22023';
  end if;
  if (tg_op = 'INSERT' or new.seal_no is distinct from old.seal_no) and length(new.seal_no) > 200 then
    raise exception 'packing list: Seal number can be at most 200 characters' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public.packing_list_contents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box uuid := coalesce(new.box_id, old.box_id);
begin
  if exists (
    select 1
      from public.packing_list_boxes b
      join public.packing_lists p on p.id = b.packing_list_id
     where b.id = v_box and p.state in ('packed', 'cancelled')
  ) then
    raise exception 'packing_list_contents: a packed or cancelled Packing List''s contents can''t be changed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;

  if tg_op = 'INSERT' or new.description is distinct from old.description then
    if new.description is null or length(btrim(new.description)) = 0 then
      raise exception 'packing list: Every content needs a description' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'INSERT' or new.quantity is distinct from old.quantity then
    if new.quantity is null or new.quantity <= 0 then
      raise exception 'packing list: Every content needs a quantity above zero' using errcode = '22023';
    end if;
    if new.quantity > 100000 then
      raise exception 'packing list: A content''s quantity is at most 100,000' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- ipas_set_header (latest: 20261027100000_595): the same, with the limits said first
-- ---------------------------------------------------------------------------
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
  v_changes jsonb := '{}'::jsonb;
begin
  if v_actor is null then
    raise exception 'ipas_set_header: not signed in' using errcode = '42501';
  end if;
  -- Only Purchasing changes an IPAS (#586: Checked by is gone, so there is no Finance
  -- or Super Admin exception any more; section 3's sign-off is the check).
  if not public.has_purchasing_access() then
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

  -- Limits (#1128, spec #1123 D1): said in words here, before any write.
  if v_contact is distinct from v_row.supplier_contact and length(v_contact) > 200 then
    raise exception 'ipas_set_header: Supplier''s name can be at most 200 characters' using errcode = '22023';
  end if;
  if v_pi is distinct from v_row.pi_number and length(v_pi) > 60 then
    raise exception 'ipas_set_header: P.I # can be at most 60 characters' using errcode = '22023';
  end if;
  if v_remarks is distinct from v_row.remarks and length(v_remarks) > 2000 then
    raise exception 'ipas_set_header: Remarks can be at most 2,000 characters' using errcode = '22023';
  end if;

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
    if v_amount is not null and v_amount > 9999999999.99 then
      raise exception 'ipas_set_header: P.I/QT Amount is at most 9,999,999,999.99' using errcode = '22023';
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
    if v_status is null or v_status not in ('encoding', 'encoded', 'lc_gs_done', 'lc_odoo_done') then
      raise exception 'ipas_set_header: the computation status is Encoding, Encoded, LC GS Done or LC Odoo Done'
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
