import { stubRpc } from "@/test/msw/server"
import { db, insertRow, updateRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"
import { ITEM_STATUS_LABELS, allowedTransitions } from "@/constants/purchaseRequest"

const rowsOf = (table) => db.internal.rowsOf(table)
const findRow = (table, id) => rowsOf(table).find((row) => row.id === id)
const sameName = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase()

/**
 * Issue #305 — the Requested Item RPCs (supabase/migrations/
 * 20261005130400_purchase_request_add_items.sql) live in Postgres, which the
 * fake database does not execute. Re-implemented here against the in-memory
 * store, as stubReplaceItemsRpc does for sor_replace_items, so a service test
 * can run a real `updateOpportunity` between adding an item and reading it.
 *
 * The fake has no signed-in identity, so `actorId` stands in for
 * get_employee_id(). Who may add is proven in the policy tier
 * (39-purchase-request-items.test.js), not here.
 *
 * #306's status RPCs (20261005130500_purchase_request_item_status.sql) too:
 * `side` is the actor's side (default: their stored member side, or null),
 * and `canSubstitute` stands in for purchase_request_can_add_substitute. The transition
 * rule is the client's `allowedTransitions`, the one the SQL mirrors; who may
 * move what is proven in 40-purchase-request-item-status.test.js.
 *
 * #312's PO RPCs (20261005130800_purchase_request_item_po.sql): Ordered stores
 * `details.po_number` / `po_verification`; `ipasLines` (`{ [poNumber]: [lineId] }`)
 * stands in for the `_ipas_po_line_ids` seam, empty by default as it ships.
 * The rules are proven in 43-purchase-request-item-po.test.js.
 */
export function stubPurchaseRequestItemRpcs({ actorId, side, canSubstitute = false, ipasLines = {} }) {
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

  // #501 (20261012100500_purchase_request_stock_snapshot.sql): the request's
  // SOR stock snapshot, or null. Who may read it is can_read_purchase_request.
  stubRpc("purchase_request_stock_snapshot", (args) => {
    const request = findRow("purchase_requests", args.p_request_id)
    const snapshot = rowsOf("sor_stock_snapshots").find((s) => request?.opportunity_id && s.opportunity_id === request.opportunity_id)
    return snapshot ? { fetched_at: snapshot.fetched_at, data: snapshot.data } : null
  })

  const sideOf = (requestId) =>
    side !== undefined
      ? side
      : rowsOf("purchase_request_members").find((m) => m.request_id === requestId && m.employee_id === actorId)?.side ?? null

  const refuse = (message, code) => {
    throw pgrstError(code, message)
  }

  const move = (item, to, details, fn) => {
    const from = item.status
    if (!allowedTransitions(from, sideOf(item.request_id)).includes(to)) {
      refuse(`${fn}: can't move from ${ITEM_STATUS_LABELS[from]} to ${ITEM_STATUS_LABELS[to]}`, "42501")
    }
    const changedAt = new Date().toISOString()
    const updated = updateRow("purchase_request_items", item, {
      status: to,
      status_changed_by: actorId,
      status_changed_at: changedAt,
    })
    insertRow("purchase_request_messages", {
      request_id: item.request_id,
      author_id: actorId,
      content: `${item.name}: ${ITEM_STATUS_LABELS[from]} → ${ITEM_STATUS_LABELS[to]}.`,
      metadata: {
        event: "item_status_changed",
        item_id: item.id,
        from,
        to,
        changed_by: actorId,
        changed_at: changedAt,
        ...(details && Object.keys(details).length ? { details } : {}),
      },
    })
    return updated
  }

  stubRpc("purchase_request_actor_side", (args) => sideOf(args.p_request_id))
  stubRpc("purchase_request_can_add_substitute", () => canSubstitute)

  stubRpc("purchase_request_set_item_status", (args) => {
    const item = findRow("purchase_request_items", args.p_item_id)
    if (!item) refuse(`purchase_request_set_item_status: item ${args.p_item_id} not found`, "P0002")
    const details = args.p_details || {}
    const po = (details.po_number || "").trim().toUpperCase() || null
    if (Object.keys(details).length && args.p_status !== "ordered") {
      refuse(`purchase_request_set_item_status: ${ITEM_STATUS_LABELS[args.p_status]} takes no details`, "22023")
    }
    if (po && !/^P\d+$/.test(po)) refuse(`purchase_request_set_item_status: ${po} isn't an Odoo PO number`, "22023")
    const poFields = po ? { po_number: po, po_verification: details.po_verification || "UNVERIFIED" } : null
    const moved = move(item, args.p_status, poFields, "purchase_request_set_item_status")
    return poFields ? updateRow("purchase_request_items", item, poFields) : moved
  })

  const ipasOf = (poNumber) => (poNumber && ipasLines[poNumber]) || []

  stubRpc("purchase_request_item_po_lines", (args) => ipasOf(findRow("purchase_request_items", args.p_item_id)?.po_number))

  stubRpc("purchase_request_pick_po_lines", (args) => {
    const item = findRow("purchase_request_items", args.p_item_id)
    if (!item) refuse(`purchase_request_pick_po_lines: item ${args.p_item_id} not found`, "P0002")
    if (sideOf(item.request_id) !== "purchasing") refuse("purchase_request_pick_po_lines: only Purchasing picks an item's PO line", "42501")
    const ipas = ipasOf(item.po_number)
    if (!ipas.length) refuse(`purchase_request_pick_po_lines: PO ${item.po_number} has no IPAS yet; pick its line once it does`, "22023")
    const lines = [...new Set(args.p_line_ids || [])].sort((a, b) => a - b)
    const stray = lines.filter((l) => !ipas.includes(l))
    if (!lines.length || stray.length) refuse(`purchase_request_pick_po_lines: line ${stray.join(", ")} isn't on PO ${item.po_number}'s IPAS copy`, "22023")
    const updated = updateRow("purchase_request_items", item, { odoo_po_line_ids: lines })
    insertRow("purchase_request_messages", {
      request_id: item.request_id,
      author_id: actorId,
      content: `${item.name}: PO line picked on ${item.po_number}.`,
      metadata: { event: "item_po_lines_picked", item_id: item.id, po_number: item.po_number, line_ids: lines },
    })
    return updated
  })

  stubRpc("purchase_request_add_substitute", (args) => {
    const original = findRow("purchase_request_items", args.p_item_id)
    if (!original) refuse(`purchase_request_add_substitute: item ${args.p_item_id} not found`, "P0002")
    if (!canSubstitute) refuse("purchase_request_add_substitute: only the request's Buyer may add a substitute", "42501")
    const item = insertRow("purchase_request_items", {
      request_id: original.request_id,
      source: "new",
      name: args.p_name.trim(),
      unit: args.p_unit || null,
      quantity: args.p_quantity,
      description: args.p_description || null,
      images: args.p_images || [],
      substitute_for_item_id: original.id,
      requested_by: actorId,
    })
    insertRow("purchase_request_messages", {
      request_id: item.request_id,
      author_id: actorId,
      content: `Offered ${item.name} as a substitute for ${original.name}.`,
      metadata: { event: "item_added", item_id: item.id, source: "new", substitute_for_item_id: original.id },
    })
    move(original, "substituted", { substitute_item_id: item.id }, "purchase_request_add_substitute")
    return item.id
  })
}
