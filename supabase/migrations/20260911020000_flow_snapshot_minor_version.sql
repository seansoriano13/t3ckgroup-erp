-- Issue #188 — Flow Snapshot version numbers carry compatibility (ADR 0020).
--
-- A Flow Snapshot's `version` column has always been a bare counter: v4 might
-- be a typo fix or it might have removed half the flow and stranded deals.
-- Nothing in the number tells a salesperson whether their SOR could safely be
-- moved onto a newer version.
--
-- So the number gains a minor part. `version` stays the major; a new
-- `version_minor` starts at 0. The database — never the client — decides which
-- part moves, in the same transaction that writes the snapshot, so the preview
-- on the Publish button and the result can never disagree:
--
--   * First publish of a Sales Flow  -> 1.0
--   * A Stage id in the latest version is gone from the new one, OR the Won
--     Stage changed  -> next major, minor 0 (deals may be stranded, or the
--     moment a deal becomes Realized has moved)
--   * Anything else  -> same major, minor + 1 (every SOR on that major can
--     safely be moved up)
--
-- Restore keeping ids (#187) is what keeps this honest: a Stage that survives a
-- restore keeps its id, so "same id still present" is a real compatibility
-- signal rather than an accident of how the draft was rebuilt.

alter table flow_snapshots
  add column if not exists version_minor integer not null default 0;

-- Uniqueness moves from (flow, major) to (flow, major, minor): still one Flow
-- Snapshot per number, so two simultaneous publishes computing the same
-- (major, minor) still collide on insert rather than both landing.
alter table flow_snapshots drop constraint if exists flow_snapshots_version_unique;
alter table flow_snapshots
  add constraint flow_snapshots_version_unique unique (flow_id, version, version_minor);

-- The one place the major/minor rule lives. Used by `lock_sales_flow` to write
-- the number and by the canvas to preview it.
create or replace function public.flow_snapshot_next_version(
  p_flow_id uuid,
  p_snapshot_data jsonb
)
returns table (version_major integer, version_minor integer)
language plpgsql
stable
as $$
declare
  v_latest record;
  v_new_stage_ids text[];
  v_stage_removed boolean;
  v_won_changed boolean;
begin
  select fs.version, fs.version_minor, fs.snapshot_data
    into v_latest
  from flow_snapshots fs
  where fs.flow_id = p_flow_id
  order by fs.version desc, fs.version_minor desc
  limit 1;

  if not found then
    version_major := 1;
    version_minor := 0;
    return next;
    return;
  end if;

  select coalesce(array_agg(elem->>'id'), array[]::text[])
    into v_new_stage_ids
  from jsonb_array_elements(coalesce(p_snapshot_data->'stages', '[]'::jsonb)) as elem;

  v_stage_removed := exists (
    select 1
    from jsonb_array_elements(coalesce(v_latest.snapshot_data->'stages', '[]'::jsonb)) as old_elem
    where (old_elem->>'id') is not null
      and not ((old_elem->>'id') = any (v_new_stage_ids))
  );

  v_won_changed :=
    coalesce(nullif(v_latest.snapshot_data->>'wonStageId', ''), '')
    is distinct from
    coalesce(nullif(p_snapshot_data->>'wonStageId', ''), '');

  if v_stage_removed or v_won_changed then
    version_major := v_latest.version + 1;
    version_minor := 0;
  else
    version_major := v_latest.version;
    version_minor := v_latest.version_minor + 1;
  end if;
  return next;
end;
$$;

grant execute on function public.flow_snapshot_next_version(uuid, jsonb) to authenticated;

-- `lock_sales_flow` now takes both numbers from `flow_snapshot_next_version`
-- and returns both. Everything else — the row lock, the draft-state guard, the
-- single transaction (#181, ADR 0013) — is unchanged.
create or replace function public.lock_sales_flow(
  p_flow_id uuid,
  p_actor_id uuid,
  p_snapshot_data jsonb
)
returns json
language plpgsql
as $$
declare
  v_flow record;
  v_major integer;
  v_minor integer;
  v_snapshot record;
begin
  select * into v_flow from sales_flows where id = p_flow_id for update;
  if not found then
    raise exception 'Sales Flow not found.';
  end if;
  if v_flow.state <> 'draft' then
    raise exception 'This Sales Flow is locked. Unlock it first, with a reason, to make changes.';
  end if;

  select version_major, version_minor
    into v_major, v_minor
  from public.flow_snapshot_next_version(p_flow_id, p_snapshot_data);

  update sales_flows set
    state = 'locked',
    locked_at = now(),
    locked_by = p_actor_id,
    updated_at = now()
  where id = p_flow_id
  returning * into v_flow;

  insert into flow_snapshots (flow_id, version, version_minor, snapshot_data, created_by)
  values (p_flow_id, v_major, v_minor, p_snapshot_data, p_actor_id)
  returning * into v_snapshot;

  return json_build_object('flow', row_to_json(v_flow), 'snapshot', row_to_json(v_snapshot));
end;
$$;

grant execute on function public.lock_sales_flow(uuid, uuid, jsonb) to authenticated;
