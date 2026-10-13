-- ==============================================================================
-- 20261013100300_ipas_odoo_copy.sql
--
-- Issue #243 (IPAS, spec #241) — keep the Odoo copy current, with overrides.
--
-- WHAT THIS ADDS TO `ipas` (all additive, nothing existing altered)
--   supplier_contact, pi_number      typed values; Odoo fills them ONLY while blank
--   entity_override, source_doc_override, analytic_override
--                                    what Purchasing typed over Odoo's value; null
--                                    = follow Odoo. Currency, Supplier, item
--                                    lines and Brand have no column: they can't
--                                    be changed by anyone.
--   odoo_change_note                 what the last real change was, since the
--                                    previous copy: lines added / removed /
--                                    quantity or price changed, and the total
--   odoo_changed_since_filing        the PO differs from the frozen copy
--
-- THE RPCs
--   ipas_record_odoo_copy   the refresh. The client reads Odoo (`odoo-po-ipas`)
--                           and hands the copy in; the database never talks to
--                           Odoo. Stores it with its fetch time, computes the
--                           change note, fills blank contact / P.I #, and — when
--                           lines or the total changed — clears the live
--                           section 1 and 3 approvals ("PO changed in Odoo") and
--                           says who prepared them so the service can notify.
--                           On a filed IPAS it stores nothing and only sets
--                           odoo_changed_since_filing.
--   ipas_override_field / ipas_reset_override
--                           Entity, Source Doc. and Analytic Dist. only; every
--                           override and reset writes an ipas_events row.
--   ipas_set_header         the two typed values above (later tickets add keys).
--
-- SIGN-OFFS DON'T EXIST YET. `ipas_signoffs` arrives with the sections 1 and 3
-- ticket (#247), so the approval reset is written here against it by dynamic SQL
-- guarded on `to_regclass`: it does nothing until that table exists, and is
-- first exercised for real there. Nothing else in this file depends on it.
--
-- WHO MAY REFRESH. Anyone who can read IPAS (`ipas_can_read()`): opening an IPAS
-- refreshes it, and Finance and signers open IPAS they can't otherwise change.
-- The caller supplies the copy, exactly as with ipas_create; the function checks
-- it is a PO copy for THIS IPAS's PO and nothing more can be proven from here.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Columns
-- ------------------------------------------------------------------------------

alter table public.ipas
  add column if not exists supplier_contact text,
  add column if not exists pi_number text,
  add column if not exists entity_override text,
  add column if not exists source_doc_override text,
  add column if not exists analytic_override text,
  add column if not exists odoo_change_note jsonb,
  add column if not exists odoo_changed_since_filing boolean not null default false;

comment on column public.ipas.supplier_contact is
  '#243: the supplier contact. Typed and kept; Odoo''s PO contact fills it only while it is blank.';
comment on column public.ipas.pi_number is
  '#243: P.I # (the supplier''s proforma invoice number). Typed and kept; Odoo''s vendor reference fills it only while it is blank.';
comment on column public.ipas.entity_override is
  '#243: Entity as Purchasing corrected it; null follows the Odoo PO''s company. Reset by ipas_reset_override.';
comment on column public.ipas.source_doc_override is
  '#243: Source Doc. as Purchasing corrected it; null follows the Odoo PO''s Source Document.';
comment on column public.ipas.analytic_override is
  '#243: Analytic Dist. as Purchasing corrected it; null follows the analytic accounts on the PO''s lines.';
comment on column public.ipas.odoo_change_note is
  '#243: the last change seen in Odoo, since the previous copy: { at, previous_fetched_at, added[], removed[], changed[], total_from, total_to }. Kept until a newer change replaces it.';
comment on column public.ipas.odoo_changed_since_filing is
  '#243: a filed IPAS''s Odoo PO no longer matches its frozen copy. The copy itself never changes.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ipas_overrides_chk' and conrelid = 'public.ipas'::regclass) then
    alter table public.ipas add constraint ipas_overrides_chk check (
      (entity_override is null or length(btrim(entity_override)) > 0)
      and (source_doc_override is null or length(btrim(source_doc_override)) > 0)
      and (analytic_override is null or length(btrim(analytic_override)) > 0)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipas_change_note_chk' and conrelid = 'public.ipas'::regclass) then
    alter table public.ipas add constraint ipas_change_note_chk check (
      odoo_change_note is null or jsonb_typeof(odoo_change_note) = 'object'
    );
  end if;
end;
$$;

-- ------------------------------------------------------------------------------
-- Filled while blank
--
-- Odoo's contact and vendor reference fill `supplier_contact` and `pi_number`
-- only while they are blank, whichever path stores a copy (raising an IPAS or a
-- refresh). A typed value is never touched; clearing one leaves it blank until
-- the next copy is stored.
-- ------------------------------------------------------------------------------

create or replace function public.ipas_fill_from_odoo_copy()
returns trigger
language plpgsql
as $$
begin
  if nullif(btrim(new.supplier_contact), '') is null then
    new.supplier_contact := nullif(btrim(new.odoo_copy->'supplier'->>'contact'), '');
  end if;
  if nullif(btrim(new.pi_number), '') is null then
    new.pi_number := nullif(btrim(new.odoo_copy->'po'->>'partner_ref'), '');
  end if;
  return new;
end;
$$;

drop trigger if exists ipas_fill_from_odoo_copy on public.ipas;
create trigger ipas_fill_from_odoo_copy
  before insert or update of odoo_copy on public.ipas
  for each row execute function public.ipas_fill_from_odoo_copy();

-- ------------------------------------------------------------------------------
-- Reading a copy
-- ------------------------------------------------------------------------------

-- A line's identity across copies: the Odoo purchase.order.line id, or (for a
-- copy that lacks one) the product and name.
create or replace function public._ipas_line_key(p_line jsonb)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(p_line->>'line_id', ''),
    'p' || coalesce(p_line->>'product_id', '') || ':' || coalesce(p_line->>'name', '')
  );
