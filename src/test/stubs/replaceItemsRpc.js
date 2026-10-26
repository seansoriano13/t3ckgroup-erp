import { stubRpc } from "@/test/msw/server"
import { db, insertRow, updateRow, deleteRows } from "@/test/db/store"
import { syncRequestItems } from "@/test/stubs/sorItemSync"

const rowsOf = (table) => db.internal.rowsOf(table)

/**
 * `sor_replace_items` (supabase/migrations/20261104110000_sor_lines_keep_odoo_line_id.sql)
 * lives in Postgres, which the fake database does not execute. Re-implemented
 * here against the same in-memory store, the pattern stubActionRunRpcs
 * established, so opportunityService.replaceItems keeps exercising the real
 * match rules — and the fake's own sor_recalc_expected_value mirror in
 * triggers.js — through the RPC instead of direct table calls.
 *
 * The rules, as in the function: a line is matched by its Odoo line id, then
 * by its own id, then (an older line with no Odoo line id) once by Odoo
 * product id; a matched line is updated in place, an unmatched one added. A
 * stored line with an Odoo line id that is not sent again is kept and marked
 * `removed_from_s0`; a hand-typed one is deleted. A line already as sent is
 * not written.
 *
 * The SOR's Purchase Request, if it has one, then has an item for every line (the line trigger of
 * 20261104130000_requested_item_follows_s0.sql): see sorItemSync.js.
 *
 * Returns the "before" Product List, same as the real function:
 * `updateOpportunity`'s change log reads its "before" snapshot from this
 * return value, not a separate select.
 */
export function stubReplaceItemsRpc() {
  stubRpc("sor_replace_items", (args) => {
    const opportunityId = args.p_opportunity_id
    const stored = () => rowsOf("sales_opportunity_items").filter((row) => row.opportunity_id === opportunityId)
    const before = stored().map((row) => ({ ...row }))

    const matched = new Set()
    const seenLineIds = new Set()
    const items = Array.isArray(args.p_items) ? args.p_items : []
    let order = -1
    for (const item of items) {
      order += 1
      const name = (item.product_name || "").trim()
      if (!name) continue
      const lineId = Number.isInteger(item.odoo_line_id) ? item.odoo_line_id : null
      const productId = Number.isInteger(item.odoo_product_id) ? item.odoo_product_id : null
      if (lineId != null) {
        if (seenLineIds.has(lineId)) continue
        seenLineIds.add(lineId)
      }

      const free = (row) => !matched.has(row)
      let match = lineId != null ? stored().find((row) => free(row) && row.odoo_line_id === lineId) : undefined
      if (!match && item.id) {
        match = stored().find(
          (row) => free(row) && row.id === item.id && (lineId == null || row.odoo_line_id == null || row.odoo_line_id === lineId),
        )
      }
      if (!match && productId != null) {
        match = stored()
          .filter((row) => free(row) && row.odoo_line_id == null && row.odoo_product_id === productId)
          .sort((a, b) => a.sort_order - b.sort_order)[0]
      }

      const fields = {
        product_name: name,
        unit: (item.unit || "").trim() || null,
        quantity: Number(item.quantity) || 0,
        unit_price: Number(item.unit_price) || 0,
        sort_order: order,
        odoo_product_id: productId,
        removed_from_s0: item.removed_from_s0 === true,
      }
      if (match) {
        const patch = { ...fields, odoo_line_id: lineId ?? match.odoo_line_id ?? null }
        if (Object.keys(patch).some((key) => match[key] !== patch[key])) updateRow("sales_opportunity_items", match, patch)
        matched.add(match)
      } else {
        insertRow("sales_opportunity_items", { opportunity_id: opportunityId, ...fields, odoo_line_id: lineId })
        matched.add(stored().at(-1))
      }
    }

    for (const row of stored()) {
      if (matched.has(row)) continue
      if (row.odoo_line_id != null) {
        if (!row.removed_from_s0) updateRow("sales_opportunity_items", row, { removed_from_s0: true })
      } else {
        deleteRows("sales_opportunity_items", [row])
      }
    }
    syncRequestItems(opportunityId)
    return before
  })
}
