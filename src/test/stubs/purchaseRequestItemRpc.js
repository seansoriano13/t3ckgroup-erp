import { stubRpc, stubEdgeFunction } from "@/test/msw/server"
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
 *
 * #273's Costing Matrix RPCs (20261018150000_costing_purchase_request_items.sql): `purchasing`
 * stands in for has_purchasing_access(). Adding from Components copies name, quantity, unit and
 * Odoo product id and refuses a Component on another SOR's matrix; who may add is proven in
 * 83-costing-purchase-request-items.test.js.
 */
export function stubPurchaseRequestItemRpcs({ actorId, side, canSubstitute = false, ipasLines = {}, purchasing = false, odoo = null }) {
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
    if (!request || !line || line.opportunity_id !== request.opportunity_id || line.removed_from_s0) {
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
      sor_item_id: line.id,
      name,
      unit,
      quantity: line.quantity,
      sor_line_snapshot: { name, quantity: Number(line.quantity), unit },
      requested_by: actorId,
    })
    postAdded(item)
    return item.id
  })

  stubRpc("has_purchasing_access", () => purchasing)

  const matrixOf = (componentId) => {
    const component = findRow("costing_components", componentId)
    const line = component && findRow("costing_tender_lines", component.tender_line_id)
    return line && findRow("costing_matrices", line.matrix_id)
  }

  stubRpc("purchase_request_add_items_from_components", (args) => {
    if (!purchasing) {
      throw pgrstError("42501", "purchase_request_add_items_from_components: only people with Purchasing access may add from the Costing Matrix")
    }
    const request = findRow("purchase_requests", args.p_request_id)
    const ids = args.p_component_ids ?? []
    if (ids.length === 0) throw pgrstError("22023", "purchase_request_add_items_from_components: pick at least one Component")
    // All or nothing: check every Component before adding any.
    for (const id of ids) {
      if (matrixOf(id)?.opportunity_id !== request?.opportunity_id) {
        throw pgrstError("P0002", "purchase_request_add_items_from_components: that Component is not on this SOR's Costing Matrix")
      }
    }
    return ids.map((id) => {
      const component = findRow("costing_components", id)
      const item = insertRow("purchase_request_items", {
        request_id: request.id,
        source: "component",
        component_id: component.id,
        odoo_product_id: component.odoo_product_id ?? null,
        name: component.name.trim(),
        unit: (component.unit || "").trim() || null,
        quantity: component.quantity,
        requested_by: actorId,
      })
      postAdded(item)
      return item.id
    })
  })

  // The Component's number as the grid numbers it: its line's place in the matrix, then its own place under the line.
  stubRpc("purchase_request_component_labels", (args) => {
    const items = rowsOf("purchase_request_items").filter((i) => i.request_id === args.p_request_id && i.component_id)
    return items.flatMap((item) => {
      const component = findRow("costing_components", item.component_id)
      const matrix = matrixOf(item.component_id)
      if (!component || !matrix) return []
      const lines = rowsOf("costing_tender_lines").filter((l) => l.matrix_id === matrix.id).sort((a, b) => a.position - b.position)
      const siblings = rowsOf("costing_components").filter((c) => c.tender_line_id === component.tender_line_id).sort((a, b) => a.position - b.position)
      const number = `${lines.findIndex((l) => l.id === component.tender_line_id) + 1}.${siblings.findIndex((c) => c.id === component.id) + 1}`
      return [{ item_id: item.id, component_id: component.id, number, name: component.name }]
    })
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

  // 20261103100000_purchase_request_item_follows_sor.sql: the item follows its SOR line, or is kept as asked.
  // Who may do it is proven in the policy tier (133-purchase-request-item-follows-sor.test.js).
  const sorLineOf = (item) => {
    const request = findRow("purchase_requests", item.request_id)
    const picked = item.sor_line_snapshot || {}
    return rowsOf("sales_opportunity_items")
      .filter((l) => l.opportunity_id === request?.opportunity_id)
      .filter((l) => (item.odoo_product_id != null ? l.odoo_product_id === item.odoo_product_id : sameName(l.product_name, picked.name)))
      .sort(
        (a, b) =>
          (Number(b.quantity) === Number(picked.quantity)) - (Number(a.quantity) === Number(picked.quantity)) ||
          a.sort_order - b.sort_order,
      )[0]
  }
  const refuseSor = (message, code = "22023") => {
    throw pgrstError(code, message)
  }

  stubRpc("purchase_request_update_item_from_sor", (args) => {
    const item = findRow("purchase_request_items", args.p_item_id)
    if (!item) refuseSor("purchase_request_update_item_from_sor: item not found", "P0002")
    if (["available", "received", "cannot_source", "cancelled"].includes(item.status)) {
      refuseSor("purchase_request_update_item_from_sor: this item is closed, so it keeps what was asked")
    }
    const line = sorLineOf(item)
    if (!line) refuseSor("purchase_request_update_item_from_sor: the SOR no longer has this line", "P0002")
    const reason = (args.p_reason || "").trim()
    if (item.status === "purchased" && !reason) {
      refuseSor("purchase_request_update_item_from_sor: this item is already ordered, so say why it follows the SOR")
    }
    const unit = (line.unit || "").trim() || null
    const before = `${Number(item.quantity)}${item.unit ? ` ${item.unit}` : ""}`
    const after = `${Number(line.quantity)}${unit ? ` ${unit}` : ""}`
    updateRow("purchase_request_items", item, {
      quantity: line.quantity,
      unit,
      sor_line_snapshot: { ...item.sor_line_snapshot, quantity: Number(line.quantity), unit },
      sor_change_seen: null,
    })
    insertRow("purchase_request_messages", {
      request_id: item.request_id,
      author_id: actorId,
      content: `Updated ${item.name} from ${before} to ${after}, as the SOR now says.${reason ? ` Reason: ${reason}` : ""}`,
      metadata: { event: "item_followed_sor", item_id: item.id, from: before, to: after },
    })
    return null
  })

  stubRpc("purchase_request_keep_item_as_asked", (args) => {
    const item = findRow("purchase_request_items", args.p_item_id)
    const line = item && sorLineOf(item)
    if (!line) refuseSor("purchase_request_keep_item_as_asked: the SOR no longer has this line", "P0002")
    updateRow("purchase_request_items", item, {
      sor_change_seen: { quantity: Number(line.quantity), unit: (line.unit || "").trim() || null },
    })
    return null
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

  // 20261024103700_undo_item_status.sql, reduced to its rule: only the last
  // change, by its status_changed_at, and back along the one event. The window
  // and the notification clean-up are proven in 106-purchase-request-undo-status.
  stubRpc("purchase_request_undo_item_status", (args) => {
    const item = findRow("purchase_request_items", args.p_item_id)
    if (!item || item.status_changed_at !== args.p_changed_at) {
      refuse("purchase_request_undo_item_status: that item has changed since, so there is nothing to undo", "22023")
    }
    const event = rowsOf("purchase_request_messages").find(
      (m) => m.metadata?.event === "item_status_changed" && m.metadata.item_id === item.id && m.metadata.changed_at === args.p_changed_at,
    )
    return updateRow("purchase_request_items", item, { status: event.metadata.from, status_changed_by: null, status_changed_at: null })
  })

  stubRpc("purchase_request_set_item_status", (args) => {
    const item = findRow("purchase_request_items", args.p_item_id)
    if (!item) refuse(`purchase_request_set_item_status: item ${args.p_item_id} not found`, "P0002")
    const details = args.p_details || {}
    // #548: a signed-in caller never sets the Odoo check.
    if ("po_verification" in details) {
      refuse("purchase_request_set_item_status: only the server may record a PO check", "42501")
    }
    // A PO number is saved only by the server path, after it asks Odoo.
    if ((details.po_number || "").toString().trim()) {
      refuse("purchase_request_set_item_status: a PO number is saved by the server after Odoo is asked; use the Order / Correct PO action", "42501")
    }
    return setStatus(item, args.p_status, details, false)
  })

  function setStatus(item, status, details, server) {
    const po = (details.po_number || "").trim().toUpperCase() || null
    if (Object.keys(details).length && status !== "purchased") {
      refuse(`purchase_request_set_item_status: ${ITEM_STATUS_LABELS[status]} takes no details`, "22023")
    }
    if (po && !/^P\d+$/.test(po)) refuse(`purchase_request_set_item_status: ${po} isn't an Odoo PO number`, "22023")
    const poFields = po ? { po_number: po, po_verification: (server && details.po_verification) || "UNVERIFIED" } : null
    const moved = move(item, status, poFields, "purchase_request_set_item_status")
    return poFields ? updateRow("purchase_request_items", item, poFields) : moved
  }

  // #548: the `odoo-po-verify` edge function in save mode, with Odoo faked as
  // `odoo` ('found' | 'not_found' | 'unreachable'). Mirrors
  // purchase_request_item_apply_po_check; the verdicts are proven in
  // 103-purchase-request-po-check.test.js.
  if (odoo) {
    stubEdgeFunction("odoo-po-verify", (body) => {
      const item = findRow("purchase_request_items", body.itemId)
      const po = (body.poNumber || "").trim().toUpperCase()
      if (!item) return { success: false, refused: true, message: `item ${body.itemId} not found` }
      if (odoo === "not_found") {
        return { success: false, refused: true, message: `Odoo has no purchase order ${po}; check the number and try again` }
      }
      const verification = odoo === "found" ? "VERIFIED" : "PENDING_VERIFICATION"
      if (body.action === "correct") {
        if (sideOf(item.request_id) !== "purchasing") return { success: false, refused: true, message: "purchase_request_correct_po: only Purchasing corrects an item's PO".replace(/^[a-z_]+: /, "") }
        if (item.status !== "purchased") return { success: false, refused: true, message: `${item.name} is ${item.status}, not Ordered; a PO can only be corrected while the item is Ordered` }
        const corrected = updateRow("purchase_request_items", item, { po_number: po, po_verification: verification, odoo_po_line_ids: [] })
        insertRow("purchase_request_messages", {
          request_id: item.request_id,
          author_id: actorId,
          content: `${item.name}: PO ${item.po_number || "none"} → ${po}.`,
          metadata: { event: "item_po_corrected", item_id: item.id, from_po: item.po_number, to_po: po },
        })
        return { success: true, verdict: odoo === "found" ? "verified" : "not_checked", item: corrected }
      }
      const updated = setStatus(item, "purchased", { po_number: po, po_verification: verification }, true)
      return { success: true, verdict: odoo === "found" ? "verified" : "not_checked", item: updated }
    })
  }

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
    move(original, "cancelled", { substitute_item_id: item.id }, "purchase_request_add_substitute")
    return item.id
  })
}
