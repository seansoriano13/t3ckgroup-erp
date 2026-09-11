-- Issue #187 — Restore a Flow Snapshot into the draft as one transaction.
--
-- The old restore ran from the client: clear the Won Stage, then delete every
-- Stage one at a time, then rebuild from the snapshot with `addStage`. Two
-- things were wrong with it.
--
--   1. `flow_stages.id` is the target of `sales_opportunities.flow_stage_id`,
--      which is ON DELETE RESTRICT. The first Stage a live SOR sits on makes
--      the delete fail — but by then earlier Stages and their edges are gone,
--      leaving a half-deleted draft that nothing can finish.
--   2. Even on the happy path every Stage came back with a new id, so the next
--      version's changelog read as "everything removed, everything added".
--
-- `restore_flow_snapshot` folds the whole thing into one plpgsql function —
-- one invocation, one transaction, succeeds or changes nothing — the same
-- shape as `lock_sales_flow` (20260909130000) and ADR 0013. It locks the
-- Sales Flow row first, refuses up front if a dropped Stage is still
-- referenced (naming each Stage and its SOR count, soft-deleted SORs
-- included), then reshapes the draft in place keeping every id.
--
-- SECURITY INVOKER (the default): every flow table already carries
-- `using (true) / with check (true)` write policies for authenticated
-- employees (20260908034000, 20260908062650). This is about atomicity and
-- id preservation, not authorization.
--
-- Importing a snapshot as a brand-new Sale Type's starting point still goes
-- through `materializeSnapshotIntoFlow` in the service and still mints new
-- ids — that is a different Sales Flow, so it must.

create or replace function public.restore_flow_snapshot(
  p_flow_id uuid,
  p_snapshot_id uuid,
  p_actor_id uuid
)
returns json
language plpgsql
as $$
declare
  v_flow record;
  v_snapshot record;
  v_data jsonb;
  v_target_stage_ids uuid[];
  v_target_edge_ids uuid[];
  v_target_action_ids uuid[];
  v_target_condition_ids uuid[];
  v_won_stage_id uuid;
  v_blockers text[] := array[]::text[];
  v_rec record;
  v_elem jsonb;
begin
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
  update sales_flows set won_stage_id = null, updated_at = now() where id = p_flow_id;

  -- Two Stages can swap names. The one-name-per-flow index is checked row by
  -- row, so park every surviving Stage on a unique placeholder first.
  update flow_stages set name = '__restore__' || id::text where flow_id = p_flow_id;

  -- Drop the Stages the target does not have. Their edges, conditions and
  -- actions go by cascade; the check above proved no SOR is referenced.
  delete from flow_stages
   where flow_id = p_flow_id
     and not (id = any(v_target_stage_ids));

  -- Upsert every target Stage under its original id.
  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'stages', '[]'::jsonb)) as e
  loop
    insert into flow_stages (
      id, flow_id, name, sort_order, is_terminal, pos_x, pos_y, color, bracket_label, created_at, updated_at
    )
    values (
      (v_elem->>'id')::uuid,
      p_flow_id,
      v_elem->>'name',
      coalesce((v_elem->>'sort_order')::int, 0),
      coalesce((v_elem->>'is_terminal')::boolean, false),
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

  update sales_flows
     set won_stage_id = v_won_stage_id,
         updated_at = now()
   where id = p_flow_id
  returning * into v_flow;

  return json_build_object('flow', row_to_json(v_flow), 'version', v_snapshot.version);
end;
$$;

grant execute on function public.restore_flow_snapshot(uuid, uuid, uuid) to authenticated;
