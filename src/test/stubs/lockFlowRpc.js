import { stubRpc } from "@/test/msw/server"
import { db, updateRow } from "@/test/db/store"

const findRow = (table, id) => db.internal.rowsOf(table).find((row) => row.id === id)

/**
 * The latest snapshot of a flow by (version, version_minor), or null.
 */
function latestSnapshot(flowId) {
  return db.internal
    .rowsOf("flow_snapshots")
    .filter((row) => row.flow_id === flowId)
    .sort((a, b) => b.version - a.version || (b.version_minor ?? 0) - (a.version_minor ?? 0))[0]
}

/**
 * The major/minor rule (ADR 0020), re-implemented against the in-memory store
 * because `flow_snapshot_next_version` lives in Postgres. The policy tier is
 * the authority on it; this stub only has to mirror it:
 *
 *   - no prior snapshot        -> 1.0
 *   - a Stage id in the latest is gone, or the Won Stage changed -> next major, .0
 *   - anything else            -> same major, minor + 1
 */
export function nextFlowVersion(flowId, snapshotData) {
  const latest = latestSnapshot(flowId)
  if (!latest) return { major: 1, minor: 0 }

  const newIds = new Set((snapshotData?.stages || []).map((s) => s.id))
  const stageRemoved = (latest.snapshot_data?.stages || []).some(
    (s) => s.id != null && !newIds.has(s.id),
  )
  const wonChanged =
    (latest.snapshot_data?.wonStageId ?? null) !== (snapshotData?.wonStageId ?? null)

  if (stageRemoved || wonChanged) return { major: latest.version + 1, minor: 0 }
  return { major: latest.version, minor: (latest.version_minor ?? 0) + 1 }
}

/**
 * `lock_sales_flow` (issue #181) and `flow_snapshot_next_version` (#188) live
 * in Postgres, which the fake database does not execute — so this re-implements
 * their logic in JS against the same in-memory store, the usual
 * fake-database RPC stub pattern.
 * Mirrors the migration's writes — flip the flow to locked, publish the
 * snapshot at the computed (major, minor) — as one stub call so a test can
 * never observe the half-locked state the real function makes impossible.
 */
export function stubLockSalesFlowRpc() {
  stubRpc("flow_snapshot_next_version", (args) => {
    const { major, minor } = nextFlowVersion(args.p_flow_id, args.p_snapshot_data)
    return [{ version_major: major, version_minor: minor }]
  })

  stubRpc("lock_sales_flow", (args) => {
    const flow = findRow("sales_flows", args.p_flow_id)
    if (!flow) throw new Error("Sales Flow not found.")
    if (flow.state !== "draft") {
      throw new Error("This Sales Flow is locked. Unlock it first, with a reason, to make changes.")
    }

    // Mirrors the migration's whole-value equality backstop (issue #189):
    // stricter than the client's field-by-field diff, so it never blocks a
    // publish the popover would have allowed, only ones nothing changed at all.
    const latest = latestSnapshot(args.p_flow_id)
    if (latest && JSON.stringify(latest.snapshot_data) === JSON.stringify(args.p_snapshot_data)) {
      throw new Error("This draft is identical to the latest version. There is nothing to publish.")
    }

    const { major, minor } = nextFlowVersion(args.p_flow_id, args.p_snapshot_data)

    const lockedFlow = updateRow("sales_flows", flow, {
      state: "locked",
      locked_at: new Date().toISOString(),
      locked_by: args.p_actor_id,
      updated_at: new Date().toISOString(),
    })

    const note = typeof args.p_note === "string" ? args.p_note.trim() : ""

    const snapshot = db.seed("flow_snapshots", {
      flow_id: args.p_flow_id,
      version: major,
      version_minor: minor,
      snapshot_data: args.p_snapshot_data,
      created_by: args.p_actor_id,
      note: note || null,
    })

    return { flow: lockedFlow, snapshot }
  })
}
