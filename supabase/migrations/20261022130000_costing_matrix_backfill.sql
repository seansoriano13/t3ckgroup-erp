-- Release backfill: open the Costing Matrix on SORs already past its stage
-- (#468, spec #461 Q23, ADR 0033).
--
-- Stage Actions fire when an SOR enters a stage, and an SOR stays on its own
-- Flow Snapshot. An SOR already at or beyond the stage where its snapshot mounts
-- Open Costing Matrix on release day would never get a matrix. This is the
-- one-off that gives it one.
--
--   costing_matrix_backfill(p_dry_run boolean default true)
--
-- * Dry run (the default) writes nothing and returns, per flow, the SORs that
--   would get a matrix and why.
-- * A real run opens each listed SOR's matrix through costing_open_matrix, the
--   function the Open Costing Matrix action itself ends in, with the config
--   saved in that SOR's own Flow Snapshot (resolved by the same helper the
--   action uses, _costing_action_open_args).
-- * Adds only, never deletes. Idempotent: an SOR that already has a matrix is
--   reported and left alone, so a second run creates (and changes) nothing.
-- * Soft-deleted SORs (is_deleted) are skipped; so are SORs upstream of the
--   mounting stage.
-- * EXECUTE: signed-in callers only get past the guard when they are a Super
--   Admin; the service role always does. No sor_action_runs row is written: the
--   SOR never entered the stage while the action was mounted.
--
-- Re-runnable SQL: create or replace throughout.

-- ---------------------------------------------------------------------------
-- _costing_action_open_args: an action's saved config -> costing_open_matrix args
-- ---------------------------------------------------------------------------
-- The config resolution that used to live inside sor_open_costing_matrix,
-- unchanged, so the action and the backfill cannot drift apart.
create or replace function public._costing_action_open_args(
  p_opp public.sales_opportunities,
  p_config jsonb,
  p_visit uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_config jsonb := coalesce(p_config, '{}'::jsonb);
  v_sel jsonb;
  v_sales uuid;
  v_buyer uuid;
  v_until text;
  v_until_stage uuid;
  v_members jsonb;
  v_assigners jsonb;
begin
  -- Sales Incharge: the configured role or person; the Deal Owner role by default.
  v_sel := coalesce(v_config->'salesIncharge', jsonb_build_object('type', 'role', 'role', 'deal_owner'));
  v_sales := case v_sel->>'type'
    when 'employee' then nullif(v_sel->>'id', '')::uuid
    when 'role' then case v_sel->>'role'
      when 'deal_owner' then p_opp.deal_owner_id
      when 'closing_sales' then p_opp.closing_sales_id
      when 'support_sales' then coalesce(p_opp.support_sales_1_id, p_opp.support_sales_2_id)
      when 'sales_director' then p_opp.sales_director_id
      when 'registrar' then p_opp.registered_by
    end
  end;
  select e.id into v_sales from public.employees e where e.id = v_sales and not coalesce(e.is_deleted, false);

  if v_config->'purchasingIncharge'->>'type' = 'employee' then
    select e.id into v_buyer from public.employees e
     where e.id = nullif(v_config->'purchasingIncharge'->>'id', '')::uuid and not coalesce(e.is_deleted, false);
  end if;

  v_until := coalesce(nullif(v_config->'access'->>'until', ''), 'stage_left');
  if v_until in ('stage_entered', 'later_stage_left') then
    v_until_stage := nullif(v_config->'access'->>'stageId', '')::uuid;
  end if;

  select coalesce(jsonb_agg(e.id), '[]'::jsonb) into v_members
  from public.employees e
  where not coalesce(e.is_deleted, false)
    and exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(v_config->'extras') = 'array' then v_config->'extras' else '[]'::jsonb end
      ) s
      where public.sor_selector_covers(s, p_opp, e.id)
    );

  select coalesce(jsonb_agg(e.id), '[]'::jsonb) into v_assigners
  from public.employees e
  where not coalesce(e.is_deleted, false)
    and exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(v_config->'assigners') = 'array' then v_config->'assigners' else '[]'::jsonb end
      ) s
      where public.sor_selector_covers(s, p_opp, e.id)
    );

  return jsonb_build_object(
    'sales_incharge_id', v_sales,
    'purchasing_incharge_id', v_buyer,
    'default_preset_id', nullif(v_config->>'markupPresetId', ''),
    'member_ids', v_members,
    'opened_visit_id', p_visit,
    'access_until', v_until,
    'access_until_stage_id', v_until_stage,
    'assigner_ids', v_assigners
  );
end;
$$;

