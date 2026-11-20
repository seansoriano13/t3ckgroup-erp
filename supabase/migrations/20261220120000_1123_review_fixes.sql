-- Review fixes for spec #1123. Only function bodies; nothing is dropped or moved. Idempotent.
--
--   * One line check. _transmittal_precheck (#1129) is the one place a Transmittal's picks and lines are
--     checked; _transmittal_write_children (#1126) now calls it first and only writes, instead of
--     keeping its own copy of every refusal. The whole-number-unit test, which sat twice in each of the
--     two bodies, is now said once in precheck.
--   * ipas_payments_waiting_for_pesos: the filing question reads the same list the database refuses on
--     (_ipas_payments_missing_pesos), not a second rule in JS.

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

    elsif v_kind = 'typed' then
      if nullif(btrim(v_line->>'description'), '') is null then
        raise exception 'transmittal: line % needs a description', v_position using errcode = '22023';
      end if;
      v_unit := nullif(btrim(v_line->>'unit'), '');
      if v_unit is null then
        raise exception 'transmittal: line % needs a unit', v_position using errcode = '22023';
      end if;

    else
      raise exception 'transmittal: line % has no kind (po_line or typed)', v_position using errcode = '22023';
    end if;

    -- Said once for both kinds: a unit counted in whole things refuses a decimal quantity.
    if v_quantity <> trunc(v_quantity) and lower(coalesce(v_unit, '')) ~ c_whole_units then
      raise exception 'transmittal: line % counts whole % only', v_position, v_unit using errcode = '22023';
    end if;

    v_opportunity := nullif(v_line->>'opportunity_id', '')::uuid;
    if v_opportunity is not null and not exists (
         select 1 from public.sales_opportunities o where o.id = v_opportunity and not coalesce(o.is_deleted, false)
       ) then
      raise exception 'transmittal: line % names an SOR that no longer exists', v_position using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function public._transmittal_precheck(uuid[], uuid[], jsonb) from public, anon, authenticated;

-- The one writer. Every refusal comes from _transmittal_precheck; what is left here is the writing,
-- the entity warning and the over-claim warnings.
create or replace function public._transmittal_write_children(p_transmittal_id uuid, p_product_ids uuid[], p_reference_ids uuid[], p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entity text;
  v_line jsonb;
  v_position integer := 0;
  v_ipas public.ipas;
  v_po_line jsonb;
  v_ipas_entity text;
  v_quantity numeric;
  v_opportunity uuid;
  v_sor_count integer;
  v_warnings jsonb := '[]'::jsonb;
begin
  perform public._transmittal_precheck(p_product_ids, p_reference_ids, p_lines);

  select t.entity into v_entity from public.transmittals t where t.id = p_transmittal_id;

  delete from public.transmittal_lines where transmittal_id = p_transmittal_id;
  delete from public.transmittal_products where transmittal_id = p_transmittal_id;
  delete from public.transmittal_references where transmittal_id = p_transmittal_id;

  insert into public.transmittal_products (transmittal_id, option_id)
  select p_transmittal_id, x from unnest(coalesce(p_product_ids, '{}'::uuid[])) as x;

  insert into public.transmittal_references (transmittal_id, option_id)
  select p_transmittal_id, x from unnest(coalesce(p_reference_ids, '{}'::uuid[])) as x;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as value loop
    v_position := v_position + 1;
    v_quantity := (v_line->>'quantity')::numeric;
    v_opportunity := nullif(v_line->>'opportunity_id', '')::uuid;

    if nullif(btrim(v_line->>'kind'), '') = 'po_line' then
      select * into v_ipas from public.ipas i where i.id = nullif(v_line->>'ipas_id', '')::uuid;
      select l into v_po_line
        from jsonb_array_elements(coalesce(v_ipas.odoo_copy -> 'lines', '[]'::jsonb)) as l
       where (l->>'line_id')::integer = (v_line->>'odoo_po_line_id')::integer
       limit 1;

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

      if v_opportunity is null then
        select count(*) into v_sor_count from public.ipas_sors s where s.ipas_id = v_ipas.id;
        if v_sor_count = 1 then
          select s.opportunity_id into v_opportunity from public.ipas_sors s where s.ipas_id = v_ipas.id;
        end if;
      end if;

      insert into public.transmittal_lines (
        transmittal_id, position, kind, ipas_id, odoo_po_line_id, description, quantity, unit,
        opportunity_id, serial_numbers, box_quantity, over_claim_remark
      ) values (
        p_transmittal_id, v_position, 'po_line', v_ipas.id, (v_po_line->>'line_id')::integer,
        coalesce(nullif(btrim(v_po_line->>'name'), ''), 'P0 line ' || (v_po_line->>'line_id')),
        v_quantity,
        nullif(btrim(v_po_line->>'unit'), ''),
        v_opportunity,
        nullif(btrim(v_line->>'serial_numbers'), ''),
        nullif(btrim(v_line->>'box_quantity'), ''),
        nullif(btrim(v_line->>'over_claim_remark'), '')
      );
    else
      insert into public.transmittal_lines (
        transmittal_id, position, kind, description, quantity, unit,
        opportunity_id, serial_numbers, box_quantity
      ) values (
        p_transmittal_id, v_position, 'typed', btrim(v_line->>'description'), v_quantity,
        btrim(v_line->>'unit'), v_opportunity,
        nullif(btrim(v_line->>'serial_numbers'), ''),
        nullif(btrim(v_line->>'box_quantity'), '')
      );
    end if;
  end loop;

  return v_warnings || public._transmittal_over_claims(p_transmittal_id);
end;
$function$
;

-- The filing question's list (#1124): the payments Filing waits on, one phrase each ("Down payment of
-- USD 500.00 on Nov 19, 2026"), read from the same function ipas_sign refuses with. Empty on a peso IPAS.
create or replace function public.ipas_payments_waiting_for_pesos(p_ipas_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_missing text;
begin
  if not public.ipas_can_read() then
    raise exception 'ipas_payments_waiting_for_pesos: you may not read IPAS' using errcode = '42501';
  end if;
  v_missing := public._ipas_payments_missing_pesos(p_ipas_id);
  if v_missing is null then
    return '{}'::text[];
  end if;
  return string_to_array(v_missing, '; ');
end;
$$;

comment on function public.ipas_payments_waiting_for_pesos(uuid) is
  '#1124: the foreign-currency payments whose pesos are blank, as phrases; what ipas_sign refuses Approve and file on.';

revoke all on function public.ipas_payments_waiting_for_pesos(uuid) from public, anon;
grant execute on function public.ipas_payments_waiting_for_pesos(uuid) to authenticated;
