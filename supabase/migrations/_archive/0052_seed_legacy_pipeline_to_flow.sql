-- ==============================================================================
-- 0052_seed_legacy_pipeline_to_flow.sql
--
-- Seed the legacy `crm_pipeline_stages` into the new `sales_flows` / `flow_stages`
-- system so that the operations manager has a starting point in the Flow Canvas,
-- mirroring the pipeline that is currently active in production.
-- ==============================================================================

do $$
declare
  v_sale_type_id uuid;
  v_flow_id uuid;
  v_stage_id uuid;
  v_prev_stage_id uuid := null;
  v_stage record;
begin
  -- 1. Create a default Sale Type if one does not exist
  select id into v_sale_type_id
  from public.sale_types
  where lower(btrim(name)) = 'standard pipeline'
    and archived_at is null
  limit 1;

  if v_sale_type_id is null then
    insert into public.sale_types (name)
    values ('Standard Pipeline')
    returning id into v_sale_type_id;
  end if;

  -- 2. Create a Sales Flow for it (start as draft so it can be edited on canvas)
  select id into v_flow_id
  from public.sales_flows
  where sale_type_id = v_sale_type_id
  limit 1;

  if v_flow_id is null then
    insert into public.sales_flows (sale_type_id, state)
    values (v_sale_type_id, 'draft')
    returning id into v_flow_id;
  end if;

  -- Skip seeding if stages already exist to avoid duplicates
  if exists (select 1 from public.flow_stages where flow_id = v_flow_id) then
    return;
  end if;

  -- 3. Import stages and connect them linearly
  for v_stage in (
    select code, label, sort_order, is_won, is_lost, is_anchor 
    from public.crm_pipeline_stages 
    order by sort_order
  ) loop
    insert into public.flow_stages (flow_id, name, sort_order, is_terminal)
    values (v_flow_id, v_stage.label, v_stage.sort_order, v_stage.is_lost)
    returning id into v_stage_id;

    -- Draw an edge from the previous stage to this one
    if v_prev_stage_id is not null then
      insert into public.flow_edges (flow_id, from_stage_id, to_stage_id)
      values (v_flow_id, v_prev_stage_id, v_stage_id);
    end if;

    -- Mark Won Stage
    if v_stage.is_won then
      update public.sales_flows set won_stage_id = v_stage_id where id = v_flow_id;
    end if;
    
    v_prev_stage_id := v_stage_id;
  end loop;

end;
$$;
