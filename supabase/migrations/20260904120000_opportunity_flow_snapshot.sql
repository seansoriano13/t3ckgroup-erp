-- ==============================================================================
-- 20260904120000_opportunity_flow_snapshot.sql
--
-- An SOR runs the Flow Snapshot it was registered under (issue #83).
--
-- Today a flow-built deal (sale_type_id set) resolves its permitted moves,
-- Stage Conditions, Stage Actions and Won Stage from the LIVE flow tables via
-- flow_stage_id alone. Editing a Sales Flow after deals are already running it
-- silently changes the rules those deals are held to mid-run. flow_snapshots
-- already exists (0057) and is written on every lock — nothing reads it back.
--
-- This adds the missing link: flow_snapshot_id names the immutable
-- flow_snapshots row an SOR's rules are resolved from for the rest of its
-- life, until moved onto a newer one deliberately (a service-layer operation,
-- not this migration).
--
-- NULLABLE, ON PURPOSE, FOR NOW
-- "An SOR without a snapshot is not a valid state" is the eventual rule, but
-- it is enforced going forward at the service layer (registration and moves
-- refuse to proceed without one), not as a blanket NOT NULL here. Checked
-- against live staging directly: every flow-built SOR whose flow has ever
-- been locked backfills cleanly below. One does not (a Sale Type whose flow
-- was never locked, confirmed to be test data) — a NOT NULL constraint would
-- fail on that row for no correct value to give it, so the column stays
-- nullable until it is dealt with.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * One new nullable column; no existing row's meaning changes.
--   * The backfill only ever sets a currently-null column from data that
--     already exists (each Sale Type's own flow's latest snapshot) — it
--     invents nothing and is idempotent (WHERE flow_snapshot_id IS NULL).
--   * No running frontend names this column yet.
-- ==============================================================================

alter table public.sales_opportunities
  add column if not exists flow_snapshot_id uuid references public.flow_snapshots (id);

create index if not exists sales_opportunities_flow_snapshot_idx
  on public.sales_opportunities (flow_snapshot_id)
  where flow_snapshot_id is not null;

comment on column public.sales_opportunities.flow_snapshot_id is
  'Issue #83: the Flow Snapshot this deal''s rules (moves, conditions, actions, Won Stage) are resolved from, until moved onto a newer one deliberately. Null only for a flow-built deal whose flow has never been locked.';

-- Backfill: every flow-built SOR with no snapshot yet gets its Sale Type's
-- flow's latest (highest-version) snapshot, where one exists.
update public.sales_opportunities so
set flow_snapshot_id = latest.id
from (
  select distinct on (fs.flow_id) fs.flow_id, fs.id
  from public.flow_snapshots fs
  order by fs.flow_id, fs.version desc
) as latest
join public.sales_flows sf on sf.id = latest.flow_id
where so.sale_type_id = sf.sale_type_id
  and so.flow_snapshot_id is null;
