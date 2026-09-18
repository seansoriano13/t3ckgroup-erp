-- Issue #181, the durable half of the fix.
--
-- 20260908062650 closed the RLS gap (locking a flow needs to write to
-- flow_snapshots too, and that table was still Super-Admin-only), which
-- removed the *refusal*. It did not remove the *trap*: `lockFlow` still
-- performed two separate round trips —
--
--   1. update sales_flows set state = 'locked'
--   2. insert into flow_snapshots ...
--
-- — with nothing tying them together. Any failure between them (a dropped
-- connection, a thrown exception building the snapshot payload) still leaves
-- a flow flipped to locked with no snapshot: `requireDraft` refuses every
-- further edit, and `entryStageFor` has nothing to pin an SOR to.
--
-- Folding both writes into one plpgsql function makes them succeed or fail
-- together — a single function invocation is one transaction. `FOR UPDATE`
-- serializes a double-lock into one successful call and a clean refusal
-- rather than two snapshots at the same version (already prevented by the
-- `flow_snapshots_version_unique` constraint, but this fails earlier and
-- with a clearer message).
--
-- SECURITY INVOKER (the default): both tables already carry
-- `using (true) / with check (true)`-shaped write policies for every
-- authenticated employee (20260908034000, 20260908062650), so there is no
-- privilege to bypass — this is purely about atomicity, not authorization.

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
  v_next_version integer;
  v_snapshot record;
begin
  select * into v_flow from sales_flows where id = p_flow_id for update;
  if not found then
    raise exception 'Sales Flow not found.';
  end if;
  if v_flow.state <> 'draft' then
    raise exception 'This Sales Flow is locked. Unlock it first, with a reason, to make changes.';
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from flow_snapshots where flow_id = p_flow_id;

  update sales_flows set
    state = 'locked',
    locked_at = now(),
    locked_by = p_actor_id,
    updated_at = now()
  where id = p_flow_id
  returning * into v_flow;

  insert into flow_snapshots (flow_id, version, snapshot_data, created_by)
  values (p_flow_id, v_next_version, p_snapshot_data, p_actor_id)
  returning * into v_snapshot;

  return json_build_object('flow', row_to_json(v_flow), 'snapshot', row_to_json(v_snapshot));
end;
$$;

grant execute on function public.lock_sales_flow(uuid, uuid, jsonb) to authenticated;
