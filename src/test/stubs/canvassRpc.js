import { stubRpc } from "@/test/msw/server"
import { db, deleteRows, insertRow, updateRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"
import { canvassFill } from "@/test/db/triggers"

const rowsOf = (table) => db.internal.rowsOf(table)

/**
 * `canvass_add_to_purchase_request` (20261101110000) on the in-memory store: each Canvass becomes a new
 * Requested Item of the request, or is attached to the item named, and is stamped as requested (which
 * locks it). The database's own checks are in the policy tier (132-canvass-add-to-request).
 */
export function stubCanvassAddToRequestRpc() {
  stubRpc("canvass_add_to_purchase_request", (args) => {
    const made = []
    const unsigned = []
    for (const entry of args.p_items) {
      const canvass = rowsOf("sor_canvasses").find((c) => c.id === entry.canvass_id)
      if (!canvass) throw pgrstError("P0002", "canvass_add_to_purchase_request: a picked Canvass was not found", { status: 404 })
      const winner = rowsOf("sor_canvass_offers").find((o) => o.canvass_id === canvass.id && o.is_winner)
      if (!winner) throw pgrstError("22023", `canvass_add_to_purchase_request: ${canvass.number} has no winner yet`, { status: 400 })
      if (!canvass.signed_off_at) unsigned.push(canvass.id)
      let itemId = entry.item_id ?? null
      if (!itemId) {
        const item = insertRow("purchase_request_items", {
          request_id: args.p_request_id,
          source: "new",
          name: canvass.product_name ?? canvass.number,
          quantity: entry.quantity ?? 1,
          unit: entry.unit ?? null,
          status: "not_checked",
          description: `From Canvass ${canvass.number}`,
          requested_by: rowsOf("purchase_requests").find((r) => r.id === args.p_request_id)?.created_by ?? null,
        })
        itemId = item.id
      }
      updateRow("sor_canvasses", canvass, { requested_item_id: itemId, request_made_at: new Date().toISOString() })
      made.push({ canvass_id: canvass.id, item_id: itemId })
    }
    return { request_id: args.p_request_id, items: made, unsigned_canvass_ids: unsigned }
  })
}

/** `canvass_is_locked` (20261101100000), on the in-memory store: a request was made and the lock was not released. */
function isLocked(canvass) {
  return Boolean(canvass?.request_made_at) && !canvass.lock_released_at
}

/**
 * `canvass_subject_can_read_money` (supabase/migrations/20261019100000_canvass_repoint.sql, #276):
 * whether the caller's tier may see an Offer's prices. The fake has no caller and no tier, so a
 * test says which side it is on: `{ money: true }` is a purchaser (closed_book, cost or price),
 * `{ money: false }` a Stage Participant. The real rule is proven in the policy tier
 * (90-canvass-tables.test.js).
 *
 * It also registers `canvass_add_offer` (20261019170000_canvass_review_fixes.sql): the Offer and
 * its prices row are written together, and a failed prices row takes the Offer back out, as the
 * database's transaction would. Every test that reads a Canvass calls this, so every test that
 * adds an Offer gets the RPC. So does `canvass_start` (20261024103000_canvass_before_purchase_request.sql,
 * ADR 0034): the first Offer starts the Canvass, or joins the one already on that subject.
 */
export function stubCanvassMoneyRpc({ money = true } = {}) {
  stubRpc("canvass_subject_can_read_money", () => money)
  stubRpc("canvass_is_locked", (args) => isLocked(rowsOf("sor_canvasses").find((c) => c.id === args.p_canvass_id)))

  const addOffer = (args) => {
    const offerInput = args.p_offer ?? {}
    const priceInput = args.p_price ?? {}
    const siblings = rowsOf("sor_canvass_offers").filter((o) => o.canvass_id === args.p_canvass_id)
    const offer = insertRow("sor_canvass_offers", {
      brochure: [],
      ...offerInput,
      canvass_id: args.p_canvass_id,
      sort_order: siblings.length,
    })
    try {
      insertRow("sor_canvass_offer_prices", { unit_price: null, comparison_rate: null, ...priceInput, offer_id: offer.id })
    } catch (error) {
      const rows = rowsOf("sor_canvass_offers")
      rows.splice(rows.findIndex((o) => o.id === offer.id), 1)
      throw error
    }
    return offer
  }
  stubRpc("canvass_add_offer", addOffer)

  // The fake has no caller: the starter is the Offer's created_by, as the service sends it.
  stubRpc("canvass_start", (args) => {
    const componentId = args.p_component_id ?? null
    const itemId = args.p_requested_item_id ?? null
    const name = String(args.p_product_name ?? "").trim() || null
    if (!componentId && !itemId && !name) throw pgrstError("22023", "canvass_start: say what is being bought", { status: 400 })
    let canvass = rowsOf("sor_canvasses").find(
      (c) => (componentId && c.component_id === componentId) || (itemId && c.requested_item_id === itemId),
    )
    if (!canvass) {
      canvass = insertRow("sor_canvasses", {
        component_id: componentId,
        requested_item_id: itemId,
        product_name: name,
        created_by: args.p_offer?.created_by ?? null,
      })
    }
    const offer = addOffer({ ...args, p_canvass_id: canvass.id })
    return { canvass_id: canvass.id, number: canvass.number, offer }
  })
}

/**
 * A started Canvass for a test's setup, with no Offer yet: the row `canvass_start` would write,
 * written straight to the store (the real app only writes it with its first Offer). Returns the
 * Canvass as `canvassService.get` reads it. Needs `stubCanvassMoneyRpc` registered.
 */
export async function seedCanvass(subject = {}, actorId = null, { productName = null } = {}) {
  const { canvassService } = await import("@/services/canvassService")
  const row = insertRow("sor_canvasses", {
    component_id: subject.componentId ?? null,
    requested_item_id: subject.requestedItemId ?? null,
    product_name: productName,
    created_by: actorId,
  })
  return canvassService.get({ canvassId: row.id })
}

/**
 * Explains every empty slot 2 and 3 of a Canvass as "No other supplier" (#721), so a test that is
 * about something else can still pick a winner: a winner needs Offers plus these marks to number three.
 */
export function explainEmptySlots(canvassId, reason = "No other supplier in this test") {
  const offers = rowsOf("sor_canvass_offers").filter((o) => o.canvass_id === canvassId).length
  for (const slot of [2, 3].filter((n) => offers < n)) {
    if (!rowsOf("sor_canvass_no_other_supplier").some((m) => m.canvass_id === canvassId && m.slot === slot)) {
      insertRow("sor_canvass_no_other_supplier", { canvass_id: canvassId, slot, reason })
    }
  }
}

/**
 * `canvass_apply_winner` and `costing_accept_brand` (supabase/migrations/
 * 20261019120000_canvass_winner_fills_matrix.sql, #278), re-implemented on the in-memory store.
 * The fake has no caller, so `bands` says which Costing Matrix bands the caller holds: a
 * purchaser is `["purchasing"]` (the default), the Deal Team `["sales"]`. A write outside the
 * caller's bands is refused with the band trigger's message. The mark-nulling trigger is
 * mirrored in src/test/db/triggers.js; while the winner is applied `canvassFill.on` is set, as
 * the real function sets canvass.fill. The real rules (who may, the refusals, the fill under
 * real band triggers) are the policy tier's (91-canvass-winner.test.js).
 */
export function stubCanvassWinnerRpcs({ bands = ["purchasing"], superAdmin = false } = {}) {
  const refuseBand = (table, column, needed) => {
    throw pgrstError("42501", `costing_band:${table}.${column}:${needed.join(",")}`, { status: 403 })
  }
  const requireBand = (table, column, needed) => {
    if (!needed.some((band) => bands.includes(band))) refuseBand(table, column, needed)
  }
  const roundCentavo = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
  const blank = (v) => v === null || v === undefined || String(v).trim() === ""

  const slotsCovered = (canvassId) => {
    const offers = rowsOf("sor_canvass_offers").filter((o) => o.canvass_id === canvassId).length
    return offers + rowsOf("sor_canvass_no_other_supplier").filter((m) => m.canvass_id === canvassId && m.slot > offers).length
  }

  // canvass_set_no_other_supplier / canvass_clear_no_other_supplier (20261113030000, #721).
  stubRpc("canvass_set_no_other_supplier", (args) => {
    const reason = String(args.p_reason ?? "").trim()
    if (!reason) throw pgrstError("22023", "canvass_set_no_other_supplier: say why there is no other supplier", { status: 400 })
    const offers = rowsOf("sor_canvass_offers").filter((o) => o.canvass_id === args.p_canvass_id).length
    for (const slot of args.p_slots ?? []) {
      if (![2, 3].includes(slot)) throw pgrstError("22023", "canvass_set_no_other_supplier: only slot 2 or slot 3 can be marked", { status: 400 })
      if (offers >= slot) throw pgrstError("22023", `canvass_set_no_other_supplier: slot ${slot} already has an Offer`, { status: 400 })
    }
    for (const slot of args.p_slots ?? []) {
      const existing = rowsOf("sor_canvass_no_other_supplier").find((m) => m.canvass_id === args.p_canvass_id && m.slot === slot)
      const fields = { reason, actor_id: null, created_at: new Date().toISOString() }
      if (existing) updateRow("sor_canvass_no_other_supplier", existing, fields)
      else insertRow("sor_canvass_no_other_supplier", { canvass_id: args.p_canvass_id, slot, ...fields })
    }
    return { canvass_id: args.p_canvass_id, slots: args.p_slots, covered: slotsCovered(args.p_canvass_id) }
  })
  stubRpc("canvass_clear_no_other_supplier", (args) => {
    const existing = rowsOf("sor_canvass_no_other_supplier").find((m) => m.canvass_id === args.p_canvass_id && m.slot === args.p_slot)
    if (existing) deleteRows("sor_canvass_no_other_supplier", [existing])
    return { canvass_id: args.p_canvass_id, slot: args.p_slot, cleared: Boolean(existing) }
  })

  stubRpc("canvass_apply_winner", (args) => {
    const canvass = rowsOf("sor_canvasses").find((c) => c.id === args.p_canvass_id)
    if (!canvass) throw pgrstError("P0002", "canvass_apply_winner: not found", { status: 404 })
    const offer = rowsOf("sor_canvass_offers").find((o) => o.id === args.p_offer_id && o.canvass_id === canvass.id)
    if (!offer) throw pgrstError("P0002", "canvass_apply_winner: that Offer is not on this Canvass", { status: 404 })
    // #721: three slots, each an Offer or an explained "No other supplier".
    if (slotsCovered(canvass.id) < 3) {
      throw pgrstError("22023", "canvass_apply_winner: a winner needs three supplier slots filled or explained. Add an Offer or mark No other supplier with a reason", { status: 400 })
    }
    const price = rowsOf("sor_canvass_offer_prices").find((p) => p.offer_id === offer.id)
    const rate = price?.comparison_rate ?? null
    if (offer.currency !== "PHP" && (rate === null || rate === undefined)) {
      throw pgrstError("22023", `canvass_apply_winner: a ${offer.currency} Offer needs its comparison rate before it can win`, { status: 400 })
    }

    for (const other of rowsOf("sor_canvass_offers").filter((o) => o.canvass_id === canvass.id && o.is_winner && o.id !== offer.id)) {
      updateRow("sor_canvass_offers", other, { is_winner: false })
    }
    if (!offer.is_winner) updateRow("sor_canvass_offers", offer, { is_winner: true })

    const filled = { acquire: false, offer_specification: false, documents: false }
    // A Canvass on a product line fills the one Component linked to the line's SOR line (#682).
    let componentId = canvass.component_id
    if (!componentId && canvass.requested_item_id) {
      const item = rowsOf("purchase_request_items").find((i) => i.id === canvass.requested_item_id)
      const tenderIds = item?.sor_item_id ? rowsOf("costing_tender_lines").filter((l) => l.sor_item_id === item.sor_item_id).map((l) => l.id) : []
      const linked = rowsOf("costing_components").filter((c) => tenderIds.includes(c.tender_line_id))
      componentId = linked.length === 1 ? linked[0].id : null
    }
    if (!componentId) return { offer_id: offer.id, filled }

    const component = rowsOf("costing_components").find((c) => c.id === componentId)
    const cost = rowsOf("costing_component_costs").find((c) => c.component_id === componentId)

    canvassFill.on = true
    try {
      const unit = price?.unit_price
      if (!blank(unit)) {
        if (cost?.acquire_from_offer_id || blank(cost?.acquire_unit) || cost?.acquire_source === "odoo") {
          requireBand("costing_component_costs", "acquire_unit", ["purchasing"])
          const patch = { acquire_unit: roundCentavo(offer.currency === "PHP" ? unit : Number(unit) * Number(rate)), acquire_from_offer_id: offer.id }
          if (cost) updateRow("costing_component_costs", cost, patch)
          else insertRow("costing_component_costs", { component_id: componentId, ...patch })
          filled.acquire = true
        }
      } else if (cost?.acquire_from_offer_id) {
        // The figure came from an earlier winner and this one has no price: the value stays, the mark goes.
        requireBand("costing_component_costs", "acquire_from_offer_id", ["purchasing"])
        updateRow("costing_component_costs", cost, { acquire_from_offer_id: null })
      }

      if (!blank(offer.description) && (component.offer_specification_from_offer_id || blank(component.offer_specification))) {
        requireBand("costing_components", "offer_specification", ["purchasing"])
        updateRow("costing_components", component, {
          offer_specification: String(offer.description).trim(),
          offer_specification_from_offer_id: offer.id,
        })
        filled.offer_specification = true
      } else if (component.offer_specification_from_offer_id && blank(offer.description)) {
        // Same for Offer Specification: the text stays, the "from Canvass" claim goes.
        requireBand("costing_components", "offer_specification_from_offer_id", ["purchasing"])
        updateRow("costing_components", component, { offer_specification_from_offer_id: null })
      }

      const offerIds = new Set(rowsOf("sor_canvass_offers").filter((o) => o.canvass_id === canvass.id).map((o) => o.id))
      const current = Array.isArray(component.documents) ? component.documents : []
      const kept = current.filter((d) => !(d?.offer_id && offerIds.has(d.offer_id)))
      const cited = (Array.isArray(offer.brochure) ? offer.brochure : []).map((file) => ({ ...file, offer_id: offer.id }))
      const documents = [...kept, ...cited]
      if (JSON.stringify(documents) !== JSON.stringify(current)) {
        requireBand("costing_components", "documents", ["purchasing"])
        updateRow("costing_components", component, { documents })
        filled.documents = true
      }
    } finally {
      canvassFill.on = false
    }
    return { offer_id: offer.id, filled }
  })

  // canvass_clear_winner (20261113100000): no winner, no sign-off or history to touch; the matrix keeps what the old one filled.
  stubRpc("canvass_clear_winner", (args) => {
    const canvass = rowsOf("sor_canvasses").find((c) => c.id === args.p_canvass_id)
    if (!canvass) throw pgrstError("P0002", "canvass_clear_winner: not found", { status: 404 })
    const winners = rowsOf("sor_canvass_offers").filter((o) => o.canvass_id === canvass.id && o.is_winner)
    for (const offer of winners) updateRow("sor_canvass_offers", offer, { is_winner: false })
    return { canvass_id: canvass.id, cleared: winners.length > 0 }
  })

  // canvass_unlock (20261101100000): a Super Admin releases a lock, and says why.
  stubRpc("canvass_unlock", (args) => {
    if (!superAdmin) throw pgrstError("42501", "canvass_unlock: only a Super Admin can unlock a Canvass", { status: 403 })
    const canvass = rowsOf("sor_canvasses").find((c) => c.id === args.p_canvass_id)
    if (!canvass) throw pgrstError("P0002", "canvass_unlock: not found", { status: 404 })
    if (!String(args.p_reason ?? "").trim()) throw pgrstError("22023", "canvass_unlock: say why it is being unlocked", { status: 400 })
    updateRow("sor_canvasses", canvass, { lock_released_at: new Date().toISOString() })
    insertRow("sor_canvass_signoff_events", { canvass_id: canvass.id, kind: "unlocked", actor_id: null, reason: args.p_reason, offer_count: 0 })
    return { canvass_id: canvass.id, unlocked: true }
  })

  stubRpc("costing_accept_brand", (args) => {
    if (!bands.includes("sales") && !bands.includes("purchasing")) throw pgrstError("42501", "costing_accept_brand: only the Deal Team or Purchasing can accept a brand", { status: 403 })
    const canvass = rowsOf("sor_canvasses").find((c) => c.component_id === args.p_component_id)
    const winner = canvass && rowsOf("sor_canvass_offers").find((o) => o.canvass_id === canvass.id && o.is_winner)
    const brand = String(winner?.brand ?? "").trim()
    if (!brand) throw pgrstError("55000", "costing_accept_brand: the Canvass has no winning brand", { status: 400 })
    const component = rowsOf("costing_components").find((c) => c.id === args.p_component_id)
    updateRow("costing_components", component, { brand })
    return { brand }
  })
}

/**
 * `canvass_list` and `canvass_create_purchase_request` (supabase/migrations/
 * 20261024103000_canvass_before_purchase_request.sql, ADR 0034), re-implemented on the in-memory
 * store for the Canvasses page. The fake has no caller, so `actorId` is who creates the request;
 * the list returns every Canvass (who may read which is the policy tier's,
 * 110-canvass-before-purchase-request.test.js).
 */
export function stubCanvassListRpcs({ actorId = null } = {}) {
  const nameOf = (id) => rowsOf("employees").find((e) => e.id === id)?.name ?? null

  stubRpc("canvass_list", () =>
    rowsOf("sor_canvasses").map((c) => {
      const component = rowsOf("costing_components").find((x) => x.id === c.component_id)
      const item = rowsOf("purchase_request_items").find((x) => x.id === c.requested_item_id)
      const request = item && rowsOf("purchase_requests").find((r) => r.id === item.request_id)
      const winner = rowsOf("sor_canvass_offers").find((o) => o.canvass_id === c.id && o.is_winner)
      const canvasserId = c.canvasser_id ?? component?.purchasing_incharge_id ?? request?.buyer_id ?? null
      return {
        id: c.id,
        number: c.number,
        kind: c.component_id ? "component" : c.requested_item_id ? "requested_item" : "none",
        product_name: c.product_name ?? null,
        subject_name: component?.name ?? item?.name ?? c.product_name ?? null,
        component_id: c.component_id ?? null,
        component_number: component ? "1.1" : null,
        requested_item_id: c.requested_item_id ?? null,
        request_id: request?.id ?? null,
        request_label: request?.title ?? null,
        request_item_status: item?.status ?? null,
        opportunity_id: request?.opportunity_id ?? null,
        sales_reference: null,
        project_title: null,
        canvasser_id: canvasserId,
        canvasser_name: nameOf(canvasserId),
        offer_count: rowsOf("sor_canvass_offers").filter((o) => o.canvass_id === c.id).length,
        winner_offer_id: winner?.id ?? null,
        winner_supplier: winner?.supplier_name ?? null,
        winner_brand: winner?.brand ?? null,
        signed_off_at: c.signed_off_at ?? null,
        signer_name: nameOf(c.signed_off_by),
        created_by: c.created_by ?? null,
        created_at: c.created_at,
        updated_at: c.updated_at ?? c.created_at,
        locked: isLocked(c),
      }
    }),
  )

  stubRpc("canvass_create_purchase_request", (args) => {
    const refuse = (code, message) => {
      throw pgrstError(code, `canvass_create_purchase_request: ${message}`, { status: 400 })
    }
    const entries = Array.isArray(args.p_items) ? args.p_items : []
    if (entries.length === 0) refuse("22023", "pick at least one Canvass")
    const picked = entries.map((entry) => {
      const canvass = rowsOf("sor_canvasses").find((c) => c.id === entry.canvass_id)
      if (!canvass) refuse("P0002", "a picked Canvass was not found")
      if (canvass.component_id || canvass.requested_item_id) refuse("55000", `${canvass.number} already belongs to a Component or a Requested Item`)
      const winner = rowsOf("sor_canvass_offers").find((o) => o.canvass_id === canvass.id && o.is_winner)
      if (!winner) refuse("22023", `${canvass.number} has no winner yet`)
      return { entry, canvass, winner }
    })

    const request = insertRow("purchase_requests", { title: args.p_title, created_by: actorId })
    const items = picked.map(({ entry, canvass, winner }) => {
      const item = insertRow("purchase_request_items", {
        request_id: request.id,
        source: "new",
        name: canvass.product_name || winner.brand || canvass.number,
        quantity: entry.quantity ?? 1,
        unit: entry.unit ?? null,
        description: [[winner.supplier_name, winner.brand].filter(Boolean).join(" · "), winner.description, `From Canvass ${canvass.number}`]
          .filter(Boolean)
          .join("\n"),
        requested_by: actorId,
      })
      updateRow("sor_canvasses", canvass, { requested_item_id: item.id })
      return { canvass_id: canvass.id, item_id: item.id }
    })
    const unsigned = picked.filter(({ canvass }) => !canvass.signed_off_at).map(({ canvass }) => canvass.id)
    return { request_id: request.id, items, unsigned_canvass_ids: unsigned }
  })
}
