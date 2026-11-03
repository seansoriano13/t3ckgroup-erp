-- Ticket #834 (ADR 0041 / #800 / #815 / #727):
-- When an SOR is registered with products, or when its S0 is set/changed, ensure the S0 Evaluation
-- (costing matrix) immediately fills from the SOR's products.
-- 1. set_sales_reference: if a costing matrix exists when saving items, call costing_fill_from_sor.
-- 2. costing_open_matrix: if the SOR has products, call costing_fill_from_sor.
-- 3. costing_fill_from_sor: allow bypass when costing.bypass is 'on' or service_role, and restore
--    costing.bypass rather than unconditionally clearing it.

-- 1. costing_fill_from_sor (latest: 20261113130000_718_review_fixes.sql) -------------------------
create or replace function public.costing_fill_from_sor(p_opportunity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior_bypass text := current_setting('costing.bypass', true);
  v_actor  uuid := public.get_employee_id();
  v_matrix uuid;
  v_pos    integer;
  v_line   uuid;
  v_match  uuid;
  v_unit   text;
  v_added  integer := 0;
  v_left   jsonb := '[]'::jsonb;
  v_locked boolean;
  v_item   record;
begin
  if coalesce(v_prior_bypass, '') <> 'on' and coalesce(auth.role(), '') <> 'service_role' then
    if v_actor is null then
      raise exception 'costing_fill: sign in first' using errcode = '42501';
    end if;
    select m.id into v_matrix from public.costing_matrices m where m.opportunity_id = p_opportunity_id;
    if v_matrix is null then
      raise exception 'costing_fill: this SOR has no S0 Evaluation yet' using errcode = '22023';
    end if;
    if not (public.costing_can_read(p_opportunity_id)
            and (public.costing_in_band(p_opportunity_id, 'sales') or public.costing_in_band(p_opportunity_id, 'purchasing'))) then
      raise exception 'costing_fill: only Sales or Purchasing can fill the matrix from the SOR' using errcode = '42501';
    end if;
  else
    select m.id into v_matrix from public.costing_matrices m where m.opportunity_id = p_opportunity_id;
    if v_matrix is null then
      raise exception 'costing_fill: this SOR has no S0 Evaluation yet' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('costing_fill:' || v_matrix::text));
  perform set_config('costing.bypass', 'on', true);
  perform set_config('costing.s0_link', 'on', true);

  v_locked := exists (select 1 from public.costing_bid_decisions d
                       where d.matrix_id = v_matrix and d.cleared_at is null and d.verdict = 'go');

  select coalesce(max(l.position), 0) into v_pos from public.costing_tender_lines l where l.matrix_id = v_matrix;

  for v_item in
    select i.*
    from public.sales_opportunity_items i
    where i.opportunity_id = p_opportunity_id
      and not coalesce(i.removed_from_s0, false)
      and not exists (
        select 1 from public.costing_tender_lines l where l.matrix_id = v_matrix and l.sor_item_id = i.id
      )
    order by i.sort_order, i.created_at, i.id
  loop
    v_unit := nullif(btrim(coalesce(v_item.unit, '')), '');
    v_match := null;

    -- 1. A line that already holds this Odoo line id (its SOR line was replaced or is gone).
    if v_item.odoo_line_id is not null then
      select l.id into v_match
        from public.costing_tender_lines l
       where l.matrix_id = v_matrix
         and l.odoo_line_id = v_item.odoo_line_id
         and (l.sor_item_id is null
              or exists (select 1 from public.sales_opportunity_items o where o.id = l.sor_item_id and coalesce(o.removed_from_s0, false)))
       order by l.position, l.id
       limit 1;
    end if;

    -- 2. Else an unlinked typed line with the same Odoo product. Never by name.
    if v_match is null and v_item.odoo_product_id is not null then
      select l.id into v_match
        from public.costing_tender_lines l
       where l.matrix_id = v_matrix
         and l.source = 'typed'
         and l.sor_item_id is null
         and l.odoo_line_id is null
         and l.odoo_product_id = v_item.odoo_product_id
       order by l.position, l.id
       limit 1;
    end if;

    if v_match is not null then
      update public.costing_tender_lines
         set sor_item_id = v_item.id,
             odoo_line_id = v_item.odoo_line_id,
             source = 'sor_line',
             odoo_product_id = coalesce(v_item.odoo_product_id, odoo_product_id),
             sor_line_snapshot = jsonb_build_object('name', v_item.product_name, 'quantity', v_item.quantity, 'unit', v_unit)
       where id = v_match;
      continue;
    end if;

    -- 3. Else a new row. Adding a row is a change to the sheet, so a Go lock holds it back.
    if v_locked then
      v_left := v_left || jsonb_build_array(jsonb_build_object('id', v_item.id, 'name', v_item.product_name));
      continue;
    end if;
    v_pos := v_pos + 1;
    insert into public.costing_tender_lines (
      matrix_id, position, source, sor_item_id, odoo_line_id, odoo_product_id, tender_specification, unit, quantity, sor_line_snapshot, created_by
    ) values (
      v_matrix, v_pos, 'sor_line', v_item.id, v_item.odoo_line_id, v_item.odoo_product_id, v_item.product_name, v_unit,
      case when v_item.quantity > 0 then v_item.quantity else 1 end,
      jsonb_build_object('name', v_item.product_name, 'quantity', v_item.quantity, 'unit', v_unit),
      v_actor
    )
    returning id into v_line;

    -- A Component's quantity is for the whole line (its totals are unit x quantity), so the product
    -- carries the line's quantity.
    insert into public.costing_components (tender_line_id, position, name, quantity, unit, odoo_product_id)
    values (v_line, 1, v_item.product_name, case when v_item.quantity > 0 then v_item.quantity else 1 end, v_unit, v_item.odoo_product_id);

    v_added := v_added + 1;
  end loop;

  -- A line already linked picks up its S0 line's Odoo line id when it has none yet.
  update public.costing_tender_lines l
     set odoo_line_id = i.odoo_line_id
    from public.sales_opportunity_items i
   where l.matrix_id = v_matrix
     and i.id = l.sor_item_id
     and i.odoo_line_id is not null
     and l.odoo_line_id is null
     and not exists (select 1 from public.costing_tender_lines x where x.matrix_id = v_matrix and x.odoo_line_id = i.odoo_line_id);

  perform set_config('costing.s0_link', '', true);
  perform set_config('costing.bypass', coalesce(v_prior_bypass, ''), true);
  return jsonb_build_object('added', v_added, 'left_out', v_left);
