import { stubRpc } from "@/test/msw/server"
import { db, updateRow } from "@/test/db/store"

const rowsOf = (table) => db.internal.rowsOf(table)

/**
 * Issue #391 — `sor_start_fresh_stage_work` lives in Postgres (see
 * supabase/migrations/20260930150000_start_fresh.sql), which the fake
 * database does not execute. This mirrors what the service depends on: the
 * earlier visit's live and held tasks are cancelled and its action runs are
 * closed off, and its ticks, files and field values are left where they are.
 */
export function stubStartFreshStageWorkRpc() {
  stubRpc("sor_move_and_start_fresh", (args) => {
    const opportunity = rowsOf("sales_opportunities").find((o) => o.id === args.p_opportunity_id)
    updateRow("sales_opportunities", opportunity, {
      flow_stage_id: args.p_flow_stage_id,
      ...(args.p_contract_date ? { contract_date: args.p_contract_date } : {}),
      ...(args.p_date_of_award && !opportunity.date_of_award ? { date_of_award: args.p_date_of_award } : {}),
    })
    return startFresh({ p_opportunity_id: args.p_opportunity_id })
  })
  stubRpc("sor_start_fresh_stage_work", startFresh)
}

function startFresh(args) {
  const visits = rowsOf("sor_stage_visits").filter((v) => v.opportunity_id === args.p_opportunity_id)
  const current = visits.find((v) => v.left_at == null && !v.undone_at)
  if (!current) throw new Error("Start fresh: this SOR is not on a Stage.")
  const earlier = visits
    .filter((v) => v.flow_stage_id === current.flow_stage_id && !v.undone_at && v.sequence < current.sequence)
    .sort((a, b) => b.sequence - a.sequence)[0]
  if (!earlier) throw new Error("Start fresh: this is not a Return — there is no earlier visit to this Stage.")

  for (const row of rowsOf("tasks")) {
    if (row.stage_visit_id === earlier.id && !["COMPLETED", "DELETED"].includes(row.status)) {
      row.status = "DELETED"
      row.cancel_reason = "Superseded by a fresh start."
    }
  }
  for (const row of rowsOf("committee_tasks")) {
    if (row.stage_visit_id === earlier.id && ["ACTIVE", "ON_HOLD"].includes(row.status)) {
      row.status = "CANCELLED"
      row.cancel_reason = "Superseded by a fresh start."
    }
  }
  for (const row of rowsOf("sor_action_runs")) {
    if (row.stage_visit_id === earlier.id && !row.closed_off_at) {
      row.closed_off_at = new Date().toISOString()
      row.closed_off_reason = "start_fresh"
    }
  }
  current.return_choice = "start_fresh"
  return current
}
