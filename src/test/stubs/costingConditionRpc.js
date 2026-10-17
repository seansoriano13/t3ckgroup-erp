import { stubRpc } from "@/test/msw/server"
import { db } from "@/test/db/store"
import { matrixTotals } from "@/utils/costingMath"

/**
 * `costing_condition_inputs` and `costing_mark_bid_submitted`
 * (supabase/migrations/20261018180000_costing_settled_condition.sql, #272) re-implemented on the
 * fake store: the costing conditions' evidence (booleans and counts) and the "bid submitted"
 * stamp. The ABC comparison goes through costingMath.matrixTotals, which works in exact centavos,
 * as the SQL does. Who may call them is proven in the policy tier
 * (86-costing-settled-condition.test.js), not here.
 */
export function stubCostingConditionRpcs() {
  stubRpc("costing_condition_inputs", ({ p_opportunity_id }) => {
    const rows = (table) => db.internal.rowsOf(table)
    const matrix = rows("costing_matrices").find((m) => m.opportunity_id === p_opportunity_id)
    if (!matrix) return { has_matrix: false }

    const lines = rows("costing_tender_lines").filter((l) => l.matrix_id === matrix.id)
    const priced = lines.map((l) => {
      const price = rows("costing_tender_line_prices").find((p) => p.tender_line_id === l.id)
      return { quantity: l.quantity, abc_unit: price?.abc_unit ?? null, final_offer_unit: price?.final_offer_unit ?? null }
    })
    const totals = matrixTotals(priced)

    const components = rows("costing_components").filter((c) => lines.some((l) => l.id === c.tender_line_id))
    const costRows = rows("costing_cost_rows").filter((r) => r.matrix_id === matrix.id)
    const finalAcquire = [
      ...components.map((c) => rows("costing_component_costs").find((k) => k.component_id === c.id)?.final_acquire_unit ?? null),
      ...costRows.map((r) => r.final_acquire_unit ?? null),
    ]

    return {
      has_matrix: true,
      line_count: lines.length,
      missing_offer: totals.missingOffer,
      over_abc: totals.overAbc,
      costed_rows: finalAcquire.length,
      missing_cost: finalAcquire.filter((v) => v === null).length,
      evaluation_approved: rows("costing_signoffs").some(
        (s) => s.matrix_id === matrix.id && s.role === "evaluation_approved" && !s.cleared_at,
      ),
      bid_verdict: rows("costing_bid_decisions").find((d) => d.matrix_id === matrix.id && !d.cleared_at)?.verdict ?? null,
    }
  })

  stubRpc("costing_mark_bid_submitted", ({ p_opportunity_id }) => {
    const matrix = db.internal.rowsOf("costing_matrices").find((m) => m.opportunity_id === p_opportunity_id)
    if (!matrix || matrix.bid_submitted_at) return false
    matrix.bid_submitted_at = new Date().toISOString()
    return true
  })
}
