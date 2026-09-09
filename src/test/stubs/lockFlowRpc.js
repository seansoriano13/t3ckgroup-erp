import { stubRpc } from "@/test/msw/server"
import { db, updateRow } from "@/test/db/store"

const findRow = (table, id) => db.internal.rowsOf(table).find((row) => row.id === id)

/**
 * `lock_sales_flow` (issue #181) lives in Postgres, which the fake database
 * does not execute — so this re-implements its logic in JS against the same
 * in-memory store, the pattern `purchasingService.test.js` established for
 * `sor_raise_procurement_task`. Mirrors the migration's two writes — flip the
 * flow to locked, publish the snapshot — as one stub call so a test can never
 * observe the half-locked state the real function makes impossible.
 */
export function stubLockSalesFlowRpc() {
  stubRpc("lock_sales_flow", (args) => {
    const flow = findRow("sales_flows", args.p_flow_id)
    if (!flow) throw new Error("Sales Flow not found.")
    if (flow.state !== "draft") {
      throw new Error("This Sales Flow is locked. Unlock it first, with a reason, to make changes.")
    }

    const existingVersions = db.internal
      .rowsOf("flow_snapshots")
      .filter((row) => row.flow_id === args.p_flow_id)
      .map((row) => row.version)
    const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1

    const lockedFlow = updateRow("sales_flows", flow, {
      state: "locked",
      locked_at: new Date().toISOString(),
      locked_by: args.p_actor_id,
      updated_at: new Date().toISOString(),
    })

    const snapshot = db.seed("flow_snapshots", {
      flow_id: args.p_flow_id,
      version: nextVersion,
      snapshot_data: args.p_snapshot_data,
      created_by: args.p_actor_id,
    })

    return { flow: lockedFlow, snapshot }
  })
}
