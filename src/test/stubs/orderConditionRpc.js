import { stubRpc } from "@/test/msw/server"
import { db } from "@/test/db/store"

/**
 * `order_condition_inputs` (supabase/migrations/20261022110000_goods_checked_orders_filed.sql,
 * #465, #466) re-implemented on the fake store: counts of the SOR's submitted Transmittals not yet
 * Closed. Who may call it is proven in the policy tier (102-goods-checked-orders-filed), not here.
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
    return {
      unclosed_slips: rows("transmittals").filter((t) => slipIds.has(t.id) && IN_CHECK.includes(t.state)).length,
    }
  })
}