end;
$$;

comment on function public.costing_fill_from_sor(uuid) is
  '#834: refresh from the S0: links each live S0 line or adds a row. Allows bypass when costing.bypass is on or service_role.';

revoke all on function public.costing_fill_from_sor(uuid) from public, anon;
grant execute on function public.costing_fill_from_sor(uuid) to authenticated;

-- 2. costing_open_matrix (latest: 20261113130000_718_review_fixes.sql) ----------------------------
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
                  format('You were added to %s to see its S0 Evaluation.', coalesce(v_label, 'a deal')),
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
      values (v_emp, v_actor, 'OPPORTUNITY_COSTING_INCHARGE_NEEDED', 'S0 Evaluation needs a Purchasing Incharge',
              format('The S0 Evaluation for %s opened with no Purchasing Incharge. Please name one.', coalesce(v_label, 'a deal')),
              p_opportunity_id::text);
    end loop;
  end if;

  -- #834: if the SOR has products, fill the matrix from the SOR.
  if exists (
    select 1 from public.sales_opportunity_items
     where opportunity_id = p_opportunity_id
       and not coalesce(removed_from_s0, false)
  ) then
    perform public.costing_fill_from_sor(p_opportunity_id);
  end if;

  perform set_config('costing.bypass', 'off', true);
  return v_id;
end;
$$;

