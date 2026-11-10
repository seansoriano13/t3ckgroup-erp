-- Gaps left by spec #251 (2026-10-16).
--
-- 1. Check by can decline its stored signature (spec #251: "a stored
--    signature prints as the signature", with signature_declined per
--    signatory). Each Check by slot gets a declined flag; the slot's own
--    signer sets or clears it with transmittal_check_signature, also after
--    the second Check by has closed the slip. Signing a slot clears its flag,
--    so a slot undone and signed again starts with the signature applied.
-- 2. The "different company" warning compared the slip's Company with the
--    IPAS's entity exactly. The Company is now picked from the company
--    register ("T3CK Trading") while Odoo may spell it "T3ck Trading", so the
--    names compare ignoring case and repeated spaces.

alter table public.transmittals add column if not exists check_by_first_signature_declined boolean not null default false;
alter table public.transmittals add column if not exists check_by_second_signature_declined boolean not null default false;

create or replace function public.transmittals_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'transmittal: a Transmittal is never deleted; cancel it instead' using errcode = '42501';
  end if;

  -- transmittal_undo_signature clears a signature, and reopens a closed slip when it clears a Check by.
  if coalesce(current_setting('app.transmittal_undo', true), '') = 'on' then
    return new;
  end if;

  -- A Check by signer may decline or re-apply their stored signature on a
  -- closed slip: nothing else about the row may change.
  if old.state = 'closed'
     and (to_jsonb(new) - 'check_by_first_signature_declined' - 'check_by_second_signature_declined')
       = (to_jsonb(old) - 'check_by_first_signature_declined' - 'check_by_second_signature_declined') then
    return new;
  end if;

  if old.state in ('closed', 'cancelled') then
    raise exception 'transmittal: % is %, and can''t change', old.number, old.state using errcode = '42501';
  end if;

  if new.number is distinct from old.number
     or new.prepared_by is distinct from old.prepared_by
     or new.prepared_on is distinct from old.prepared_on then
    raise exception 'transmittal: the number, preparer and date of % can''t change', old.number using errcode = '42501';
  end if;

  if old.state <> 'draft' and (
       new.origin, new.origin_other, new.check_warehouse, new.check_technical, new.check_other,
       new.priority, new.entity, new.product_other, new.item_location_id
     ) is distinct from (
       old.origin, old.origin_other, old.check_warehouse, old.check_technical, old.check_other,
       old.priority, old.entity, old.product_other, old.item_location_id
     ) then
    raise exception 'transmittal: % is submitted; its header is fixed', old.number using errcode = '42501';
  end if;

  return new;
end;
$$;

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
    raise exception 'transmittal_check: that Transmittal doesn''t exist' using errcode = 'P0002';
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
    raise exception 'transmittal_check_signature: that Transmittal doesn''t exist' using errcode = 'P0002';
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

revoke all on function public.transmittal_check_signature(uuid, integer, boolean) from public, anon;
grant execute on function public.transmittal_check_signature(uuid, integer, boolean) to authenticated;

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
        raise exception 'transmittal: line % names an IPAS that isn''t live', v_position using errcode = 'P0002';
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
        raise exception 'transmittal: line % names an SOR that no longer exists', v_position using errcode = 'P0002';
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
        raise exception 'transmittal: line % names an SOR that no longer exists', v_position using errcode = 'P0002';
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
