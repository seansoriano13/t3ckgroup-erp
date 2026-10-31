import { stubRpc, stubEdgeFunction } from "@/test/msw/server"
import { db, updateRow } from "@/test/db/store"

const findRow = (id) => db.internal.rowsOf("sales_opportunities").find((row) => row.id === id)

/**
 * `sales_reference_card` (supabase/migrations/20261118110000_815_set_sales_reference.sql) lives in
 * Postgres, which the fake database does not run. This answers it from the stored SOR row; the lock
 * and who may edit are given, because the policy tier (815-set-sales-reference.test.js) is the
 * authority on them.
 *
 *   lock        "open" | "fill_once" | "locked"
 *   canEdit     what the caller may do now
 *   odooState   "found" | "not_checked" | "gone" | null
 */
export function stubSalesReferenceCard({
  lock = "open",
  canEdit = true,
  firstStageName = "Lead",
  odooState = null,
  checkedAt = null,
  productCount = 0,
} = {}) {
  stubRpc("sales_reference_card", (args) => {
    const row = findRow(args.p_opportunity_id)
    return {
      sales_reference: row?.sales_reference ?? null,
      lock,
      first_stage_name: firstStageName,
      can_edit: canEdit,
      odoo_state: odooState,
      checked_at: checkedAt,
      product_count: productCount,
      duplicates: [],
    }
  })
}

/**
 * The `sor-sales-reference` edge function: saves the typed S0 on the stored row (as Not checked,
 * the #815 behaviour) and records each call. `refuse` is `{ message, hint }` to answer a refusal.
 * Returns the recorded calls.
 */
export function stubSalesReferenceSave({ refuse = null } = {}) {
  const calls = []
  stubEdgeFunction("sor-sales-reference", (body) => {
    calls.push(body)
    if (refuse) return { success: false, refused: true, ...refuse }
    const value = body.salesReference ? String(body.salesReference).trim().toUpperCase() : null
    updateRow("sales_opportunities", findRow(body.opportunityId), {
      sales_reference: value,
      sales_reference_odoo_state: value ? "not_checked" : null,
    })
    return { success: true, sales_reference: value, odoo_state: value ? "not_checked" : null, checked_at: null }
  })
  return calls
}