$$;

create or replace function public._ipas_copy_total(p_copy jsonb)
returns numeric
language sql
immutable
as $$
  select coalesce(sum(
    case when jsonb_typeof(l->'price_subtotal') = 'number' then (l->>'price_subtotal')::numeric else 0 end
  ), 0)
  from jsonb_array_elements(
    case when jsonb_typeof(p_copy->'lines') = 'array' then p_copy->'lines' else '[]'::jsonb end
  ) l;
$$;

-- The PO's state as the IPAS cares about it: an RFQ, an order, or cancelled.
create or replace function public._ipas_po_state_class(p_copy jsonb)
returns text
language sql
immutable
as $$
  select case p_copy->'po'->>'state'
    when 'cancel' then 'cancel'
    when 'purchase' then 'ordered'
    when 'done' then 'ordered'
    else 'rfq'
  end;
$$;

-- What "the PO changed" means after filing: the lines (identity, quantity,
-- prices), the total, who it is bought from and in what currency, the Source
-- Document, and whether the order is an RFQ, placed or cancelled. Receipts and
-- bills move after filing as a matter of course and are not the PO changing.
create or replace function public._ipas_copy_digest(p_copy jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(
        jsonb_build_array(public._ipas_line_key(l), l->'quantity', l->'price_unit', l->'price_subtotal')
        order by public._ipas_line_key(l)
      )
      from jsonb_array_elements(
        case when jsonb_typeof(p_copy->'lines') = 'array' then p_copy->'lines' else '[]'::jsonb end
      ) l
    ), '[]'::jsonb),
    'total', public._ipas_copy_total(p_copy),
    'company', p_copy->'po'->'company',
    'currency', p_copy->'po'->'currency',
    'origin', p_copy->'po'->'origin',
    'partner_ref', p_copy->'po'->'partner_ref',
    'supplier', p_copy->'supplier'->'id',
    'state', public._ipas_po_state_class(p_copy)
  );
$$;

