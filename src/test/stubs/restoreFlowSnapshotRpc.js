import { stubRpc } from "@/test/msw/server"
import { db, updateRow, insertRow, deleteRows } from "@/test/db/store"

const rowsOf = (table) => db.internal.rowsOf(table)
const findRow = (table, id) => rowsOf(table).find((row) => row.id === id)
const deleteWhere = (table, predicate) => deleteRows(table, rowsOf(table).filter(predicate))
const timestamp = () => new Date().toISOString()

/**
 * Upserts every row of a target list under its original id — the one shape
 * behind reconciling Stages, moves, Actions and Conditions to a Snapshot's
 * shape. `buildFields` turns a snapshot row into the columns to write;
 * `extraOnInsert` supplies the columns only a fresh insert needs (the parent
 * `flow_id` a Stage or move belongs to — an existing row already has it).
 */
function upsertByTarget(table, targetRows, buildFields, extraOnInsert = {}) {
  for (const row of targetRows) {
    const existing = findRow(table, row.id)
    const fields = buildFields(row)
    if (existing) updateRow(table, existing, fields)
    else insertRow(table, { id: row.id, ...extraOnInsert, ...fields })
  }
}

/**
 * `restore_flow_snapshot` (issue #187) lives in Postgres, which the fake
 * database does not execute — so this re-implements its logic in JS against
 * the same in-memory store, the pattern `lockFlowRpc.js` established for
 * `lock_sales_flow`.
 *
 * Mirrors the function: lock the flow, refuse up front if a dropped Stage is
 * still referenced by an SOR (soft-deleted ones count, and the message says
 * so), then reshape the draft in place keeping every id.
 */
export function stubRestoreFlowSnapshotRpc() {
  stubRpc("restore_flow_snapshot", (args) => {
    const flowId = args.p_flow_id
    const flow = findRow("sales_flows", flowId)
    if (!flow) throw new Error("Sales Flow not found.")
    if (flow.state !== "draft") {
      throw new Error("This Sales Flow is locked. Unlock it first, with a reason, to make changes.")
    }

    const snapshot = findRow("flow_snapshots", args.p_snapshot_id)
    if (!snapshot) throw new Error("That Flow Snapshot does not exist.")
    if (snapshot.flow_id !== flowId) {
      throw new Error("That Flow Snapshot does not belong to this flow.")
    }

    const data = snapshot.snapshot_data || {}
    const stages = data.stages || []
    const edges = data.edges || []
    const actions = data.actions || []
    const conditions = data.conditions || []
    const wonStageId = data.wonStageId ?? null

    const targetStageIds = new Set(stages.map((s) => s.id))
    const targetEdgeIds = new Set(edges.map((e) => e.id))
    const targetActionIds = new Set(actions.map((a) => a.id))
    const targetConditionIds = new Set(conditions.map((c) => c.id))

    const liveStages = rowsOf("flow_stages").filter((s) => s.flow_id === flowId)
    const droppedStages = liveStages.filter((s) => !targetStageIds.has(s.id))

    const blockers = []
    for (const stage of [...droppedStages].sort((a, b) => a.name.localeCompare(b.name))) {
      const sors = rowsOf("sales_opportunities").filter((o) => o.flow_stage_id === stage.id)
      if (sors.length === 0) continue
      const soft = sors.filter((o) => o.is_deleted === true).length
      let suffix = ""
      if (soft === sors.length) suffix = ` (all ${sors.length} soft-deleted)`
      else if (soft > 0) suffix = ` (${soft} of them soft-deleted)`
      blockers.push(
        `"${stage.name}" is referenced by ${sors.length} SOR${sors.length === 1 ? "" : "s"}${suffix}`,
      )
    }
    if (blockers.length > 0) {
      throw new Error(
        `This version cannot be restored yet: ${blockers.join("; ")}. Move those deals to another Stage first.`,
      )
    }

    // Clear the Won Stage before any Stage is deleted.
    updateRow("sales_flows", flow, { won_stage_id: null, updated_at: timestamp() })

    // Drop the Stages the target does not have, and everything hanging off them.
    const droppedIds = new Set(droppedStages.map((s) => s.id))
    deleteWhere("flow_edges", (e) => droppedIds.has(e.from_stage_id) || droppedIds.has(e.to_stage_id))
    deleteWhere("flow_stage_actions", (a) => droppedIds.has(a.stage_id))
    deleteWhere("stage_conditions", (c) => droppedIds.has(c.stage_id))
    deleteRows("flow_stages", droppedStages)

    // Upsert every target Stage, move, Action and Condition under its original id.
    upsertByTarget(
      "flow_stages",
      stages,
      (s) => ({
        name: s.name,
        sort_order: s.sort_order ?? 0,
        is_terminal: s.is_terminal ?? false,
        pos_x: s.pos_x ?? 0,
        pos_y: s.pos_y ?? 0,
        color: s.color ?? null,
        bracket_label: s.bracket_label ?? null,
        updated_at: timestamp(),
      }),
      { flow_id: flowId },
    )

    deleteWhere("flow_edges", (e) => e.flow_id === flowId && !targetEdgeIds.has(e.id))
    upsertByTarget(
      "flow_edges",
      edges,
      (e) => ({ from_stage_id: e.from_stage_id, to_stage_id: e.to_stage_id }),
      { flow_id: flowId },
    )

    const flowStageIds = new Set(rowsOf("flow_stages").filter((s) => s.flow_id === flowId).map((s) => s.id))
    deleteWhere("flow_stage_actions", (a) => flowStageIds.has(a.stage_id) && !targetActionIds.has(a.id))
    upsertByTarget("flow_stage_actions", actions, (a) => ({
      stage_id: a.stage_id,
      kind: a.kind,
      config: a.config ?? {},
      sort_order: a.sort_order ?? 0,
      archived_at: a.archived_at ?? null,
      updated_at: timestamp(),
    }))

    deleteWhere("stage_conditions", (c) => flowStageIds.has(c.stage_id) && !targetConditionIds.has(c.id))
    upsertByTarget("stage_conditions", conditions, (c) => ({
      stage_id: c.stage_id,
      kind: c.kind,
      label: c.label,
      is_required: c.is_required ?? true,
      sort_order: c.sort_order ?? 0,
      config: c.config ?? {},
      archived_at: c.archived_at ?? null,
      updated_at: timestamp(),
    }))

    const updatedFlow = updateRow("sales_flows", flow, { won_stage_id: wonStageId, updated_at: timestamp() })

    return { flow: updatedFlow, version: snapshot.version }
  })
}
