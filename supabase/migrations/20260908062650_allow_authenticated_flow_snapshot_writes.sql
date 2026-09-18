-- Let anyone who can edit a flow also lock one.
--
-- 20260908034000 opened the six Flow Canvas editing tables — sale_types,
-- sales_flows, flow_stages, flow_edges, flow_stage_actions, stage_conditions —
-- to every authenticated employee. It did not touch flow_snapshots, whose
-- insert still required is_super_admin.
--
-- Locking a flow writes a snapshot, and that left a trap rather than a clean
-- refusal. `salesFlowService.lockFlow` performs two writes with no transaction
-- around them, in this order:
--
--   1. update sales_flows set state = 'locked'   -- permitted since 034000
--   2. insert into flow_snapshots ...            -- refused with 42501
--
-- So a non-Super-Admin pressing Lock flipped the flow to locked and then
-- failed, leaving it locked with no snapshot: `requireDraft` refuses every
-- further edit until someone unlocks it, and `entryStageFor` finds no snapshot
-- so no SOR can be registered against that Sale Type at all. Half-published and
-- unusable. See issue #181, and the reproduction in
-- src/test/policy/04-flow-canvas.test.js.
--
-- This aligns the seventh table with the six, which removes the trap: both
-- writes now succeed for the same people.
--
-- Two properties are deliberately kept:
--
--   * `created_by = get_employee_id()` — a snapshot records who published that
--     version, and nobody may attribute one to somebody else. Same shape as
--     sor_insert and flow_plans_insert.
--   * No update or delete policy. Snapshots stay append-only, because a
--     snapshot is the record of what the rules were when a deal was
--     registered, not a document to revise. `sales_opportunities.flow_snapshot_id`
--     depends on that being true for the life of the deal.
--
-- What this does NOT fix: lockFlow is still two unguarded writes, so any
-- failure between them stalls a flow the same way. Making it one transactional
-- RPC is the durable fix and is tracked separately on #181.

drop policy if exists "flow_snapshots_write" on public."flow_snapshots";

create policy "flow_snapshots_write" on public."flow_snapshots"
  as permissive
  for insert
  to authenticated
  with check ((created_by = get_employee_id()));