revoke all on function public.costing_open_matrix(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.costing_open_matrix(uuid, jsonb) to service_role;

-- 3. set_sales_reference (latest: 20261118190000_800_review_s0_guard_and_clear.sql) --------------
create or replace function public.set_sales_reference(
  p_actor_email text,
  p_opportunity_id uuid,
  p_sales_reference text,
  p_reason text default null,
  p_odoo text default 'unreachable',
  p_items jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new text := upper(nullif(btrim(coalesce(p_sales_reference, '')), ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor uuid;
  v_opp public.sales_opportunities;
  v_lock text;
  v_super boolean;
  v_other record;
  v_state text;
  v_checked timestamptz;
  v_event text;
  v_content text;
  v_meta jsonb;
begin
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'set_sales_reference: not signed in' using errcode = '42501';
  end if;
  if p_odoo is null or p_odoo not in ('found', 'not_found', 'unreachable') then
    raise exception 'set_sales_reference: p_odoo must be found, not_found or unreachable' using errcode = '22023';
  end if;

  -- 1. Format ("S" then digits; SO123 is read as S123, as the app does).
  if v_new is not null then
    if v_new ~ '^SO[0-9]+$' then
      v_new := 'S' || substr(v_new, 3);
    end if;
    if v_new !~ '^S[0-9]+$' then
      raise exception 'Sales Reference must be the Odoo quotation number — "S" followed by digits, e.g. S01237.'
        using errcode = '22023', hint = 'format';
    end if;
  end if;

  -- Act as the caller the edge function authenticated.
  perform set_config('request.jwt.claims',
    jsonb_build_object('email', p_actor_email, 'role', 'authenticated')::text, true);
  v_actor := public.get_employee_id();
  if v_actor is null then
    raise exception 'set_sales_reference: not signed in' using errcode = '42501';
  end if;

  select * into v_opp from public.sales_opportunities
    where id = p_opportunity_id and coalesce(is_deleted, false) = false
    for update;
  if v_opp.id is null then
    raise exception 'That SOR could not be found.' using errcode = 'P0002', hint = 'not_found_sor';
  end if;

  -- Same value as now: nothing to do.
  if v_new is not distinct from v_opp.sales_reference then
    return jsonb_build_object(
      'sales_reference', v_opp.sales_reference,
      'odoo_state', v_opp.sales_reference_odoo_state,
      'checked_at', v_opp.sales_reference_checked_at
    );
  end if;

  -- 2 + 3. Permission and lock.
  v_super := public.is_super_admin();
  v_lock := public.sor_sales_reference_lock(v_opp.id);
  if not public.sor_can_edit_opportunity(v_opp.id) then
    raise exception 'You do not have permission to change this SOR''s S0.' using errcode = '42501', hint = 'forbidden';
  end if;
  if v_lock = 'locked' then
    if not v_super then
      raise exception 'This S0 is locked. Only a Super Admin can change it.' using errcode = '42501', hint = 'locked';
    end if;
    if v_reason is null then
      raise exception 'Say why the locked S0 is being changed.' using errcode = '22023', hint = 'reason_required';
    end if;
  end if;

  -- 4. Duplicates: any other SOR that is not deleted (Lost included). No bypass. The lock on the
  -- S0 value makes a second save of the same S0 wait for the first, then see its row.
  if v_new is not null then
    perform pg_advisory_xact_lock(hashtext('sales_reference:' || v_new));
    select o.id, o.project_title, o.client_name into v_other
      from public.sales_opportunities o
      where o.sales_reference = v_new
        and o.id <> v_opp.id
        and coalesce(o.is_deleted, false) = false
      order by o.created_at
      limit 1;
    if v_other.id is not null then
      raise exception '% is already on SOR "%" (%). One S0 per SOR.',
        v_new, v_other.project_title, v_other.client_name
        using errcode = '23505', hint = 'duplicate';
    end if;
  end if;

  -- 5. Odoo. Clearing needs no answer.
  if v_new is null then
    v_state := null;
    v_checked := null;
  elsif p_odoo = 'not_found' then
    raise exception 'Odoo has no %. Check the number.', v_new using errcode = '22023', hint = 'not_found';
  elsif p_odoo = 'found' then
    v_state := 'found';
    v_checked := now();
  else
    v_state := 'not_checked';
    v_checked := null;
  end if;

  v_event := case
    when v_lock = 'locked' then 'SALES_REFERENCE_OVERRIDDEN'
    when v_new is null then 'SALES_REFERENCE_CLEARED'
    when v_opp.sales_reference is null then 'SALES_REFERENCE_SET'
    else 'SALES_REFERENCE_CHANGED'
  end;

  perform set_config('app.sor_set_sales_reference', 'on', true);
  update public.sales_opportunities
     set sales_reference = v_new,
         sales_reference_odoo_state = v_state,
         sales_reference_checked_at = v_checked
   where id = v_opp.id;

  -- The Odoo lines, through the line-matching save (ADR 0041), when the edge function sent them.
  if p_items is not null then
    perform public.sor_replace_items(v_opp.id, p_items);
    -- #834: if a costing matrix exists, fill it from the SOR's products.
    if exists (select 1 from public.costing_matrices where opportunity_id = v_opp.id) then
      perform public.costing_fill_from_sor(v_opp.id);
    end if;
  elsif v_new is null or p_odoo = 'found' then
    -- Cleared, or an S0 Odoo has with no lines: the old S0's products are kept and marked, as
    -- the change preview (#818) says. Hand-typed lines stay.
    update public.sales_opportunity_items i
       set removed_from_s0 = true
     where i.opportunity_id = v_opp.id
       and i.odoo_line_id is not null
       and not i.removed_from_s0;
  end if;

  v_content := case v_event
    when 'SALES_REFERENCE_SET' then format('S0 set to %s', v_new)
    when 'SALES_REFERENCE_CLEARED' then format('S0 %s cleared', v_opp.sales_reference)
    when 'SALES_REFERENCE_OVERRIDDEN' then format('Locked S0 changed from %s to %s', v_opp.sales_reference, coalesce(v_new, '(none)'))
    else format('S0 changed from %s to %s', v_opp.sales_reference, v_new)
  end || coalesce(' — ' || v_reason, '');
  v_meta := jsonb_build_object(
    'event', v_event,
    'old', v_opp.sales_reference,
    'new', v_new,
    'reason', v_reason,
    'employeeId', v_actor
  );

  insert into public.sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
  values (v_opp.id, v_actor, 'SYSTEM', v_content, v_meta);
  insert into public.system_audit_logs (author_id, entity_type, entity_id, content, type, metadata)
  values (v_actor, 'OPPORTUNITY', v_opp.id::text, v_content, 'SYSTEM', v_meta);

  return jsonb_build_object('sales_reference', v_new, 'odoo_state', v_state, 'checked_at', v_checked);
end;
$$;

revoke all on function public.set_sales_reference(text, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_sales_reference(text, uuid, text, text, text, jsonb) to service_role;
