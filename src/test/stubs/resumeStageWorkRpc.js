import { stubRpc } from "@/test/msw/server"
import { db, updateRow } from "@/test/db/store"

const rowsOf = (table) => db.internal.rowsOf(table)

/**
 * Issue #390 — `sor_resume_stage_work` lives in Postgres (see
 * supabase/migrations/20260930130000_resume_previous_work.sql), which the fake
 * database does not execute. This mirrors what the service depends on: the
 * earlier visit's Stage Work moves to the current visit, which records the
 * choice. The held-task and due-date rules are covered by the policy tier.
 */
export function stubResumeStageWorkRpc() {
  // The move and the Resume are one call: the move goes through the fake
  // database's own update, so its visit trigger runs, then the Resume follows.
  stubRpc("sor_move_and_resume", (args) => {
    const opportunity = rowsOf("sales_opportunities").find((o) => o.id === args.p_opportunity_id)
    updateRow("sales_opportunities", opportunity, {
      flow_stage_id: args.p_flow_stage_id,
      ...(args.p_contract_date ? { contract_date: args.p_contract_date } : {}),
    })
    return resume({ p_opportunity_id: args.p_opportunity_id })
  })
  stubRpc("sor_resume_stage_work", resume)
}

function resume(args) {
  const visits = rowsOf("sor_stage_visits").filter((v) => v.opportunity_id === args.p_opportunity_id)
  const current = visits.find((v) => v.left_at == null && !v.undone_at)
  if (!current) throw new Error("Resume: this SOR is not on a Stage.")
  const earlier = visits
    .filter((v) => v.flow_stage_id === current.flow_stage_id && !v.undone_at && v.sequence < current.sequence)
    .sort((a, b) => b.sequence - a.sequence)[0]
  if (!earlier) throw new Error("Resume: this is not a Return — there is no earlier visit to this Stage.")
  for (const table of ["tasks", "committee_tasks", "sor_condition_status", "sor_stage_field_values", "sor_action_runs"]) {
    for (const row of rowsOf(table)) {
      if (row.stage_visit_id === earlier.id) {
        row.stage_visit_id = current.id
        row.carried_from_visit_id = earlier.id
      }
    }
  }
  earlier.resumed_at = new Date().toISOString()
  earlier.resumed_into_visit_id = current.id
  current.return_choice = "resume"
  return current
}
