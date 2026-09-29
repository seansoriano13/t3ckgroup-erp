import { stubRpc } from "@/test/msw/server"
import { db, insertRow } from "@/test/db/store"

const rowsOf = (table) => db.internal.rowsOf(table)

/**
 * Issue #413 — `sor_certify_condition` lives in Postgres (see
 * supabase/migrations/20260930260000_certify_condition_on_current_visit.sql),
 * which the fake database does not execute. Mirrors its atomic
 * resolve-the-visit-then-write behavior against the same in-memory store: a
 * tickbox condition is refused, not silently written elsewhere, once the SOR
 * has left the condition's own Stage.
 */
export function stubCertifyConditionRpc() {
  stubRpc("sor_certify_condition", (args) => {
    const opportunity = rowsOf("sales_opportunities").find((o) => o.id === args.p_opportunity_id)
    if (!opportunity) throw new Error("Certify: that SOR could not be found.")

    let visit = null
    if (opportunity.flow_stage_id) {
      visit =
        rowsOf("sor_stage_visits")
          .filter((v) => v.opportunity_id === args.p_opportunity_id && v.left_at == null)
          .sort((a, b) => b.sequence - a.sequence)[0] || null
      if (!visit || visit.flow_stage_id !== args.p_stage_id) {
        throw new Error("Certify: the SOR has left this condition's Stage — the tick was not recorded.")
      }
    }

    const visitId = visit?.id ?? null
    const existing = rowsOf("sor_condition_status").find(
      (s) =>
        s.opportunity_id === args.p_opportunity_id &&
        s.condition_id === args.p_condition_id &&
        (s.stage_visit_id ?? null) === visitId,
    )
    if (existing) return [{ ...existing, was_new: false }]

    const row = insertRow("sor_condition_status", {
      opportunity_id: args.p_opportunity_id,
      condition_id: args.p_condition_id,
      satisfied_by: args.p_actor_id,
      stage_visit_id: visitId,
    })
    return [{ ...row, was_new: true }]
  })
}
