import { stubRpc } from "@/test/msw/server"
import { db, insertRow } from "@/test/db/store"

const rowsOf = (table) => db.internal.rowsOf(table)
const findRow = (table, id) => rowsOf(table).find((row) => row.id === id)
const sameName = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase()

/**
 * Issue #305 — the Requested Item RPCs (supabase/migrations/
 * 20261007120500_purchase_request_add_items.sql) live in Postgres, which the
 * fake database does not execute. Re-implemented here against the in-memory
 * store, as stubReplaceItemsRpc does for sor_replace_items, so a service test
 * can run a real `updateOpportunity` between adding an item and reading it.
 *
 * The fake has no signed-in identity, so `actorId` stands in for
 * get_employee_id(). Who may add is proven in the policy tier
 * (39-purchase-request-items.test.js), not here.
 */
export function stubPurchaseRequestItemRpcs({ actorId }) {
  const postAdded = (item) => {
    insertRow("purchase_request_messages", {
      request_id: item.request_id,
      author_id: item.requested_by,
      content: `Requested ${item.name}.`,
      metadata: { event: "item_added", item_id: item.id, source: item.source },
    })
  }

  stubRpc("purchase_request_can_add_items", () => true)

  stubRpc("purchase_request_add_item_from_line", (args) => {
    const request = findRow("purchase_requests", args.p_request_id)
    const line = findRow("sales_opportunity_items", args.p_line_id)
    if (!request || !line || line.opportunity_id !== request.opportunity_id) {
      throw Object.assign(new Error("purchase_request_add_item_from_line: that line is no longer on this SOR's Product List"), {
        code: "P0002",
      })
    }
    const name = line.product_name.trim()
    const unit = (line.unit || "").trim() || null
    const item = insertRow("purchase_request_items", {
      request_id: request.id,
      source: "sor_line",
      odoo_product_id: line.odoo_product_id ?? null,
      name,
      unit,
      quantity: line.quantity,
      sor_line_snapshot: { name, quantity: Number(line.quantity), unit },
      requested_by: actorId,
    })
    postAdded(item)
    return item.id
  })

  stubRpc("purchase_request_add_new_item", (args) => {
    const item = insertRow("purchase_request_items", {
      request_id: args.p_request_id,
      source: "new",
      name: args.p_name.trim(),
      unit: args.p_unit || null,
      quantity: args.p_quantity,
      description: args.p_description || null,
      images: args.p_images || [],
      requested_by: actorId,
    })
    postAdded(item)
    return item.id
  })

  stubRpc("purchase_request_pickable_lines", (args) => {
    const request = findRow("purchase_requests", args.p_request_id)
    return rowsOf("sales_opportunity_items")
      .filter((l) => l.opportunity_id === request?.opportunity_id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ id, product_name, quantity, unit, odoo_product_id, sort_order }) => ({
        id, product_name, quantity, unit, odoo_product_id, sort_order,
      }))
  })

  stubRpc("purchase_request_item_lines", (args) => {
    const request = findRow("purchase_requests", args.p_request_id)
    const lines = rowsOf("sales_opportunity_items").filter((l) => l.opportunity_id === request?.opportunity_id)
    return rowsOf("purchase_request_items")
      .filter((i) => i.request_id === args.p_request_id && i.source === "sor_line")
      .map((item) => {
        const picked = item.sor_line_snapshot || {}
        const line = lines
          .filter((l) =>
            item.odoo_product_id != null ? l.odoo_product_id === item.odoo_product_id : sameName(l.product_name, picked.name),
          )
          .sort(
            (a, b) =>
              (Number(b.quantity) === Number(picked.quantity)) - (Number(a.quantity) === Number(picked.quantity)) ||
              a.sort_order - b.sort_order,
          )[0]
        return {
          item_id: item.id,
          line_found: !!line,
          line_quantity: line ? line.quantity : null,
          line_unit: line ? (line.unit || "").trim() || null : null,
        }
      })
  })
}