revoke all on function public._costing_action_open_args(public.sales_opportunities, jsonb, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- sor_open_costing_matrix: same behaviour, now through the shared helper
-- ---------------------------------------------------------------------------
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
  if v_action->>'kind' is distinct from 'open_costing_matrix' then
    raise exception 'sor_open_costing_matrix: run % is not an Open Costing Matrix action', p_run_id
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

comment on function public.sor_open_costing_matrix(uuid, jsonb) is
  '#462: the Open Costing Matrix Stage Action. Opens the SOR''s one Costing Matrix or tops an existing one up (blank Incharges, a missing default factor, missing members), from the action''s saved config, under the caller''s full-access check, and marks the run created with its matrix. p_config is ignored.';

revoke all on function public.sor_open_costing_matrix(uuid, jsonb) from public, anon;
grant execute on function public.sor_open_costing_matrix(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- _costing_backfill_hits: (SOR, mounting action) pairs the SOR is at or past
-- ---------------------------------------------------------------------------
-- Reads each live SOR's own Flow Snapshot: its Open Costing Matrix actions and
-- its edges, and walks forward from the mounting stage. A snapshot without an
-- `edges` array is never guessed at from the live flow_edges: its SOR comes back
-- with has_edges = false and the backfill skips it. Both snapshot action shapes (an array,
-- or arrays keyed by Stage) are read, as in _sor_action_run_saved_action.
-- `seq` orders a SOR's actions as the snapshot lists them.
create or replace function public._costing_backfill_hits()
returns table (
  opportunity_id uuid,
  flow_id uuid,
  action_id uuid,
  action_config jsonb,
  mounting_stage_id uuid,
  seq bigint,
  has_edges boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with recursive sor as (
    select o.id, o.flow_stage_id, fs.flow_id, fs.snapshot_data,
           coalesce(jsonb_typeof(fs.snapshot_data->'edges') = 'array', false) as has_edges
      from public.sales_opportunities o
      join public.flow_snapshots fs on fs.id = o.flow_snapshot_id
     where not coalesce(o.is_deleted, false)
       and o.flow_stage_id is not null
  ),
  acts as (
    select s.id as opp, s.flow_id, a.value as act, a.ord as ord,
           nullif(coalesce(a.value->>'stage_id', a.key), '')::uuid as stage_id
      from sor s,
      lateral (
        select e.value, e.ordinality as ord, null::text as key
          from jsonb_array_elements(
            case when jsonb_typeof(s.snapshot_data->'actions') = 'array' then s.snapshot_data->'actions' else '[]'::jsonb end
          ) with ordinality e(value, ordinality)
        union all
        select e.value, e.ordinality, g.key
          from jsonb_each(
            case when jsonb_typeof(s.snapshot_data->'actions') = 'object' then s.snapshot_data->'actions' else '{}'::jsonb end
          ) g,
          jsonb_array_elements(g.value) with ordinality e(value, ordinality)
      ) a
     where a.value->>'kind' = 'open_costing_matrix'
       and coalesce(a.value->>'archived_at', '') = ''
  ),
  edges as (
    select s.id as opp, (e.value->>'from_stage_id')::uuid as f, (e.value->>'to_stage_id')::uuid as t
      from sor s,
      lateral jsonb_array_elements(
        case when jsonb_typeof(s.snapshot_data->'edges') = 'array' then s.snapshot_data->'edges' else '[]'::jsonb end
      ) e
  ),
  reach(opp, mount, stage) as (
    select distinct a.opp, a.stage_id, a.stage_id from acts a where a.stage_id is not null
    union
    select r.opp, r.mount, e.t
      from reach r
      join edges e on e.opp = r.opp and e.f = r.stage
  )
  select a.opp, a.flow_id, (a.act->>'id')::uuid, coalesce(a.act->'config', '{}'::jsonb), a.stage_id,
         row_number() over (partition by a.opp order by a.stage_id, a.ord),
         s.has_edges
    from acts a
    join sor s on s.id = a.opp
    left join reach r on r.opp = a.opp and r.mount = a.stage_id and r.stage = s.flow_stage_id
   where a.stage_id is not null
     and (r.opp is not null or not s.has_edges);
$$;

revoke all on function public._costing_backfill_hits() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- costing_matrix_backfill
-- ---------------------------------------------------------------------------
-- One row per SOR, grouped by flow. outcome:
--   would_open          dry run: this SOR would get a matrix
--   opened              real run: this SOR got a matrix
--   already_has_matrix  left alone (this is what makes a second run a no-op)
--   failed              real run: this SOR could not be opened (see reason); the rest ran
--   skipped_no_snapshot_edges  its Flow Snapshot has no edges array, so where it stands
--                       cannot be told; nothing is written (dry and real runs alike)
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
      when v_at_stage then format('At the stage that mounts Open Costing Matrix (%s)', v_mount_names)
      else format('Downstream of the stage that mounts Open Costing Matrix (%s)', v_mount_names)
    end;

    if not v_has_edges then
      v_outcome := 'skipped_no_snapshot_edges';
      v_matrix := null;
      v_reason := format('Flow Snapshot has no edges, so the SOR''s position cannot be told (mounts Open Costing Matrix at %s)', v_mount_names);
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

comment on function public.costing_matrix_backfill(boolean) is
  '#468: release backfill. Opens the Costing Matrix on every live SOR at or downstream of the stage its own Flow Snapshot mounts Open Costing Matrix on. Dry run by default; adds only; an SOR that already has a matrix is left alone, so re-running creates nothing. Service role or Super Admin only.';

revoke all on function public.costing_matrix_backfill(boolean) from public, anon;
grant execute on function public.costing_matrix_backfill(boolean) to authenticated, service_role;
