import { db, insertRow, updateRow } from "@/test/db/store"

const rowsOf = (table) => db.internal.rowsOf(table)

/**
 * The two triggers of 20261104130000_requested_item_follows_s0.sql, re-implemented on the fake
 * store (which runs no triggers): every line of an SOR has exactly one Requested Item on the
 * SOR's Purchase Request, created at Not checked and kept in step (name, unit, quantity, Odoo
 * product, removed flag) with the line. Status, PO and the rest of an item are never touched.
 *
 * `syncRequestItems(opportunityId)` is "a line was written" for every line of the SOR; the
 * `sor_replace_items` stub calls it after a save, and a test calls it after seeding a request
 * (the "request opened" trigger).
 */
export function syncRequestItems(opportunityId) {
  const request = rowsOf("purchase_requests").find((r) => r.opportunity_id === opportunityId)
  if (!request) return
  const lines = rowsOf("sales_opportunity_items")
    .filter((l) => l.opportunity_id === opportunityId)
    .sort((a, b) => a.sort_order - b.sort_order)
  for (const line of lines) {
    const name = (line.product_name || "").trim()
    if (!name) continue
    const unit = (line.unit || "").trim() || null
    const quantity = Number(line.quantity) > 0 ? line.quantity : null
    const existing = rowsOf("purchase_request_items").find((i) => i.sor_item_id === line.id)
    const snapshot = { name, quantity: line.quantity, unit }
    if (!existing) {
      insertRow("purchase_request_items", {
        request_id: request.id,
        source: "sor_line",
        odoo_product_id: line.odoo_product_id ?? null,
        sor_item_id: line.id,
        name,
        unit,
        quantity: quantity ?? 1,
        sor_line_snapshot: snapshot,
        removed_from_s0: line.removed_from_s0 === true,
        requested_by: request.created_by,
      })
      // #688: the trigger that asks "Is this yours?" - once, when the S0 line's item is made.
      const made = rowsOf("purchase_request_items").find((i) => i.sor_item_id === line.id)
      const other =
        line.odoo_product_id == null
          ? null
          : rowsOf("purchase_request_items").find(
              (i) =>
                i.request_id === request.id &&
                !i.sor_item_id &&
                i.purpose !== "job" &&
                i.po_number &&
                i.status !== "cancelled" &&
                i.bought_product_id === line.odoo_product_id,
            )
      if (other) updateRow("purchase_request_items", made, { new_on_s0: true, yours_item_id: other.id })
      continue
    }
    updateRow("purchase_request_items", existing, {
      odoo_product_id: line.odoo_product_id ?? null,
      name,
      unit,
      quantity: quantity ?? existing.quantity,
      sor_line_snapshot: snapshot,
      removed_from_s0: line.removed_from_s0 === true,
    })
  }
}
