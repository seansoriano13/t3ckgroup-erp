import { stubRpc } from "@/test/msw/server"
import { db, updateRow, insertRow } from "@/test/db/store"

const rowsOf = (table) => db.internal.rowsOf(table)
const findRow = (table, id) => rowsOf(table).find((row) => row.id === id)
const versionLabel = (snapshot) => `v${snapshot.version}.${snapshot.version_minor ?? 0}`

/**
 * `move_opportunities_to_flow_snapshot`
 * (supabase/migrations/20261005130000_move_opportunities_to_flow_snapshot.sql)
 * lives in Postgres, which the fake database does not execute — so this
 * re-implements it in JS against the same in-memory store, the pattern
 * stubReplaceItemsRpc established. Mirrors its rules per SOR: refuse a deleted
 * or flow-less deal, a snapshot of another flow, and a deal whose Stage the
 * target lacks; otherwise touch `flow_snapshot_id` only and write the timeline
 * note and audit entry. One SOR failing never stops the rest.
 *
 * RLS is not modelled by the fake database, so the real function's "you
 * cannot update this deal" branch has no counterpart here; the policy tier
 * owns it.
 */
export function moveOpportunitiesToFlowSnapshot(args) {
  const target = findRow("flow_snapshots", args.p_target_snapshot_id)
  if (!target) throw new Error("Flow Snapshot not found.")
  const targetLabel = versionLabel(target)

  const moved = []
  const failed = []

  for (const id of args.p_opportunity_ids || []) {
    const deal = findRow("sales_opportunities", id)
    if (!deal || deal.is_deleted === true) {
      failed.push({ id, reason: "This deal no longer exists or you cannot see it." })
      continue
    }
    if (!deal.sale_type_id) {
      failed.push({
        id,
        reason: "This deal does not run a Sales Flow, so it has no Flow Snapshot to move.",
      })
      continue
    }
    const flow = rowsOf("sales_flows").find((f) => f.sale_type_id === deal.sale_type_id)
    if (!flow || flow.id !== target.flow_id) {
      failed.push({ id, reason: "That Flow Snapshot belongs to a different flow." })
      continue
    }
    const targetStages = target.snapshot_data?.stages || []
    if (!targetStages.some((s) => s.id === deal.flow_stage_id)) {
      failed.push({
        id,
        reason: `This deal's current Stage does not exist in Flow Snapshot ${targetLabel}, so moving it would strand it. Move it to a different Stage first, or choose a different snapshot.`,
      })
      continue
    }

    const source = deal.flow_snapshot_id ? findRow("flow_snapshots", deal.flow_snapshot_id) : null
    const sourceLabel = deal.flow_snapshot_id
      ? source
        ? versionLabel(source)
        : "an unknown Flow Snapshot"
      : "no Flow Snapshot"

    updateRow("sales_opportunities", deal, { flow_snapshot_id: target.id })

    const event = {
      event: "FLOW_SNAPSHOT_MOVED",
      from: deal.flow_snapshot_id === target.id ? null : source?.id ?? null,
      to: target.id,
    }
    insertRow("sales_opportunity_logs", {
      opportunity_id: id,
      type: "SYSTEM",
      content: `Flow Snapshot changed: ${sourceLabel} → ${targetLabel}.`,
      metadata: event,
    })
    const label = deal.sales_reference
      ? `Sales opportunity ${deal.sales_reference}`
      : `Sales opportunity for ${deal.client_name}`
    insertRow("system_audit_logs", {
      type: "SYSTEM",
      entity_type: "OPPORTUNITY",
      entity_id: id,
      content: `${label}: Flow Snapshot changed ${sourceLabel} → ${targetLabel}.`,
      metadata: event,
    })
    moved.push({ id })
  }

  return { moved, failed }
}

export function stubMoveOpportunitiesToSnapshotRpc() {
  stubRpc("move_opportunities_to_flow_snapshot", moveOpportunitiesToFlowSnapshot)
  // update_sor_versions (#743) shares the per-SOR rules; who-may-update is the policy tier's.
  stubRpc("update_sor_versions", moveOpportunitiesToFlowSnapshot)
}
