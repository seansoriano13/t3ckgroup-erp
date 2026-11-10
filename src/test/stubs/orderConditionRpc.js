import { stubRpc } from "@/test/msw/server"
import { db } from "@/test/db/store"

/**
 * `order_condition_inputs` (supabase/migrations/20261117010000_order_condition_basis.sql,
 * #465, #466) re-implemented on the fake store: counts of the SOR's submitted Transmittals not yet
 * Closed, and of the IPAS naming it that are still open (not filed, not cancelled), plus every
 * submitted, uncancelled Transmittal and uncancelled IPAS naming it as `{ number, state }`, in the
 * order they were seeded. Who may call it is proven in the policy tier (102-goods-checked-orders-filed), not here.
 */
const IN_CHECK = ["warehouse_checking", "warehouse_releasing", "technical_inspection", "awaiting_check"]

export function stubOrderConditionRpcs() {
  stubRpc("order_condition_inputs", ({ p_opportunity_id }) => {
    const rows = (table) => db.internal.rowsOf(table)
    const slipIds = new Set(
      rows("transmittal_lines")
        .filter((l) => l.opportunity_id === p_opportunity_id)
        .map((l) => l.transmittal_id),
    )
    const slips = rows("transmittals").filter((t) => slipIds.has(t.id))
    const orders = rows("ipas").filter((i) => rows("ipas_sors").some((s) => s.ipas_id === i.id && s.opportunity_id === p_opportunity_id))
    const basis = (records) => records.map(({ number, state }) => ({ number, state }))
    return {
      unclosed_slips: slips.filter((t) => IN_CHECK.includes(t.state)).length,
      unfiled_orders: orders.filter((i) => i.state === "open").length,
      slips: basis(slips.filter((t) => !["draft", "cancelled"].includes(t.state))),
      orders: basis(orders.filter((i) => i.state !== "cancelled")),
    }
  })
}