-- The analytic account names across a copy's lines, in order, as the page joins
-- them: "A · B".
create or replace function public._ipas_odoo_analytic(p_copy jsonb)
returns text
language sql
immutable
as $$
  select string_agg(x.name, ' · ' order by x.ord)
  from (
    select a.name, min(l.i * 1000 + a.o) as ord
    from jsonb_array_elements(
           case when jsonb_typeof(p_copy->'lines') = 'array' then p_copy->'lines' else '[]'::jsonb end
         ) with ordinality l(line, i)
    cross join lateral jsonb_array_elements_text(
           case when jsonb_typeof(l.line->'analytic') = 'array' then l.line->'analytic' else '[]'::jsonb end
         ) with ordinality a(name, o)
    where nullif(btrim(a.name), '') is not null
    group by a.name
  ) x;
$$;

-- Odoo's current value of an overridable field.
create or replace function public._ipas_odoo_value(p_copy jsonb, p_field text)
returns text
language sql
immutable
as $$
  select case p_field
    when 'entity' then nullif(btrim(p_copy->'po'->>'company'), '')
    when 'source_doc' then nullif(btrim(p_copy->'po'->>'origin'), '')
    when 'analytic' then public._ipas_odoo_analytic(p_copy)
  end;
$$;

-- The change note between two copies: lines added, lines removed and lines whose
-- quantity or unit price changed, with the total before and after. Null when the
-- lines and total are the same.
create or replace function public._ipas_change_note(p_old jsonb, p_new jsonb, p_previous_fetched_at timestamptz)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_added jsonb;
  v_removed jsonb;
  v_changed jsonb;
  v_total_from numeric := public._ipas_copy_total(p_old);
  v_total_to numeric := public._ipas_copy_total(p_new);
begin
  select coalesce(jsonb_object_agg(public._ipas_line_key(l), l), '{}'::jsonb) into v_old
    from jsonb_array_elements(
      case when jsonb_typeof(p_old->'lines') = 'array' then p_old->'lines' else '[]'::jsonb end
    ) l;
  select coalesce(jsonb_object_agg(public._ipas_line_key(l), l), '{}'::jsonb) into v_new
    from jsonb_array_elements(
      case when jsonb_typeof(p_new->'lines') = 'array' then p_new->'lines' else '[]'::jsonb end
    ) l;

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_id', n.value->'line_id', 'name', n.value->'name',
           'quantity', n.value->'quantity', 'price_unit', n.value->'price_unit'
         ) order by n.key), '[]'::jsonb)
    into v_added
    from jsonb_each(v_new) n
   where not jsonb_exists(v_old, n.key);

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_id', o.value->'line_id', 'name', o.value->'name',
           'quantity', o.value->'quantity', 'price_unit', o.value->'price_unit'
         ) order by o.key), '[]'::jsonb)
    into v_removed
    from jsonb_each(v_old) o
   where not jsonb_exists(v_new, o.key);

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_id', n.value->'line_id', 'name', n.value->'name',
           'quantity_from', o.value->'quantity', 'quantity_to', n.value->'quantity',
           'price_unit_from', o.value->'price_unit', 'price_unit_to', n.value->'price_unit'
         ) order by n.key), '[]'::jsonb)
    into v_changed
    from jsonb_each(v_new) n
    join jsonb_each(v_old) o on o.key = n.key
   where (o.value->'quantity') is distinct from (n.value->'quantity')
      or (o.value->'price_unit') is distinct from (n.value->'price_unit');

  if jsonb_array_length(v_added) = 0
     and jsonb_array_length(v_removed) = 0
     and jsonb_array_length(v_changed) = 0
     and v_total_from = v_total_to then
    return null;
  end if;

  return jsonb_build_object(
    'previous_fetched_at', p_previous_fetched_at,
    'added', v_added,
    'removed', v_removed,
    'changed', v_changed,
    'total_from', v_total_from,
    'total_to', v_total_to
  );
end;
$$;

