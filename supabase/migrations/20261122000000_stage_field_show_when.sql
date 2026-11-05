-- #900 (spec #907): a Stage Field can show only when another Stage Field of the same Stage has a value.
--
-- WHY: the "If yes" field of Product Demo still showed and still blocked the move when Product Demo was No.
--
-- WHAT THIS ADDS
--   * flow_stage_fields.show_when: null (always shown, the default) or {"field_id": <the other field's id>,
--     "value": "<its value>"}. The field shows, and counts as required, only while that field holds that value.
--   * stage_field_shown(show_when, opportunity, visit_id): the one rule. A reference to a field that no longer
--     exists hides nothing. The value is read the same way the stage gate reads it: an SOR column from the
--     opportunity, or a custom field from the current Stage Visit.
--   * sor_guard_stage_move() (from 832) skips a hidden field, so it cannot block a move. The body is copied
--     from 20261119040000_832_guard_stage_move_gates.sql (the newest definition), with that skip added.
--   * restore_flow_snapshot() (from 20261121180002) restores show_when from the snapshot. The body is copied from
--     20261121180002_flow_canvas_restore_editor_gate.sql (the newest definition), with show_when added.
--   * Project flows: the "If yes" field on the same Stage as "Product Demo" shows only when Product Demo is "Yes".
--
-- Idempotent: the column and constraint are added only if missing, and the functions are replaced.

alter table public.flow_stage_fields add column if not exists show_when jsonb;

alter table public.flow_stage_fields drop constraint if exists flow_stage_fields_show_when_chk;
alter table public.flow_stage_fields add constraint flow_stage_fields_show_when_chk
  check (show_when is null or (jsonb_typeof(show_when) = 'object' and show_when ? 'field_id' and show_when ? 'value'));

