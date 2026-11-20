-- #1126 (spec #1123, tracker B1 + B3): a Transmittal line shows what is left of its P0 line,
-- and a slip that carries more than is left gets a warning and asks for a remark.
--
--   * transmittal_pickable_po_lines / transmittal_ipas_po_lines return "left": the P0 quantity
--     less what live (not cancelled) slips carry, a line rated NA at its last check (Warehouse
--     or Technical) counting as not delivered. Never below zero.
--   * _transmittal_write_children (so transmittal_create and transmittal_update_draft) and
--     transmittal_submit return an 'over_claim' warning, not an error, when a slip carries more
--     than a line has left. An NA replacement therefore still goes on a new slip. The remark the
--     form asks for is kept on the line (over_claim_remark).
--   * A unit counted in whole things (pc, Unit, Set, Pair, Kit) refuses a decimal quantity.
--     Measured units (m, kg, L) and any unit not named here still take decimals.
--
-- Bodies: _transmittal_write_children from 20261118110100_798_review_p0_wording.sql and
-- transmittal_submit from 20261023210000_refusal_codes.sql, the latest definitions.

alter table public.transmittal_lines add column if not exists over_claim_remark text;
comment on column public.transmittal_lines.over_claim_remark is
  '#1126: why the line carries more than its P0 line had left when the slip was raised (an NA replacement, for one).';

-- What a P0 line has left, not counting slip p_exclude (the slip being written).
create or replace function public._transmittal_po_line_left(p_ipas_id uuid, p_line_id integer, p_exclude uuid default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select nullif(l->>'quantity', '')::numeric - coalesce((
    select sum(tl.quantity)
      from public.transmittal_lines tl
      join public.transmittals t on t.id = tl.transmittal_id
     where tl.ipas_id = i.id
       and tl.odoo_po_line_id = p_line_id
       and t.state <> 'cancelled'
       and (p_exclude is null or t.id <> p_exclude)
       and tl.wh_rating is distinct from 'na'
       and tl.tech_rating is distinct from 'na'
  ), 0)
  from public.ipas i
  cross join lateral jsonb_array_elements(coalesce(i.odoo_copy -> 'lines', '[]'::jsonb)) as l
 where i.id = p_ipas_id
   and (l->>'line_id')::integer = p_line_id
 limit 1;
$$;

revoke all on function public._transmittal_po_line_left(uuid, integer, uuid) from public, anon, authenticated;

-- The over-claim warnings of a written slip: one per line whose P0 line has less left than the slip carries.
create or replace function public._transmittal_over_claims(p_transmittal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select tl.position, tl.ipas_id, tl.odoo_po_line_id, tl.quantity,
           coalesce(length(btrim(tl.over_claim_remark)) > 0, false) as has_remark,
           sum(tl.quantity) over (partition by tl.ipas_id, tl.odoo_po_line_id) as carrying,
           public._transmittal_po_line_left(tl.ipas_id, tl.odoo_po_line_id, p_transmittal_id) as po_left
      from public.transmittal_lines tl
     where tl.transmittal_id = p_transmittal_id
       and tl.kind = 'po_line'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'kind', 'over_claim',
      'position', m.position,
      'po_number', i.po_number,
      'left', greatest(m.po_left, 0),
      'carrying', m.carrying,
      'more', m.carrying - greatest(m.po_left, 0),
      'has_remark', m.has_remark
    ) order by m.position), '[]'::jsonb)
    from mine m
    join public.ipas i on i.id = m.ipas_id
   where m.po_left is not null
     and m.carrying > greatest(m.po_left, 0);
$$;

revoke all on function public._transmittal_over_claims(uuid) from public, anon, authenticated;

-- The pickers: same columns as before plus "left".
drop function if exists public.transmittal_pickable_po_lines(text);
create function public.transmittal_pickable_po_lines(p_search text default null)
returns table (
  ipas_id uuid,
  ipas_number text,
  po_number text,
  odoo_po_line_id integer,
  product_name text,
  quantity numeric,
  unit text,
  entity text,
  sors jsonb,
  "left" numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.transmittal_can_prepare() then
    raise exception 'transmittal_pickable_po_lines: only a Transmittal preparer picks PO lines' using errcode = '42501';
  end if;

  return query
  select
    i.id,
    i.number,
    i.po_number,
    (l->>'line_id')::integer,
    nullif(btrim(l->>'name'), ''),
    nullif(l->>'quantity', '')::numeric,
    nullif(btrim(l->>'unit'), ''),
    coalesce(nullif(btrim(i.entity_override), ''), nullif(btrim(i.odoo_copy #>> '{po,company}'), '')),
    coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.id, 'sales_reference', o.sales_reference, 'project_title', o.project_title
        ) order by o.sales_reference)
        from public.ipas_sors s
        join public.sales_opportunities o on o.id = s.opportunity_id
       where s.ipas_id = i.id
    ), '[]'::jsonb),
    greatest(public._transmittal_po_line_left(i.id, (l->>'line_id')::integer), 0)
  from public.ipas i
  cross join lateral jsonb_array_elements(coalesce(i.odoo_copy -> 'lines', '[]'::jsonb)) as l
  where i.state <> 'cancelled'
    and (
      nullif(btrim(p_search), '') is null
      or i.po_number ilike '%' || btrim(p_search) || '%'
      or (l->>'name') ilike '%' || btrim(p_search) || '%'
    )
  order by i.po_number, (l->>'line_id')::integer
  limit 200;
