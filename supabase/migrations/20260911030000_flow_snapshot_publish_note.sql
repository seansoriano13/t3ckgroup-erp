-- Issue #189 — a Flow Snapshot carries the note it was published with.
--
-- "v3.2" says nothing about why it exists. The publish popover lets whoever
-- is locking the flow say, in their own words, why this version exists — the
-- change summary (the Flow Snapshot diff, issue #36) already says *what*
-- changed; this says *why*. Optional: not every publish has a story worth
-- telling, and requiring one would just get a placeholder typed into it.
--
-- `lock_sales_flow` gains a fourth parameter rather than an overload — one
-- signature, so nothing can call the old three-argument shape and publish a
-- Flow Snapshot with no note column filled in.
--
-- It also refuses a draft that is byte-identical to the latest Flow Snapshot
-- (issue #189's "no empty publishes") — the popover already disables Publish
-- for this, using the same finer-grained diff the history dialog shows
-- (`diffFlowSnapshots`, constants/salesFlow.js), but that is a client-side
-- courtesy. This is the backstop for whatever calls the RPC directly, so
-- "empty versions can't be created" holds regardless of caller. A whole-value
-- comparison is coarser than the client's field-by-field diff — it can only
-- ever be *stricter* about what counts as identical, so it never blocks a
-- publish the popover would have allowed.

alter table flow_snapshots
  add column if not exists note text;

drop function if exists public.lock_sales_flow(uuid, uuid, jsonb);

create or replace function public.lock_sales_flow(
  p_flow_id uuid,
  p_actor_id uuid,
  p_snapshot_data jsonb,
  p_note text default null
)
returns json
language plpgsql
as $$
declare
  v_flow record;
  v_major integer;
  v_minor integer;
  v_snapshot record;
  v_latest_data jsonb;
begin
  select * into v_flow from sales_flows where id = p_flow_id for update;
  if not found then
    raise exception 'Sales Flow not found.';
  end if;
  if v_flow.state <> 'draft' then
    raise exception 'This Sales Flow is locked. Unlock it first, with a reason, to make changes.';
  end if;

  select fs.snapshot_data
    into v_latest_data
  from flow_snapshots fs
  where fs.flow_id = p_flow_id
  order by fs.version desc, fs.version_minor desc
  limit 1;

  if v_latest_data is not null and v_latest_data = p_snapshot_data then
    raise exception 'This draft is identical to the latest version. There is nothing to publish.';
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

  insert into flow_snapshots (flow_id, version, version_minor, snapshot_data, created_by, note)
  values (p_flow_id, v_major, v_minor, p_snapshot_data, p_actor_id, nullif(trim(p_note), ''))
  returning * into v_snapshot;

  return json_build_object('flow', row_to_json(v_flow), 'snapshot', row_to_json(v_snapshot));
end;
$$;

grant execute on function public.lock_sales_flow(uuid, uuid, jsonb, text) to authenticated;
