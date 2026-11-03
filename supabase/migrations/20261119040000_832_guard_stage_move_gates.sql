-- 832: The database refuses a Stage move whose gates are not met.
--
-- Redefines public.sor_guard_stage_move() from 20260930090000_revert_stage.sql:
-- - A real move backward (to.sort_order < from.sort_order) skips gates (#390, #831, #832).
-- - A forward move (to.sort_order >= from.sort_order) validates:
--     1. Required stage fields for the Stage being left (raises 'Fill in: ...').
--     2. Required blocking stage conditions for the Stage being left (raises 'Can''t move on yet — missing: ...').
--
-- Access checks (sor_access_level <> 'full', sor_is_stage_shut_out) and exemptions
-- (same stage, service_role, app.sor_revert) remain unchanged.

create or replace function public.sor_guard_stage_move()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot_data jsonb;
  v_from_sort_order integer;
  v_to_sort_order integer;
  v_current_visit_id uuid;
  v_missing_fields text[] := '{}';
  v_missing_conditions text[] := '{}';
  v_field record;
  v_cond record;
  v_field_val text;
  v_cond_met boolean;
  v_matrix_id uuid;
  v_incharge uuid;
  v_components integer;
  v_no_acquire integer;
begin
  if NEW.flow_stage_id is not distinct from OLD.flow_stage_id then
    return NEW;
  end if;

  if auth.role() = 'service_role' then
    return NEW;
  end if;

  -- Revert authorises itself (mover / Deal Owner / Super Admin) and a
  -- Restricted Stage does not stop it.
  if coalesce(current_setting('app.sor_revert', true), '') = 'on' then
    return NEW;
  end if;

  if public.sor_access_level(OLD.id) <> 'full' then
    raise exception 'You do not have access to move this stage.' using errcode = '42501';
  end if;

  if public.sor_is_stage_shut_out(OLD, public.get_employee_id(), OLD.flow_stage_id) then
    raise exception 'This stage is restricted — you cannot move this SOR.' using errcode = '42501';
  end if;

  if OLD.flow_stage_id is null then
    return NEW;
  end if;

  -- Resolve sort orders of the from-stage and to-stage
  if OLD.flow_snapshot_id is not null then
    select snapshot_data into v_snapshot_data
      from public.flow_snapshots
     where id = OLD.flow_snapshot_id;
  end if;

  if v_snapshot_data is not null and jsonb_typeof(v_snapshot_data->'stages') = 'array' then
    select (st->>'sort_order')::integer into v_from_sort_order
      from jsonb_array_elements(v_snapshot_data->'stages') st
     where (st->>'id')::uuid = OLD.flow_stage_id;

    select (st->>'sort_order')::integer into v_to_sort_order
      from jsonb_array_elements(v_snapshot_data->'stages') st
     where (st->>'id')::uuid = NEW.flow_stage_id;
  end if;

  if v_from_sort_order is null then
    select sort_order into v_from_sort_order
      from public.flow_stages
     where id = OLD.flow_stage_id;
  end if;

  if v_to_sort_order is null and NEW.flow_stage_id is not null then
    select sort_order into v_to_sort_order
      from public.flow_stages
     where id = NEW.flow_stage_id;
  end if;

  -- A move skips gates only when going backward (#390, #831, #832).
  -- A forward move to a visited stage still checks gates.
  if v_from_sort_order is not null and v_to_sort_order is not null and v_to_sort_order < v_from_sort_order then
    return NEW;
  end if;

  -- Current visit for visit-scoped fields and conditions
  select id into v_current_visit_id
    from public.sor_stage_visits
   where opportunity_id = OLD.id
     and left_at is null
   order by sequence desc
   limit 1;

  -- 1. Check Stage Fields for OLD.flow_stage_id
  if v_snapshot_data is not null and jsonb_typeof(v_snapshot_data->'stageFields') = 'array' then
    for v_field in
      select (f->>'id')::uuid as id,
             f->>'label' as label,
             f->>'source' as source,
             f->>'sor_field' as sor_field
        from jsonb_array_elements(v_snapshot_data->'stageFields') f
       where (f->>'stage_id')::uuid = OLD.flow_stage_id
         and coalesce((f->>'is_required')::boolean, false) = true
         and f->>'archived_at' is null
       order by coalesce((f->>'sort_order')::integer, 0)
    loop
      if v_field.source = 'sor' then
        v_field_val := to_jsonb(NEW) ->> v_field.sor_field;
        if v_field_val is null or btrim(v_field_val) = '' then
          v_missing_fields := array_append(v_missing_fields, v_field.label);
        end if;
      elsif v_field.source = 'custom' then
        if v_current_visit_id is null then
          v_missing_fields := array_append(v_missing_fields, v_field.label);
        else
          select case
                   when value is null or jsonb_typeof(value) = 'null' then ''
                   when jsonb_typeof(value) = 'string' then value #>> '{}'
                   else value::text
                 end into v_field_val
            from public.sor_stage_field_values
           where stage_visit_id = v_current_visit_id
             and field_id = v_field.id;
          if v_field_val is null or btrim(v_field_val) = '' then
            v_missing_fields := array_append(v_missing_fields, v_field.label);
          end if;
        end if;
      end if;
    end loop;
  else
    for v_field in
      select id, label, source, sor_field
        from public.flow_stage_fields
       where stage_id = OLD.flow_stage_id
         and is_required = true
         and archived_at is null
       order by sort_order, created_at
    loop
      if v_field.source = 'sor' then
        v_field_val := to_jsonb(NEW) ->> v_field.sor_field;
        if v_field_val is null or btrim(v_field_val) = '' then
          v_missing_fields := array_append(v_missing_fields, v_field.label);
        end if;
      elsif v_field.source = 'custom' then
        if v_current_visit_id is null then
          v_missing_fields := array_append(v_missing_fields, v_field.label);
        else
          select case
                   when value is null or jsonb_typeof(value) = 'null' then ''
                   when jsonb_typeof(value) = 'string' then value #>> '{}'
                   else value::text
                 end into v_field_val
            from public.sor_stage_field_values
           where stage_visit_id = v_current_visit_id
             and field_id = v_field.id;
          if v_field_val is null or btrim(v_field_val) = '' then
            v_missing_fields := array_append(v_missing_fields, v_field.label);
          end if;
        end if;
      end if;
    end loop;
  end if;

  if cardinality(v_missing_fields) > 0 then
    raise exception 'Fill in: %', array_to_string(v_missing_fields, ', ')
      using errcode = '22023';
  end if;

  -- 2. Check Stage Conditions for OLD.flow_stage_id
  if v_snapshot_data is not null and jsonb_typeof(v_snapshot_data->'conditions') = 'array' then
    for v_cond in
      select case
               when c->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then (c->>'id')::uuid
               else null
             end as id,
             c->>'id' as id_text,
             c->>'label' as label,
             c->>'kind' as kind,
             coalesce(c->'config', '{}'::jsonb) as config
        from jsonb_array_elements(v_snapshot_data->'conditions') c
       where (c->>'stage_id')::uuid = OLD.flow_stage_id
         and coalesce((c->>'is_required')::boolean, false) = true
         and c->>'archived_at' is null
         and c->>'kind' <> 'deadline'
       order by coalesce((c->>'sort_order')::integer, 0)
    loop
      case
        when v_cond.kind = 'attachment' then
          v_cond_met := exists (
            select 1
              from public.sales_opportunity_logs l,
                   jsonb_array_elements(coalesce(l.metadata->'attachments', '[]'::jsonb)) att
             where l.opportunity_id = OLD.id
               and (
                 v_current_visit_id is null
                 or (att->>'stageVisitId') is null
                 or att->>'stageVisitId' = v_current_visit_id::text
               )
               and (
                 case
                   when nullif(btrim(v_cond.config->>'documentType'), '') is not null then
                     att->>'documentType' = v_cond.config->>'documentType'
                   else
                     (att->>'conditionId') = v_cond.id_text
                     and (
                       not (v_cond.config ? 'accepts')
                       or jsonb_array_length(coalesce(v_cond.config->'accepts', '[]'::jsonb)) = 0
                       or exists (
                         select 1
                           from jsonb_array_elements_text(v_cond.config->'accepts') acc
                          where acc = att->>'type'
                       )
                     )
                 end
               )
          );

        when v_cond.kind = 'purchasing_settled' then
          if not exists (select 1 from public.purchase_requests where opportunity_id = OLD.id) then
            v_cond_met := true;
          else
            v_cond_met := not exists (
              select 1
                from public.purchase_request_items pri
                join public.purchase_requests pr on pr.id = pri.request_id
               where pr.opportunity_id = OLD.id
                 and pri.status not in ('available', 'received', 'cannot_source', 'cancelled')
            );
          end if;

        when v_cond.kind = 'costing_settled' then
          select id into v_matrix_id
            from public.costing_matrices
           where opportunity_id = OLD.id;

          if v_matrix_id is null then
            v_cond_met := false;
          else
            v_cond_met := public.costing_settled_met(v_matrix_id);
          end if;

        when v_cond.kind = 'costing_priced' then
          select id, purchasing_incharge_id into v_matrix_id, v_incharge
            from public.costing_matrices
           where opportunity_id = OLD.id;

          if v_matrix_id is null then
            v_cond_met := false;
          else
            select count(*),
                   count(*) filter (where cc.acquire_unit is null and cc.p0_unit_price is null)
              into v_components, v_no_acquire
              from public.costing_components c
              join public.costing_tender_lines l on l.id = c.tender_line_id
              left join public.costing_component_costs cc on cc.component_id = c.id
             where l.matrix_id = v_matrix_id;

            v_no_acquire := v_no_acquire + (
              select count(*)
                from public.costing_cost_rows r
               where r.matrix_id = v_matrix_id and r.acquire_unit is null
            );

            v_cond_met := (v_components > 0 and v_no_acquire = 0 and v_incharge is not null);
          end if;

        when v_cond.kind = 'costing_evaluation_approved' then
          select id into v_matrix_id
            from public.costing_matrices
           where opportunity_id = OLD.id;

          if v_matrix_id is null then
            v_cond_met := false;
          else
            v_cond_met := exists (
              select 1
                from public.costing_signoffs s
               where s.matrix_id = v_matrix_id
                 and s.role = 'evaluation_approved'
                 and s.cleared_at is null
            );
          end if;

        when v_cond.kind = 'tickbox' then
          v_cond_met := exists (
            select 1
              from public.sor_condition_status scs
             where scs.opportunity_id = OLD.id
               and (scs.condition_id = v_cond.id or scs.condition_id::text = v_cond.id_text)
               and (v_current_visit_id is null or scs.stage_visit_id = v_current_visit_id)
          );

        when v_cond.kind = 'assignment' then
          v_cond_met := exists (
            select 1
              from public.sales_opportunity_members som
              join public.employees e on e.id = som.employee_id
             where som.opportunity_id = OLD.id
               and (
                 case
                   when nullif(btrim(v_cond.config->>'department'), '') is not null then
                     e.department = v_cond.config->>'department'
                   when v_cond.config ? 'who' and jsonb_array_length(coalesce(v_cond.config->'who', '[]'::jsonb)) > 0 then
                     exists (
                       select 1
                         from jsonb_array_elements(v_cond.config->'who') sel
                        where (
                          (sel->>'type' = 'employee' and (sel->>'id')::uuid = som.employee_id)
                          or (sel->>'type' = 'group' and exists (
                            select 1 from public.employee_group_members egm
                             where egm.group_id = (sel->>'id')::uuid and egm.employee_id = som.employee_id
                          ))
                          or (sel->>'type' = 'team' and (e.sub_department = sel->>'team' or e.sub_department = sel->>'id'))
                        )
                     )
                   else false
                 end
               )
          );

        when v_cond.kind = 'inclusions' then
          v_cond_met := exists (
            select 1 from public.sor_inclusions where opportunity_id = OLD.id
          );

        when v_cond.kind = 'purchasing' then
          v_cond_met := exists (
            select 1 from public.sor_procurement_requests where opportunity_id = OLD.id
          );

        when v_cond.kind = 'goods_checked' then
          v_cond_met := (
            exists (
              select 1
                from public.transmittals t
                join public.transmittal_lines l on l.transmittal_id = t.id
               where l.opportunity_id = OLD.id
                 and t.state not in ('draft', 'cancelled')
            )
            and not exists (
              select 1
                from public.transmittals t
                join public.transmittal_lines l on l.transmittal_id = t.id
               where l.opportunity_id = OLD.id
                 and t.state in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection', 'awaiting_check')
            )
          );

        when v_cond.kind = 'orders_filed' then
          v_cond_met := (
            exists (
              select 1
                from public.ipas i
                join public.ipas_sors s on s.ipas_id = i.id
               where s.opportunity_id = OLD.id
                 and i.state <> 'cancelled'
            )
            and not exists (
              select 1
                from public.ipas i
                join public.ipas_sors s on s.ipas_id = i.id
               where s.opportunity_id = OLD.id
                 and i.state = 'open'
            )
          );

        when v_cond.kind in ('deadline', 'field', 'project_evaluation') then
          v_cond_met := true;
        else
          v_cond_met := false;
      end case;

      if not v_cond_met then
        v_missing_conditions := array_append(v_missing_conditions, v_cond.label);
      end if;
    end loop;
  else
    for v_cond in
      select id,
             id::text as id_text,
             label,
             kind,
             coalesce(config, '{}'::jsonb) as config
        from public.stage_conditions
       where stage_id = OLD.flow_stage_id
         and is_required = true
         and archived_at is null
         and kind <> 'deadline'
       order by sort_order, created_at
    loop
      case
        when v_cond.kind = 'attachment' then
          v_cond_met := exists (
            select 1
              from public.sales_opportunity_logs l,
                   jsonb_array_elements(coalesce(l.metadata->'attachments', '[]'::jsonb)) att
             where l.opportunity_id = OLD.id
               and (
                 v_current_visit_id is null
                 or (att->>'stageVisitId') is null
                 or att->>'stageVisitId' = v_current_visit_id::text
               )
               and (
                 case
                   when nullif(btrim(v_cond.config->>'documentType'), '') is not null then
                     att->>'documentType' = v_cond.config->>'documentType'
                   else
                     (att->>'conditionId') = v_cond.id_text
                     and (
                       not (v_cond.config ? 'accepts')
                       or jsonb_array_length(coalesce(v_cond.config->'accepts', '[]'::jsonb)) = 0
                       or exists (
                         select 1
                           from jsonb_array_elements_text(v_cond.config->'accepts') acc
                          where acc = att->>'type'
                       )
                     )
                 end
               )
          );

        when v_cond.kind = 'purchasing_settled' then
          if not exists (select 1 from public.purchase_requests where opportunity_id = OLD.id) then
            v_cond_met := true;
          else
            v_cond_met := not exists (
              select 1
                from public.purchase_request_items pri
                join public.purchase_requests pr on pr.id = pri.request_id
               where pr.opportunity_id = OLD.id
                 and pri.status not in ('available', 'received', 'cannot_source', 'cancelled')
            );
          end if;

        when v_cond.kind = 'costing_settled' then
          select id into v_matrix_id
            from public.costing_matrices
           where opportunity_id = OLD.id;

          if v_matrix_id is null then
            v_cond_met := false;
          else
            v_cond_met := public.costing_settled_met(v_matrix_id);
          end if;

        when v_cond.kind = 'costing_priced' then
          select id, purchasing_incharge_id into v_matrix_id, v_incharge
            from public.costing_matrices
           where opportunity_id = OLD.id;

          if v_matrix_id is null then
            v_cond_met := false;
          else
            select count(*),
                   count(*) filter (where cc.acquire_unit is null and cc.p0_unit_price is null)
              into v_components, v_no_acquire
              from public.costing_components c
              join public.costing_tender_lines l on l.id = c.tender_line_id
              left join public.costing_component_costs cc on cc.component_id = c.id
             where l.matrix_id = v_matrix_id;

            v_no_acquire := v_no_acquire + (
              select count(*)
                from public.costing_cost_rows r
               where r.matrix_id = v_matrix_id and r.acquire_unit is null
            );

            v_cond_met := (v_components > 0 and v_no_acquire = 0 and v_incharge is not null);
          end if;

        when v_cond.kind = 'costing_evaluation_approved' then
          select id into v_matrix_id
            from public.costing_matrices
           where opportunity_id = OLD.id;

          if v_matrix_id is null then
            v_cond_met := false;
          else
            v_cond_met := exists (
              select 1
                from public.costing_signoffs s
               where s.matrix_id = v_matrix_id
                 and s.role = 'evaluation_approved'
                 and s.cleared_at is null
            );
          end if;

        when v_cond.kind = 'tickbox' then
          v_cond_met := exists (
            select 1
              from public.sor_condition_status scs
             where scs.opportunity_id = OLD.id
               and (scs.condition_id = v_cond.id or scs.condition_id::text = v_cond.id_text)
               and (v_current_visit_id is null or scs.stage_visit_id = v_current_visit_id)
          );

        when v_cond.kind = 'assignment' then
          v_cond_met := exists (
            select 1
              from public.sales_opportunity_members som
              join public.employees e on e.id = som.employee_id
             where som.opportunity_id = OLD.id
               and (
                 case
                   when nullif(btrim(v_cond.config->>'department'), '') is not null then
                     e.department = v_cond.config->>'department'
                   when v_cond.config ? 'who' and jsonb_array_length(coalesce(v_cond.config->'who', '[]'::jsonb)) > 0 then
                     exists (
                       select 1
                         from jsonb_array_elements(v_cond.config->'who') sel
                        where (
                          (sel->>'type' = 'employee' and (sel->>'id')::uuid = som.employee_id)
                          or (sel->>'type' = 'group' and exists (
                            select 1 from public.employee_group_members egm
                             where egm.group_id = (sel->>'id')::uuid and egm.employee_id = som.employee_id
                          ))
                          or (sel->>'type' = 'team' and (e.sub_department = sel->>'team' or e.sub_department = sel->>'id'))
                        )
                     )
                   else false
                 end
               )
          );

        when v_cond.kind = 'inclusions' then
          v_cond_met := exists (
            select 1 from public.sor_inclusions where opportunity_id = OLD.id
          );

        when v_cond.kind = 'purchasing' then
          v_cond_met := exists (
            select 1 from public.sor_procurement_requests where opportunity_id = OLD.id
          );

        when v_cond.kind = 'goods_checked' then
          v_cond_met := (
            exists (
              select 1
                from public.transmittals t
                join public.transmittal_lines l on l.transmittal_id = t.id
               where l.opportunity_id = OLD.id
                 and t.state not in ('draft', 'cancelled')
            )
            and not exists (
              select 1
                from public.transmittals t
                join public.transmittal_lines l on l.transmittal_id = t.id
               where l.opportunity_id = OLD.id
                 and t.state in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection', 'awaiting_check')
            )
          );

        when v_cond.kind = 'orders_filed' then
          v_cond_met := (
            exists (
              select 1
                from public.ipas i
                join public.ipas_sors s on s.ipas_id = i.id
               where s.opportunity_id = OLD.id
                 and i.state <> 'cancelled'
            )
            and not exists (
              select 1
                from public.ipas i
                join public.ipas_sors s on s.ipas_id = i.id
               where s.opportunity_id = OLD.id
                 and i.state = 'open'
            )
          );

        when v_cond.kind in ('deadline', 'field', 'project_evaluation') then
          v_cond_met := true;
        else
          v_cond_met := false;
      end case;

      if not v_cond_met then
        v_missing_conditions := array_append(v_missing_conditions, v_cond.label);
      end if;
    end loop;
  end if;

  if cardinality(v_missing_conditions) > 0 then
    raise exception 'Can''t move on yet — missing: %', array_to_string(v_missing_conditions, ', ')
      using errcode = '22023';
  end if;

  return NEW;
end;
$$;