end;
$$;

comment on function public.transmittal_pickable_po_lines(text) is
  '#252, #1126: the P0 lines of live IPAS a preparer may put on a slip, with what each has left. Never returns a price, supplier or bank column.';

revoke all on function public.transmittal_pickable_po_lines(text) from public, anon;
grant execute on function public.transmittal_pickable_po_lines(text) to authenticated;

drop function if exists public.transmittal_ipas_po_lines(text);
create function public.transmittal_ipas_po_lines(p_ipas_number text)
returns table (
  ipas_id uuid,
  ipas_number text,
  po_number text,
  odoo_po_line_id integer,
  product_name text,
  quantity numeric,
  unit text,
  entity text,
  sors jsonb,
  "left" numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ipas public.ipas%rowtype;
begin
  if not public.transmittal_can_prepare() then
    raise exception 'transmittal_ipas_po_lines: only a Transmittal preparer picks PO lines' using errcode = '42501';
  end if;

  select * into v_ipas
    from public.ipas i
   where lower(btrim(i.number)) = lower(btrim(coalesce(p_ipas_number, '')))
     and i.state <> 'cancelled';
  if not found then
    raise exception 'transmittal_ipas_po_lines: that IPAS doesn''t exist or is cancelled' using errcode = '22023';
  end if;

  return query
  select
    v_ipas.id,
    v_ipas.number,
    v_ipas.po_number,
    (l->>'line_id')::integer,
    nullif(btrim(l->>'name'), ''),
    nullif(l->>'quantity', '')::numeric,
    nullif(btrim(l->>'unit'), ''),
    coalesce(nullif(btrim(v_ipas.entity_override), ''), nullif(btrim(v_ipas.odoo_copy #>> '{po,company}'), '')),
    coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.id, 'sales_reference', o.sales_reference, 'project_title', o.project_title
        ) order by o.sales_reference)
        from public.ipas_sors s
        join public.sales_opportunities o on o.id = s.opportunity_id
       where s.ipas_id = v_ipas.id
    ), '[]'::jsonb),
    greatest(public._transmittal_po_line_left(v_ipas.id, (l->>'line_id')::integer), 0)
  from jsonb_array_elements(coalesce(v_ipas.odoo_copy -> 'lines', '[]'::jsonb)) as l
  order by (l->>'line_id')::integer;
end;
$$;

comment on function public.transmittal_ipas_po_lines(text) is
  '#725, #1126: every P0 line of one live IPAS, by IPAS number, with what each has left. Never returns a price, supplier or bank column.';

revoke all on function public.transmittal_ipas_po_lines(text) from public, anon;
grant execute on function public.transmittal_ipas_po_lines(text) to authenticated;

-- _transmittal_write_children: keeps the remark, refuses a decimal on a whole-number unit, and adds
-- the over-claim warnings after the lines are written.
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
  v_unit text;
  v_opportunity uuid;
  v_sor_count integer;
  v_warnings jsonb := '[]'::jsonb;
  v_products uuid[];
  v_references uuid[];
  c_whole_units constant text := '^(pcs?|pieces?|units?|sets?|pairs?|kits?)$';
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

      v_unit := nullif(btrim(v_po_line->>'unit'), '');
      if v_quantity <> trunc(v_quantity) and lower(coalesce(v_unit, '')) ~ c_whole_units then
        raise exception 'transmittal: line % counts whole % only', v_position, v_unit using errcode = '22023';
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
        opportunity_id, serial_numbers, box_quantity, over_claim_remark
      ) values (
        p_transmittal_id, v_position, 'po_line', v_ipas.id, (v_po_line->>'line_id')::integer,
        coalesce(nullif(btrim(v_po_line->>'name'), ''), 'P0 line ' || (v_po_line->>'line_id')),
        v_quantity,
        v_unit,
        v_opportunity,
        nullif(btrim(v_line->>'serial_numbers'), ''),
        nullif(btrim(v_line->>'box_quantity'), ''),
        nullif(btrim(v_line->>'over_claim_remark'), '')
      );

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

  return v_warnings || public._transmittal_over_claims(p_transmittal_id);
end;
$function$
;

-- transmittal_submit: the same, plus the over-claim warnings.
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
    'warnings', public._transmittal_over_claims(p_transmittal_id),
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
