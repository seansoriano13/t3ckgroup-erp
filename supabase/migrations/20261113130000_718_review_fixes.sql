-- Spec #718 review fixes (2026111313).
--
-- 1. "S0 Evaluation" in the text the database writes (story 1: called that on every screen, tab, print and notice):
--    refusal messages, notices and history lines that still said "Costing Matrix". Each function below is
--    redefined from its latest definition; only that text changes.
-- 2. #727: Refresh from the S0 says which S0 lines it left out under a Go lock, not only how many it added.
-- 3. #730 / #724: the "buying opens at" refusal of purchase_request_item_attach_po carries the hint
--    'buying_not_open' (the repo's refusal code, like 'odoo_not_found'), so no caller reads the message text.
-- 4. #724: flow_stage_set_buying_opens does the clear-then-set of "Buying opens here" in one transaction.

-- 1. Text only ---------------------------------------------------------------------------------

-- _purchase_request_item_added (latest: 20261018150000_costing_purchase_request_items.sql)
create or replace function public._purchase_request_item_added(p_item public.purchase_request_items)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount text := trim_scale(p_item.quantity)::text || coalesce(' ' || nullif(btrim(p_item.unit), ''), '');
begin
  insert into public.purchase_request_messages (request_id, author_id, content, metadata)
  values (
    p_item.request_id,
    p_item.requested_by,
    case p_item.source
      when 'sor_line' then format('Requested %s × %s, from the SOR''s Product List.', p_item.name, v_amount)
      when 'component' then format('Requested %s × %s, from the S0 Evaluation.', p_item.name, v_amount)
      else format('Requested a new product: %s × %s.', p_item.name, v_amount)
    end,
    jsonb_build_object('event', 'item_added', 'item_id', p_item.id, 'source', p_item.source)
  );

  update public.purchase_requests set updated_at = now() where id = p_item.request_id;
end;
$$;

-- costing_matrix_page (latest: 20261102180000_costing_open_review_fixes.sql)
create or replace function public.costing_matrix_page()
returns table (
  opportunity_id uuid,
  sor_code text,
  sales_reference text,
  project_title text,
  stage text,
  entities text[],
  final_offer_total numeric,
  final_acquire_total numeric,
  landed_cost_total numeric,
  bought_final_acquire_total numeric,
  items_bought integer,
  items_total integer,
  ipas_short boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- Super Admins and the list read every SOR; anyone else, the SORs they are open on.
  v_all boolean := coalesce(public.is_super_admin(), false) or public.costing_on_list('final_acquire');
begin
  if public.get_employee_id() is null then
    raise exception 'costing_matrix_page: not signed in' using errcode = '42501';
  end if;
  if not (v_all or public.costing_is_open_anywhere()) then
    raise exception 'costing_matrix_page: only Super Admins, Purchasing, the Deal Team and the Final Acquire list read the S0 Evaluation page'
      using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.sor_code,
    o.sales_reference,
    o.project_title,
    fs.name,
    coalesce(ent.names, '{}'::text[]),
    offer.total,
    acquire.total,
    lc.landed,
    lc.bought_acquire,
    lc.bought,
    lc.total_items,
    (shortage.open_short or lc.provisional)
  from public.costing_matrices m
  join public.sales_opportunities o on o.id = m.opportunity_id
  left join public.flow_stages fs on fs.id = o.flow_stage_id
  cross join lateral (
    select case when count(*) > 0 and bool_and(p.final_offer_unit is not null)
                then sum(round(p.final_offer_unit * t.quantity, 2)) end as total
    from public.costing_tender_lines t
    left join public.costing_tender_line_prices p on p.tender_line_id = t.id
    where t.matrix_id = m.id
  ) offer
  cross join lateral (
    select case when count(*) > 0 and bool_and(x.fa is not null)
                then sum(round(x.fa * x.q, 2)) end as total
    from (
      select cc.final_acquire_unit as fa, c.quantity as q
      from public.costing_components c
      join public.costing_tender_lines t on t.id = c.tender_line_id
      left join public.costing_component_costs cc on cc.component_id = c.id
      where t.matrix_id = m.id
      union all
      select r.final_acquire_unit, r.quantity
      from public.costing_cost_rows r
      where r.matrix_id = m.id
    ) x
  ) acquire
  cross join lateral (
    select
      count(*)::integer as total_items,
      (count(*) filter (where l.total_php is not null))::integer as bought,
      -- Each Component's Landed Cost is rounded to the centavo before it is added, as the SOR summary does.
      coalesce(sum(round(l.total_php, 2)) filter (where l.total_php is not null), 0) as landed,
      case when coalesce(bool_and(l.total_php is null or cc.final_acquire_unit is not null), true)
           then coalesce(sum(round(cc.final_acquire_unit * c.quantity, 2)) filter (where l.total_php is not null), 0)
      end as bought_acquire,
      coalesce(bool_or(l.total_php is not null and l.mark is distinct from 'final'), false) as provisional
    from public.costing_components c
    join public.costing_tender_lines t on t.id = c.tender_line_id
    left join public.costing_component_costs cc on cc.component_id = c.id
    left join public.costing_landed_costs(o.id) l on l.component_id = c.id
    where t.matrix_id = m.id
  ) lc
  cross join lateral (
    select exists (
      select 1
      from public.ipas i
      join public.ipas_sors s on s.ipas_id = i.id
      where s.opportunity_id = o.id
        and i.purpose = 'project'
        and i.state = 'open'
        and coalesce(i.computation_status, '') not in ('lc_odoo_done', 'costs_complete', 'checked')
    ) as open_short
  ) shortage
  cross join lateral (
    select array_agg(distinct e.name order by e.name) as names
    from (
      select nullif(btrim(coalesce(nullif(btrim(i.entity_override), ''), i.odoo_copy #>> '{po,company}')), '') as name
      from public.ipas i
      join public.ipas_sors s on s.ipas_id = i.id
      where s.opportunity_id = o.id
        and i.purpose = 'project'
        and i.state <> 'cancelled'
    ) e
    where e.name is not null
  ) ent
  where not coalesce(o.is_deleted, false)
    and not coalesce(o.is_scratch, false)
    and (v_all or public.costing_is_open(o.id))
  order by o.serial_no desc;
end;
$$;

-- costing_open_matrix (latest: 20261023210000_refusal_codes.sql)
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

  perform set_config('costing.bypass', 'off', true);
  return v_id;
end;
$$;

-- sor_open_costing_matrix (latest: 20261107110000_707_evaluation_of_specification_action.sql)
create or replace function public.sor_open_costing_matrix(
  p_run_id uuid,
  p_config jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_run public.sor_action_runs;
  v_action jsonb;
  v_opp public.sales_opportunities;
  v_visit uuid;
  v_matrix uuid;
begin
  if v_actor is null then
    raise exception 'sor_open_costing_matrix: not signed in' using errcode = '42501';
  end if;

  select * into v_run from public.sor_action_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'sor_open_costing_matrix: run % not found', p_run_id;
  end if;
  if v_run.costing_matrix_id is not null then
    raise exception 'sor_open_costing_matrix: run % already opened its matrix', p_run_id using errcode = '42501';
  end if;
  -- `created` with a decision is a Decider's Create, still to be built.
  if not (v_run.outcome = 'pending' or (v_run.outcome = 'created' and v_run.decided_by is not null)) then
    raise exception 'sor_open_costing_matrix: run % is not pending', p_run_id using errcode = '42501';
  end if;

  if not (
    public.sor_can_edit_opportunity(v_run.opportunity_id)
    or public.sor_access_level(v_run.opportunity_id) = 'full'
  ) then
    raise exception 'sor_open_costing_matrix: actor % lacks full access to opportunity %', v_actor, v_run.opportunity_id
      using errcode = '42501';
  end if;

  v_action := public._sor_action_run_saved_action(p_run_id);
  if v_action->>'kind' is null or v_action->>'kind' not in ('open_costing_matrix', 'evaluate_specification') then
    raise exception 'sor_open_costing_matrix: run % is not an Open S0 Evaluation or Evaluation of Specification action', p_run_id
      using errcode = '22023';
  end if;

  select * into v_opp from public.sales_opportunities where id = v_run.opportunity_id;

  v_visit := coalesce(
    v_run.stage_visit_id,
    (select v.id from public.sor_stage_visits v
      where v.opportunity_id = v_run.opportunity_id and v.left_at is null and v.undone_at is null
      order by v.sequence desc limit 1)
  );

  v_matrix := public.costing_open_matrix(
    v_run.opportunity_id,
    public._costing_action_open_args(v_opp, coalesce(v_action->'config', '{}'::jsonb), v_visit)
  );

  update public.sor_action_runs
  set outcome = 'created', costing_matrix_id = v_matrix
  where id = p_run_id;

  return v_matrix;
end;
$$;

-- costing_matrix_backfill (latest: 20261022130000_costing_matrix_backfill.sql)
create or replace function public.costing_matrix_backfill(p_dry_run boolean default true)
returns table (
  flow_id uuid,
  flow_name text,
  opportunity_id uuid,
  sales_reference text,
  current_stage text,
  mounting_stage text,
  reason text,
  outcome text,
  matrix_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sor record;
  v_opp public.sales_opportunities;
  v_visit uuid;
  v_hit record;
  v_matrix uuid;
  v_existing uuid;
  v_outcome text;
  v_mount_names text;
  v_reason text;
  v_at_stage boolean;
  v_has_edges boolean;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.is_super_admin()) then
    raise exception 'costing_matrix_backfill: service role or Super Admin only' using errcode = '42501';
  end if;

  for v_sor in
    select h.opportunity_id as opp_id, h.flow_id as fid
      from public._costing_backfill_hits() h
     group by h.opportunity_id, h.flow_id
     order by h.flow_id, h.opportunity_id
  loop
    select * into v_opp from public.sales_opportunities where id = v_sor.opp_id;
    select id into v_existing from public.costing_matrices m where m.opportunity_id = v_sor.opp_id;

    select string_agg(distinct format('"%s"', coalesce(st.name, h.mounting_stage_id::text)), ', '),
           bool_or(h.mounting_stage_id = v_opp.flow_stage_id),
           bool_and(h.has_edges)
      into v_mount_names, v_at_stage, v_has_edges
      from public._costing_backfill_hits() h
      left join public.flow_stages st on st.id = h.mounting_stage_id
     where h.opportunity_id = v_sor.opp_id;

    v_reason := case
      when v_at_stage then format('At the stage that mounts Open S0 Evaluation (%s)', v_mount_names)
      else format('Downstream of the stage that mounts Open S0 Evaluation (%s)', v_mount_names)
    end;

    if not v_has_edges then
      v_outcome := 'skipped_no_snapshot_edges';
      v_matrix := null;
      v_reason := format('Flow Snapshot has no edges, so the SOR''s position cannot be told (mounts Open S0 Evaluation at %s)', v_mount_names);
    elsif v_existing is not null then
      v_outcome := 'already_has_matrix';
      v_matrix := v_existing;
    elsif p_dry_run then
      v_outcome := 'would_open';
      v_matrix := null;
    else
      select v.id into v_visit from public.sor_stage_visits v
       where v.opportunity_id = v_sor.opp_id and v.left_at is null and v.undone_at is null
       order by v.sequence desc limit 1;

      v_matrix := null;
      -- One SOR failing (say, a configured Incharge who has since lost Purchasing
      -- access) rolls back that SOR alone and is reported, so the rest still run;
      -- a later run retries it.
      begin
        -- The first action creates the matrix; any further one tops it up,
        -- exactly as it would have on entering its stage.
        for v_hit in
          select * from public._costing_backfill_hits() h
           where h.opportunity_id = v_sor.opp_id
           order by h.seq
        loop
          v_matrix := public.costing_open_matrix(
            v_sor.opp_id,
            public._costing_action_open_args(v_opp, v_hit.action_config, v_visit)
          );
        end loop;
        v_outcome := 'opened';
      exception when others then
        v_matrix := null;
        v_outcome := 'failed';
        v_reason := v_reason || ' - not opened: ' || sqlerrm;
      end;
    end if;

    flow_id := v_sor.fid;
    flow_name := (select st.name from public.sale_types st where st.id = v_opp.sale_type_id);
    opportunity_id := v_sor.opp_id;
    sales_reference := v_opp.sales_reference;
    current_stage := (select fs.name from public.flow_stages fs where fs.id = v_opp.flow_stage_id);
    mounting_stage := v_mount_names;
    reason := v_reason;
    outcome := v_outcome;
    matrix_id := v_matrix;
    return next;
  end loop;
end;
$$;

-- costing_s0_link_suggestions (latest: 20261113090000_727_s0_links_typed_lines.sql)
create or replace function public.costing_s0_link_suggestions(p_opportunity_id uuid)
returns table (sor_item_id uuid, sor_item_name text, tender_line_id uuid, tender_line_name text, score numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_matrix uuid;
begin
  select m.id into v_matrix from public.costing_matrices m where m.opportunity_id = p_opportunity_id;
  if v_matrix is null then
    raise exception 'costing_fill: this SOR has no S0 Evaluation yet' using errcode = '22023';
  end if;
  if not (public.costing_can_read(p_opportunity_id)
          and (public.costing_in_band(p_opportunity_id, 'sales') or public.costing_in_band(p_opportunity_id, 'purchasing'))) then
    raise exception 'costing_fill: only Sales or Purchasing can see S0 link suggestions' using errcode = '42501';
  end if;
  return query
  select s.item_id, s.item_name, s.line_id, s.line_name, s.score
  from (
    select i.id as item_id, i.product_name as item_name, l.id as line_id, l.tender_specification as line_name,
           round(
             (select count(*) from unnest(public.costing_name_words(i.product_name)) a
               where a = any(public.costing_name_words(l.tender_specification)))::numeric
             / nullif(least(cardinality(public.costing_name_words(i.product_name)),
                            cardinality(public.costing_name_words(l.tender_specification))), 0), 2) as score
    from public.sales_opportunity_items i
    join public.costing_tender_lines l on l.matrix_id = v_matrix and l.source = 'typed' and l.sor_item_id is null
    where i.opportunity_id = p_opportunity_id
      and not i.removed_from_s0
      and not exists (select 1 from public.costing_tender_lines x where x.matrix_id = v_matrix and x.sor_item_id = i.id)
  ) s
  where s.score >= 0.6
  order by s.score desc, s.item_name, s.line_name;
end;
$$;

-- 2. Refresh from the S0 returns what it added and what it left out ----------------------------------

drop function if exists public.costing_fill_from_sor(uuid);


create or replace function public.costing_fill_from_sor(p_opportunity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
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
      and not i.removed_from_s0
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
              or exists (select 1 from public.sales_opportunity_items o where o.id = l.sor_item_id and o.removed_from_s0))
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
  perform set_config('costing.bypass', '', true);
  return jsonb_build_object('added', v_added, 'left_out', v_left);
end;
$$;

comment on function public.costing_fill_from_sor(uuid) is
  'Refresh from the S0: links each live S0 line to the line holding its Odoo line id, else an unlinked typed line with the same Odoo product, else adds a row. Returns {added, left_out}: how many rows it added, and the S0 lines {id, name} it left out because a Go locks the sheet (a new row is a change). Never links by name. Sales or Purchasing. #727.';

revoke all on function public.costing_fill_from_sor(uuid) from public, anon;
grant execute on function public.costing_fill_from_sor(uuid) to authenticated;


-- 3. The "buying opens at" refusal carries a code -------------------------------------------------

create or replace function public.purchase_request_item_attach_po(
  p_actor_email text,
  p_item_id uuid,
  p_po_number text,
  p_facts jsonb,
  p_order_early boolean default false,
  p_order_early_reason text default null
) returns public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po text := nullif(upper(btrim(p_po_number)), '');
  v_actor uuid;
  v_item public.purchase_request_items;
  v_state text := p_facts->>'state';
  v_ordered numeric;
  v_received numeric;
  v_bought text := nullif(btrim(p_facts->>'bought_as'), '');
  v_to text;
  v_text text;
  v_closed_stage text;
  v_early text;
  v_deal_owner uuid;
begin
  if v_po is null or v_po !~ '^P[0-9]+$' then
    raise exception 'purchase_request_item_attach_po: % isn''t an Odoo P0 number ("P" then digits, e.g. P01234)', coalesce(p_po_number, '') using errcode = '22023';
  end if;
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'purchase_request_item_attach_po: not signed in' using errcode = '42501';
  end if;
  if p_facts is null or jsonb_typeof(p_facts) <> 'object' or v_state is null or v_state not in ('rfq', 'confirmed') then
    raise exception 'purchase_request_item_attach_po: the P0 facts must say rfq or confirmed' using errcode = '22023';
  end if;
  v_ordered := coalesce((p_facts->>'ordered')::numeric, 0);
  v_received := coalesce((p_facts->>'received')::numeric, 0);

  -- Act as the caller the edge function authenticated: identity is the JWT email claim.
  perform set_config('request.jwt.claims',
    jsonb_build_object('email', p_actor_email, 'role', 'authenticated')::text, true);

  v_actor := public.get_employee_id();
  if v_actor is null then
    raise exception 'purchase_request_item_attach_po: not signed in' using errcode = '42501';
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'purchase_request_item_attach_po: item % not found', p_item_id using errcode = 'P0002';
  end if;
  if coalesce(public.purchase_request_actor_side(v_item.request_id), '') <> 'purchasing' then
    raise exception 'purchase_request_item_attach_po: only Purchasing attaches a P0' using errcode = '42501';
  end if;
  if v_item.status in ('cancelled', 'received') then
    raise exception 'purchase_request_item_attach_po: nothing to attach to this line; % is %',
      v_item.name, public._purchase_request_item_status_label(v_item.status)
      using errcode = '22023';
  end if;

  -- #724: Buying opens here. Refused before the SOR has entered the flagged Stage unless ordered early with a reason.
  v_closed_stage := public._purchase_request_buying_closed_stage(v_item.request_id);
  if v_closed_stage is not null then
    if not coalesce(p_order_early, false) then
      raise exception 'purchase_request_item_attach_po: buying opens at % and this SOR has not reached it; choose Order early and give a reason to attach now', v_closed_stage
        using errcode = '22023', hint = 'buying_not_open';
    end if;
    v_early := nullif(btrim(coalesce(p_order_early_reason, '')), '');
    if v_early is null then
      raise exception 'purchase_request_item_attach_po: Order early needs a reason' using errcode = '22023';
    end if;
  end if;

  v_to := case
    when v_state = 'rfq' then 'to_purchase'
    when v_ordered > 0 and v_received >= v_ordered then 'received'
    else 'purchased'
  end;

  update public.purchase_request_items
     set status = v_to,
         status_changed_by = case when status is distinct from v_to then v_actor else status_changed_by end,
         status_changed_at = case when status is distinct from v_to then now() else status_changed_at end,
         po_number = v_po,
         po_verification = 'VERIFIED',
         po_state = v_state,
         po_ordered = v_ordered,
         po_received = v_received,
         bought_as = v_bought,
         -- A reason sent with an attach that was not early is ignored; an earlier one stays.
         ordered_early_reason = coalesce(v_early, ordered_early_reason),
         -- Lines picked on another P0 do not carry over.
         odoo_po_line_ids = case when po_number is distinct from v_po then '{}' else odoo_po_line_ids end
   where id = v_item.id
  returning * into v_item;

  v_text := case v_to
    when 'to_purchase' then format('%s: RFQ %s attached; still To purchase.', v_item.name, v_po)
    else format('%s: P0 %s attached; %s.', v_item.name, v_po, public._purchase_request_item_status_label(v_to))
  end;
  if v_early is not null then
    v_text := v_text || format(' Ordered early: %s', v_early);
  end if;
  perform public._purchase_request_post_event(
    v_item.request_id,
    v_actor,
    v_text,
    jsonb_build_object(
      'event', 'item_po_attached',
      'item_id', v_item.id,
      'to', v_to,
      'po_number', v_po,
      'po_state', v_state,
      'bought_as', v_bought,
      'ordered_early', v_early is not null,
      'ordered_early_reason', v_early
    )
  );

  -- Tell the Deal Owner that money is out before the Stage that opens buying.
  if v_early is not null then
    select o.deal_owner_id into v_deal_owner
      from public.purchase_requests r
      join public.sales_opportunities o on o.id = r.opportunity_id
     where r.id = v_item.request_id;
    perform public._purchase_request_notify(
      v_item.request_id, array[v_deal_owner], v_actor, 'PURCHASE_REQUEST_ORDERED_EARLY',
      'Ordered early on your deal',
      format('%s: %s was ordered before %s. Reason: %s', public._purchase_request_label(v_item.request_id), v_item.name, v_closed_stage, v_early),
      false
    );
  end if;

  return v_item;
end;
$$;

-- 4. "Buying opens here" in one step ---------------------------------------------------------------

-- Flags a Stage (moving the flag off any other Stage of the flow), or clears it. Runs as the caller, so the
-- table's own policies decide who may; the clear and the set are one transaction, and calls on one flow take turns.
create or replace function public.flow_stage_set_buying_opens(p_stage_id uuid, p_on boolean)
returns public.flow_stages
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_flow uuid;
  v_row  public.flow_stages;
begin
  select s.flow_id into v_flow from public.flow_stages s where s.id = p_stage_id;
  if v_flow is null then
    raise exception 'flow_stage_set_buying_opens: stage % not found', p_stage_id using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('flow_buying_opens:' || v_flow::text));
  if coalesce(p_on, false) then
    update public.flow_stages
       set buying_opens_here = false, updated_at = now()
     where flow_id = v_flow and buying_opens_here and id <> p_stage_id;
  end if;
  update public.flow_stages
     set buying_opens_here = coalesce(p_on, false), updated_at = now()
   where id = p_stage_id
  returning * into v_row;
  if v_row.id is null then
    raise exception 'flow_stage_set_buying_opens: not allowed to change this stage' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

comment on function public.flow_stage_set_buying_opens(uuid, boolean) is
  '#724: flags a Stage as "Buying opens here", moving the flag off the flow''s other Stage in the same transaction (the unique index keeps it to one), or clears it. Runs as the caller.';

revoke all on function public.flow_stage_set_buying_opens(uuid, boolean) from public, anon;
grant execute on function public.flow_stage_set_buying_opens(uuid, boolean) to authenticated;
