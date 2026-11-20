-- #1129 (spec #1123, tracker D3, Decision 5): IPAS and TG03 numbers without gaps from refused saves.
--
-- A sequence value is never handed back when a statement fails, so a save that draws a number
-- and is then refused leaves a hole in the series. Two fixes, both "refuse before drawing":
--
--   * transmittal_create checks every line (kind, quantity, description, unit, whole units, the
--     IPAS and its P0 line, the SOR) and the Product / Reference picks BEFORE it inserts the
--     header, so a refused create never takes a TG03 number. The same checks still run in
--     _transmittal_write_children, which stays the one writer.
--   * ipas_raise_from_odoo takes an advisory lock on the PO number before it looks for a live
--     IPAS, so a raise that loses a race waits, then is refused before an IPAS number is drawn.
--
-- A gap from a crash is accepted.
--
-- Bodies: transmittal_create from 20261015100000_transmittals_tracer.sql and ipas_raise_from_odoo
-- from 20261023210000_refusal_codes.sql, the latest definitions.

create or replace function public._transmittal_precheck(p_product_ids uuid[], p_reference_ids uuid[], p_lines jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_position integer := 0;
  v_kind text;
  v_quantity numeric;
  v_unit text;
  v_ipas public.ipas;
  v_po_line jsonb;
  v_opportunity uuid;
  v_products uuid[] := coalesce(p_product_ids, '{}'::uuid[]);
  v_references uuid[] := coalesce(p_reference_ids, '{}'::uuid[]);
  c_whole_units constant text := '^(pcs?|pieces?|units?|sets?|pairs?|kits?)$';
begin
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

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as value loop
    v_position := v_position + 1;
    v_kind := nullif(btrim(v_line->>'kind'), '');
    v_quantity := nullif(v_line->>'quantity', '')::numeric;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'transmittal: line % needs a quantity above zero', v_position using errcode = '22023';
    end if;

    if v_kind = 'po_line' then
      select * into v_ipas from public.ipas i where i.id = nullif(v_line->>'ipas_id', '')::uuid;
      if not found or v_ipas.state = 'cancelled' then
        raise exception 'transmittal: line % names an IPAS that isn''t live', v_position using errcode = '22023';
      end if;
      select l into v_po_line
        from jsonb_array_elements(coalesce(v_ipas.odoo_copy -> 'lines', '[]'::jsonb)) as l
       where (l->>'line_id')::integer = (v_line->>'odoo_po_line_id')::integer
       limit 1;
      if v_po_line is null then
        raise exception 'transmittal: line % isn''t on % Odoo copy', v_position, v_ipas.po_number using errcode = '22023';
      end if;
      v_unit := nullif(btrim(v_po_line->>'unit'), '');
      if v_quantity <> trunc(v_quantity) and lower(coalesce(v_unit, '')) ~ c_whole_units then
        raise exception 'transmittal: line % counts whole % only', v_position, v_unit using errcode = '22023';
      end if;
      v_opportunity := nullif(v_line->>'opportunity_id', '')::uuid;
      if v_opportunity is not null and not exists (
           select 1 from public.sales_opportunities o where o.id = v_opportunity and not coalesce(o.is_deleted, false)
         ) then
        raise exception 'transmittal: line % names an SOR that no longer exists', v_position using errcode = '22023';
      end if;

    elsif v_kind = 'typed' then
      if nullif(btrim(v_line->>'description'), '') is null then
        raise exception 'transmittal: line % needs a description', v_position using errcode = '22023';
      end if;
      if nullif(btrim(v_line->>'unit'), '') is null then
        raise exception 'transmittal: line % needs a unit', v_position using errcode = '22023';
      end if;
      if v_quantity <> trunc(v_quantity) and lower(btrim(v_line->>'unit')) ~ c_whole_units then
        raise exception 'transmittal: line % counts whole % only', v_position, btrim(v_line->>'unit') using errcode = '22023';
      end if;
      v_opportunity := nullif(v_line->>'opportunity_id', '')::uuid;
      if v_opportunity is not null and not exists (
           select 1 from public.sales_opportunities o where o.id = v_opportunity and not coalesce(o.is_deleted, false)
         ) then
        raise exception 'transmittal: line % names an SOR that no longer exists', v_position using errcode = '22023';
      end if;

    else
      raise exception 'transmittal: line % has no kind (po_line or typed)', v_position using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function public._transmittal_precheck(uuid[], uuid[], jsonb) from public, anon, authenticated;

create or replace function public.transmittal_create(
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
  v_header jsonb;
  v_row public.transmittals;
  v_warnings jsonb;
begin
  if v_actor is null then
    raise exception 'transmittal_create: not signed in' using errcode = '42501';
  end if;
  if not public.transmittal_can_prepare() then
    raise exception 'transmittal_create: only Purchasing, or the Warehouse or Logistics list, raises a Transmittal'
      using errcode = '42501';
  end if;

  v_header := public._transmittal_clean_header(coalesce(p_fields, '{}'::jsonb));

  -- #1129: every refusal comes before the insert, which is what draws the TG03 number.
  perform public._transmittal_precheck(p_product_ids, p_reference_ids, p_lines);

  insert into public.transmittals (
    origin, origin_other, check_warehouse, check_technical, check_other, priority, entity,
    product_other, item_location_id, prepared_by
  ) values (
    v_header->>'origin',
    v_header->>'origin_other',
    (v_header->>'check_warehouse')::boolean,
    (v_header->>'check_technical')::boolean,
    v_header->>'check_other',
    v_header->>'priority',
    v_header->>'entity',
    v_header->>'product_other',
    nullif(v_header->>'item_location_id', '')::uuid,
    v_actor
  )
  returning * into v_row;

  v_warnings := public._transmittal_write_children(v_row.id, p_product_ids, p_reference_ids, p_lines);

  perform public._transmittal_event(v_row.id, v_actor, 'created', jsonb_build_object(
    'number', v_row.number,
    'lines', coalesce(jsonb_array_length(coalesce(p_lines, '[]'::jsonb)), 0)
  ));

  return jsonb_build_object('id', v_row.id, 'number', v_row.number, 'warnings', v_warnings);
end;
$$;

comment on function public.transmittal_create(jsonb, uuid[], uuid[], jsonb) is
  '#252, #1129: a preparer raises a draft TG03 slip with its header, products, references and lines. Checks the lines first, so a refused create takes no number. Returns { id, number, warnings[] }.';

revoke all on function public.transmittal_create(jsonb, uuid[], uuid[], jsonb) from public, anon;
grant execute on function public.transmittal_create(jsonb, uuid[], uuid[], jsonb) to authenticated;

-- ipas_raise_from_odoo: the advisory lock is the only change. Same key as the #1128 insert trigger, which
-- locks too late: the number default is drawn before a BEFORE INSERT trigger runs.
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

  -- #1129: one raise per PO at a time. The loser waits here, then finds the winner's IPAS and is
  -- refused before the insert draws an IPAS number.
  perform pg_advisory_xact_lock(hashtextextended('ipas_live_po:' || v_po, 0));

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