create or replace function public.stage_field_shown(
  p_show_when jsonb,
  p_opportunity jsonb,
  p_visit_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ref_source text;
  v_ref_sor_field text;
  v_value text;
begin
  if p_show_when is null or jsonb_typeof(p_show_when) <> 'object' then
    return true;
  end if;

  select source, sor_field into v_ref_source, v_ref_sor_field
    from public.flow_stage_fields
   where id = (p_show_when->>'field_id')::uuid;
  if not found then
    return true;
  end if;

  if v_ref_source = 'sor' then
    v_value := p_opportunity ->> v_ref_sor_field;
  else
    select case
             when value is null or jsonb_typeof(value) = 'null' then null
             when jsonb_typeof(value) = 'string' then value #>> '{}'
             else value::text
           end into v_value
      from public.sor_stage_field_values
     where stage_visit_id = p_visit_id
       and field_id = (p_show_when->>'field_id')::uuid;
  end if;

  return coalesce(v_value, '') = coalesce(p_show_when->>'value', '');
end;
$$;

-- Only the guard and restore functions call this (as their owner). Nobody else may ask it about a visit's values.
revoke execute on function public.stage_field_shown(jsonb, jsonb, uuid) from public, anon, authenticated;

-- ─── sor_guard_stage_move (copied from 832, hidden fields skipped) ──────────────────────────────

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
             f->>'sor_field' as sor_field,
             f->'show_when' as show_when
        from jsonb_array_elements(v_snapshot_data->'stageFields') f
       where (f->>'stage_id')::uuid = OLD.flow_stage_id
         and coalesce((f->>'is_required')::boolean, false) = true
         and f->>'archived_at' is null
       order by coalesce((f->>'sort_order')::integer, 0)
    loop
      if not stage_field_shown(v_field.show_when, to_jsonb(NEW), v_current_visit_id) then
        continue;
      end if;
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
      select id, label, source, sor_field, show_when
        from public.flow_stage_fields
       where stage_id = OLD.flow_stage_id
         and is_required = true
         and archived_at is null
       order by sort_order, created_at
    loop
      if not stage_field_shown(v_field.show_when, to_jsonb(NEW), v_current_visit_id) then
        continue;
      end if;
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

-- ─── restore_flow_snapshot (copied from 20261121180002, show_when restored) ───────────────────

create or replace function public.restore_flow_snapshot(
  p_flow_id uuid,
  p_snapshot_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flow record;
  v_snapshot record;
  v_data jsonb;
  v_target_stage_ids uuid[];
  v_target_edge_ids uuid[];
  v_target_action_ids uuid[];
  v_target_condition_ids uuid[];
  v_target_field_ids uuid[];
  v_target_form_field_ids uuid[];
  v_target_follow_up_stage_ids uuid[];
  v_won_stage_id uuid;
  v_award_stage_id uuid;
  v_contract_stage_id uuid;
  v_blockers text[] := array[]::text[];
  v_rec record;
  v_elem jsonb;
begin
  -- #884: a signed-in employee must be a Super Admin or a Flow editor. RLS would
  -- refuse the writes below anyway; this says so plainly, before anything changes.
  -- With no signed-in user (the service role, or a direct database connection
  -- such as scripts/transfer-sales-flows.mjs) auth.role() is not
  -- 'authenticated', so operator tooling is not gated here.
  if auth.role() = 'authenticated' and not (is_super_admin() or can_edit_sales_flows()) then
    raise exception 'Only a Super Admin or a Flow editor can restore a Sales Flow.'
      using errcode = '42501';
  end if;
  -- Lock the Sales Flow row first (ADR 0013 / lock_sales_flow).
  select * into v_flow from sales_flows where id = p_flow_id for update;
  if not found then
    raise exception 'Sales Flow not found.';
  end if;
  if v_flow.state <> 'draft' then
    raise exception 'This Sales Flow is locked. Unlock it first, with a reason, to make changes.';
  end if;

  select * into v_snapshot from flow_snapshots where id = p_snapshot_id;
  if not found then
    raise exception 'That Flow Snapshot does not exist.';
  end if;
  if v_snapshot.flow_id <> p_flow_id then
    raise exception 'That Flow Snapshot does not belong to this flow.';
  end if;

  v_data := v_snapshot.snapshot_data;
  v_won_stage_id := nullif(v_data->>'wonStageId', '')::uuid;
  v_award_stage_id := nullif(v_data->>'awardStageId', '')::uuid;
  v_contract_stage_id := nullif(v_data->>'contractStageId', '')::uuid;

  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_stage_ids
  from jsonb_array_elements(coalesce(v_data->'stages', '[]'::jsonb)) as e;

  -- Refuse before writing anything if a live Stage the target drops is still
  -- referenced by an SOR. The foreign key sees soft-deleted SORs too, so they
  -- count, and the message says when they are the whole reason.
  for v_rec in
    select st.name as stage_name,
           count(*) as total,
           count(*) filter (where o.is_deleted is true) as soft_deleted
    from flow_stages st
    join sales_opportunities o on o.flow_stage_id = st.id
    where st.flow_id = p_flow_id
      and not (st.id = any(v_target_stage_ids))
    group by st.id, st.name
    order by st.name
  loop
    v_blockers := array_append(
      v_blockers,
      format(
        '"%s" is referenced by %s SOR%s%s',
        v_rec.stage_name,
        v_rec.total,
        case when v_rec.total = 1 then '' else 's' end,
        case
          when v_rec.soft_deleted = v_rec.total then format(' (all %s soft-deleted)', v_rec.total)
          when v_rec.soft_deleted > 0 then format(' (%s of them soft-deleted)', v_rec.soft_deleted)
          else ''
        end
      )
    );
  end loop;
  if array_length(v_blockers, 1) > 0 then
    raise exception 'This version cannot be restored yet: %. Move those deals to another Stage first.',
      array_to_string(v_blockers, '; ');
  end if;

  -- From here the draft is reshaped to match the target, keeping ids. Clear
  -- the Won Stage first so a dropped Stage that held it can be deleted.
  update sales_flows set won_stage_id = null, award_stage_id = null, contract_stage_id = null, updated_at = now() where id = p_flow_id;

  -- Two Stages can swap names. The one-name-per-flow index is checked row by
  -- row, so park every surviving Stage on a unique placeholder first.
  -- The one-flag-per-flow index is checked row by row too, so clear the flag here and set it from the target.
  update flow_stages set name = '__restore__' || id::text, buying_opens_here = false where flow_id = p_flow_id;

  -- Drop the Stages the target does not have. Their edges, conditions and
  -- actions go by cascade; the check above proved no SOR is referenced.
  delete from flow_stages
   where flow_id = p_flow_id
     and not (id = any(v_target_stage_ids));

  -- Upsert every target Stage under its original id.
  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'stages', '[]'::jsonb)) as e
  loop
    insert into flow_stages (
      id, flow_id, name, sort_order, is_terminal, terminal_outcome, buying_opens_here, pos_x, pos_y, color, bracket_label, created_at, updated_at
    )
    values (
      (v_elem->>'id')::uuid,
      p_flow_id,
      v_elem->>'name',
      coalesce((v_elem->>'sort_order')::int, 0),
      coalesce((v_elem->>'is_terminal')::boolean, false),
      case when coalesce((v_elem->>'is_terminal')::boolean, false) then nullif(v_elem->>'terminal_outcome', '') end,
      coalesce((v_elem->>'buying_opens_here')::boolean, false),
      coalesce((v_elem->>'pos_x')::int, 0),
      coalesce((v_elem->>'pos_y')::int, 0),
      nullif(v_elem->>'color', ''),
      nullif(v_elem->>'bracket_label', ''),
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      name = excluded.name,
      sort_order = excluded.sort_order,
      is_terminal = excluded.is_terminal,
      terminal_outcome = excluded.terminal_outcome,
      buying_opens_here = excluded.buying_opens_here,
      pos_x = excluded.pos_x,
      pos_y = excluded.pos_y,
      color = excluded.color,
      bracket_label = excluded.bracket_label,
      updated_at = now();
  end loop;

  -- Moves.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_edge_ids
  from jsonb_array_elements(coalesce(v_data->'edges', '[]'::jsonb)) as e;

  delete from flow_edges
   where flow_id = p_flow_id
     and not (id = any(v_target_edge_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'edges', '[]'::jsonb)) as e
  loop
    insert into flow_edges (id, flow_id, from_stage_id, to_stage_id, created_at)
    values (
      (v_elem->>'id')::uuid,
      p_flow_id,
      (v_elem->>'from_stage_id')::uuid,
      (v_elem->>'to_stage_id')::uuid,
      coalesce((v_elem->>'created_at')::timestamptz, now())
    )
    on conflict (id) do update set
      from_stage_id = excluded.from_stage_id,
      to_stage_id = excluded.to_stage_id;
  end loop;

  -- Stage Actions.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_action_ids
  from jsonb_array_elements(coalesce(v_data->'actions', '[]'::jsonb)) as e;

  delete from flow_stage_actions
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (id = any(v_target_action_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'actions', '[]'::jsonb)) as e
  loop
    insert into flow_stage_actions (id, stage_id, kind, config, sort_order, archived_at, created_at, updated_at)
    values (
      (v_elem->>'id')::uuid,
      (v_elem->>'stage_id')::uuid,
      v_elem->>'kind',
      coalesce(v_elem->'config', '{}'::jsonb),
      coalesce((v_elem->>'sort_order')::int, 0),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      stage_id = excluded.stage_id,
      kind = excluded.kind,
      config = excluded.config,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  -- Stage Conditions.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_condition_ids
  from jsonb_array_elements(coalesce(v_data->'conditions', '[]'::jsonb)) as e;

  delete from stage_conditions
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (id = any(v_target_condition_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'conditions', '[]'::jsonb)) as e
  loop
    insert into stage_conditions (id, stage_id, kind, label, is_required, sort_order, config, archived_at, created_at, updated_at)
    values (
      (v_elem->>'id')::uuid,
      (v_elem->>'stage_id')::uuid,
      v_elem->>'kind',
      v_elem->>'label',
      coalesce((v_elem->>'is_required')::boolean, true),
      coalesce((v_elem->>'sort_order')::int, 0),
      coalesce(v_elem->'config', '{}'::jsonb),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      stage_id = excluded.stage_id,
      kind = excluded.kind,
      label = excluded.label,
      is_required = excluded.is_required,
      sort_order = excluded.sort_order,
      config = excluded.config,
      archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  -- Stage Fields (#331). Values recorded against a field cascade from it, so
  -- a field the target lacks is archived, not deleted: the SOR data stays.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_field_ids
  from jsonb_array_elements(coalesce(v_data->'stageFields', '[]'::jsonb)) as e;

  update flow_stage_fields
     set archived_at = now(), updated_at = now()
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (id = any(v_target_field_ids))
     and archived_at is null;

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'stageFields', '[]'::jsonb)) as e
  loop
    insert into flow_stage_fields (
      id, stage_id, label, help, source, sor_field, field_type, options, is_required, sort_order, archived_at, created_at, updated_at, show_when
    )
    values (
      (v_elem->>'id')::uuid,
      (v_elem->>'stage_id')::uuid,
      v_elem->>'label',
      nullif(v_elem->>'help', ''),
      v_elem->>'source',
      nullif(v_elem->>'sor_field', ''),
      v_elem->>'field_type',
      coalesce(v_elem->'options', '[]'::jsonb),
      coalesce((v_elem->>'is_required')::boolean, true),
      coalesce((v_elem->>'sort_order')::int, 0),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now(),
      case when jsonb_typeof(v_elem->'show_when') = 'object' then v_elem->'show_when' end
    )
    on conflict (id) do update set
      stage_id = excluded.stage_id,
      label = excluded.label,
      help = excluded.help,
      source = excluded.source,
      sor_field = excluded.sor_field,
      field_type = excluded.field_type,
      options = excluded.options,
      is_required = excluded.is_required,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at,
      show_when = excluded.show_when,
      updated_at = now();
  end loop;

  -- Registration form fields: same archive-don't-delete rule (sor_form_values).
  -- A 'default' row is unique per (flow, default_key). When the draft already
  -- has one for a key the target customizes, under a different id, that row
  -- is updated in place (keeping its id and its values) rather than replaced.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_form_field_ids
  from jsonb_array_elements(coalesce(v_data->'formFields', '[]'::jsonb)) as e;

  update flow_form_fields
     set archived_at = now(), updated_at = now()
   where flow_id = p_flow_id
     and not (id = any(v_target_form_field_ids))
     and not (
       source = 'default'
       and default_key in (
         select e->>'default_key'
         from jsonb_array_elements(coalesce(v_data->'formFields', '[]'::jsonb)) as e
         where e->>'source' = 'default'
       )
     )
     and archived_at is null;

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'formFields', '[]'::jsonb)) as e
  loop
    if v_elem->>'source' = 'default' then
      update flow_form_fields set
        label = nullif(v_elem->>'label', ''),
        help = nullif(v_elem->>'help', ''),
        field_type = nullif(v_elem->>'field_type', ''),
        options = coalesce(v_elem->'options', '[]'::jsonb),
        is_required = (v_elem->>'is_required')::boolean,
        is_hidden = coalesce((v_elem->>'is_hidden')::boolean, false),
        sort_order = coalesce((v_elem->>'sort_order')::int, 0),
        archived_at = nullif(v_elem->>'archived_at', '')::timestamptz,
        updated_at = now()
      where flow_id = p_flow_id
        and source = 'default'
        and default_key = v_elem->>'default_key'
        and id <> (v_elem->>'id')::uuid;
      if found then
        continue;
      end if;
    end if;

    insert into flow_form_fields (
      id, flow_id, source, default_key, label, help, field_type, options, is_required, is_hidden, sort_order, archived_at, created_at, updated_at
    )
    values (
      (v_elem->>'id')::uuid,
      p_flow_id,
      v_elem->>'source',
      nullif(v_elem->>'default_key', ''),
      nullif(v_elem->>'label', ''),
      nullif(v_elem->>'help', ''),
      nullif(v_elem->>'field_type', ''),
      coalesce(v_elem->'options', '[]'::jsonb),
      (v_elem->>'is_required')::boolean,
      coalesce((v_elem->>'is_hidden')::boolean, false),
      coalesce((v_elem->>'sort_order')::int, 0),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      source = excluded.source,
      default_key = excluded.default_key,
      label = excluded.label,
      help = excluded.help,
      field_type = excluded.field_type,
      options = excluded.options,
      is_required = excluded.is_required,
      is_hidden = excluded.is_hidden,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  -- Follow-up Cadence: one row per Stage, carried in the snapshot keyed by
  -- its Stage id (`id` = stage_id), in followUpService's camelCase shape
  -- (everyDays, proofRequired). Nothing hangs off it, so plain replace.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_follow_up_stage_ids
  from jsonb_array_elements(coalesce(v_data->'followUps', '[]'::jsonb)) as e;

  delete from flow_stage_follow_ups
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (stage_id = any(v_target_follow_up_stage_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'followUps', '[]'::jsonb)) as e
  loop
    insert into flow_stage_follow_ups (stage_id, enabled, every_days, recipients, proof_required, created_at, updated_at)
    values (
      (v_elem->>'id')::uuid,
      coalesce((v_elem->>'enabled')::boolean, false),
      nullif(coalesce(v_elem->>'everyDays', v_elem->>'every_days'), '')::int,
      coalesce(v_elem->'recipients', '[{"type":"role","role":"deal_owner"}]'::jsonb),
      coalesce(coalesce(v_elem->>'proofRequired', v_elem->>'proof_required')::boolean, true),
      coalesce(coalesce(v_elem->>'createdAt', v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (stage_id) do update set
      enabled = excluded.enabled,
      every_days = excluded.every_days,
      recipients = excluded.recipients,
      proof_required = excluded.proof_required,
      updated_at = now();
  end loop;

  -- Access configuration (snapshot `access`) is deliberately NOT restored:
  -- who sees a flow's SORs is set per environment, and the release transfer
  -- (#331) must land Government and Outright with no flow_access_settings.

  update sales_flows
     set won_stage_id = v_won_stage_id,
         award_stage_id = v_award_stage_id,
         contract_stage_id = v_contract_stage_id,
         updated_at = now()
   where id = p_flow_id
  returning * into v_flow;

  return json_build_object('flow', row_to_json(v_flow), 'version', v_snapshot.version);
end;
$$;

grant execute on function public.restore_flow_snapshot(uuid, uuid) to authenticated;

-- ─── Project flows: the "If yes" field follows Product Demo (#900) ─────────────────────────────
-- On a Project Stage that has both fields, "If yes" shows only while Product Demo is "Yes".
-- Matched by label on the same Stage, and only in Project sale types. A field that already has a
-- show_when is left as it is.
update public.flow_stage_fields as yes_field
   set show_when = jsonb_build_object('field_id', demo.id, 'value', 'Yes'),
       updated_at = now()
  from public.flow_stage_fields as demo
  join public.flow_stages as st on st.id = demo.stage_id
  join public.sales_flows as fl on fl.id = st.flow_id
  join public.sale_types as sty on sty.id = fl.sale_type_id
 where demo.stage_id = yes_field.stage_id
   and demo.label = 'Product Demo'
   and demo.archived_at is null
   and yes_field.label = 'If yes'
   and yes_field.archived_at is null
   and yes_field.show_when is null
   and sty.name ilike 'project%';