revoke all on function public._ipas_line_key(jsonb) from public, anon, authenticated;
revoke all on function public._ipas_copy_total(jsonb) from public, anon, authenticated;
revoke all on function public._ipas_po_state_class(jsonb) from public, anon, authenticated;
revoke all on function public._ipas_copy_digest(jsonb) from public, anon, authenticated;
revoke all on function public._ipas_odoo_analytic(jsonb) from public, anon, authenticated;
revoke all on function public._ipas_odoo_value(jsonb, text) from public, anon, authenticated;
revoke all on function public._ipas_change_note(jsonb, jsonb, timestamptz) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Refresh
-- ------------------------------------------------------------------------------

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
    raise exception 'ipas_record_odoo_copy: IPAS % not found', p_ipas_id using errcode = 'P0002';
  end if;
  if upper(btrim(p_odoo_copy->'po'->>'name')) is distinct from v_row.po_number then
    raise exception 'ipas_record_odoo_copy: the Odoo copy is for %, not %',
      coalesce(p_odoo_copy->'po'->>'name', 'no PO'), v_row.po_number
      using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_record_odoo_copy: % is cancelled and keeps the copy it had', v_row.number
      using errcode = '55000';
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

comment on function public.ipas_record_odoo_copy(uuid, jsonb) is
  '#243: stores a fresh Odoo copy of the IPAS''s PO (read by the client from odoo-po-ipas), with its fetch time and a change note against the previous copy. Fills a blank contact and P.I # from Odoo. When lines or the total changed it clears the live section 1 and 3 approvals ("PO changed in Odoo") and returns the preparers to notify. On a filed IPAS it stores nothing and only sets odoo_changed_since_filing. Returns { ipas, changed, filed, approvals_cleared[], preparer_ids[] }.';

revoke all on function public.ipas_record_odoo_copy(uuid, jsonb) from public, anon;
grant execute on function public.ipas_record_odoo_copy(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------------------
-- Overrides
-- ------------------------------------------------------------------------------

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
    raise exception 'ipas_override_field: IPAS % not found', p_ipas_id using errcode = 'P0002';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_override_field: % is filed; a Super Admin reopens it first', v_row.number using errcode = '55000';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_override_field: % is cancelled', v_row.number using errcode = '55000';
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

comment on function public.ipas_override_field(uuid, text, text) is
  '#243: Purchasing overrides Entity (entity), Source Doc. (source_doc) or Analytic Dist. (analytic) on an open IPAS. The override survives every refresh until reset. Any other field is refused. Writes an "override_set" event.';

revoke all on function public.ipas_override_field(uuid, text, text) from public, anon;
grant execute on function public.ipas_override_field(uuid, text, text) to authenticated;

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
    raise exception 'ipas_reset_override: IPAS % not found', p_ipas_id using errcode = 'P0002';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_reset_override: % is filed; a Super Admin reopens it first', v_row.number using errcode = '55000';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_reset_override: % is cancelled', v_row.number using errcode = '55000';
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

comment on function public.ipas_reset_override(uuid, text) is
  '#243: resets an overridden field to Odoo''s value in one action. Writes an "override_reset" event; a field that isn''t overridden is left alone.';

revoke all on function public.ipas_reset_override(uuid, text) from public, anon;
grant execute on function public.ipas_reset_override(uuid, text) to authenticated;

-- ------------------------------------------------------------------------------
-- Typed header values
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
  v_contact text;
  v_pi text;
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
    if v_key not in ('supplier_contact', 'pi_number') then
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

  if v_contact is distinct from v_row.supplier_contact then
    v_changes := v_changes || jsonb_build_object('supplier_contact', jsonb_build_object('from', v_row.supplier_contact, 'to', v_contact));
  end if;
  if v_pi is distinct from v_row.pi_number then
    v_changes := v_changes || jsonb_build_object('pi_number', jsonb_build_object('from', v_row.pi_number, 'to', v_pi));
  end if;
  if v_changes = '{}'::jsonb then
    return v_row;
  end if;

  update public.ipas set supplier_contact = v_contact, pi_number = v_pi where id = v_row.id returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'header_changed', jsonb_build_object('fields', v_changes));

  return v_row;
end;
$$;

comment on function public.ipas_set_header(uuid, jsonb) is
  '#243: Purchasing types the supplier contact and P.I # on an open IPAS ({ supplier_contact, pi_number }; keys present are set, blank clears). A typed value is never overwritten by Odoo; a blank one fills from the next copy. Writes a "header_changed" event.';

revoke all on function public.ipas_set_header(uuid, jsonb) from public, anon;
grant execute on function public.ipas_set_header(uuid, jsonb) to authenticated;
