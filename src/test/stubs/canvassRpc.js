import { stubRpc } from "@/test/msw/server"
import { db, insertRow, updateRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"
import { canvassFill } from "@/test/db/triggers"
import { CANVASS_LOCK_REASON } from "@/constants/canvass"

const rowsOf = (table) => db.internal.rowsOf(table)

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
/** `canvass_lock_reason` (20261101100000), on the in-memory store: a request was made, or the item is Ordered or Received. */
function lockReasonOf(canvass) {
  if (!canvass || canvass.lock_released_at) return null
  if (canvass.request_made_at) return CANVASS_LOCK_REASON.REQUEST_MADE
  const item = rowsOf("purchase_request_items").find((i) => i.id === canvass.requested_item_id)
  return ["ordered", "received"].includes(item?.status) ? CANVASS_LOCK_REASON.ITEM_ORDERED : null
}

export function stubCanvassMoneyRpc({ money = true } = {}) {
  stubRpc("canvass_subject_can_read_money", () => money)
  stubRpc("canvass_lock_reason", (args) => lockReasonOf(rowsOf("sor_canvasses").find((c) => c.id === args.p_canvass_id)))

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

  stubRpc("canvass_apply_winner", (args) => {
    const canvass = rowsOf("sor_canvasses").find((c) => c.id === args.p_canvass_id)
    if (!canvass) throw pgrstError("P0002", "canvass_apply_winner: not found", { status: 404 })
    const offer = rowsOf("sor_canvass_offers").find((o) => o.id === args.p_offer_id && o.canvass_id === canvass.id)
    if (!offer) throw pgrstError("P0002", "canvass_apply_winner: that Offer is not on this Canvass", { status: 404 })
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
    if (!canvass.component_id) return { offer_id: offer.id, filled }

    const component = rowsOf("costing_components").find((c) => c.id === canvass.component_id)
    const cost = rowsOf("costing_component_costs").find((c) => c.component_id === canvass.component_id)

    canvassFill.on = true
    try {
      const unit = price?.unit_price
      if (!blank(unit)) {
        if (cost?.acquire_from_offer_id || blank(cost?.acquire_unit)) {
          requireBand("costing_component_costs", "acquire_unit", ["purchasing"])
          const patch = { acquire_unit: roundCentavo(offer.currency === "PHP" ? unit : Number(unit) * Number(rate)), acquire_from_offer_id: offer.id }
          if (cost) updateRow("costing_component_costs", cost, patch)
          else insertRow("costing_component_costs", { component_id: canvass.component_id, ...patch })
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

  // canvass_clear_winner (20261024103000): no winner; the matrix keeps what the old one filled.
  stubRpc("canvass_clear_winner", (args) => {
    const canvass = rowsOf("sor_canvasses").find((c) => c.id === args.p_canvass_id)
    if (!canvass) throw pgrstError("P0002", "canvass_clear_winner: not found", { status: 404 })
    const winners = rowsOf("sor_canvass_offers").filter((o) => o.canvass_id === canvass.id && o.is_winner)
    if (winners.length > 0) {
      insertRow("sor_canvass_signoff_events", { canvass_id: canvass.id, kind: "cleared", actor_id: null, reason: "The winner was un-picked", offer_count: 0 })
      if (canvass.signed_off_at) updateRow("sor_canvasses", canvass, { signed_off_at: null, signed_off_by: null })
    }
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
    if (!bands.includes("sales")) throw pgrstError("42501", "costing_accept_brand: only the Deal Team can accept a brand", { status: 403 })
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
 * `canvass_sign`, `canvass_signoff_audience` and `canvass_pending_signoffs`
 * (supabase/migrations/20261019130000_canvass_signoff.sql, #279), re-implemented on the in-memory
 * store. The fake has no caller, so a test says who is calling and who is on the purchasing
 * approver list (`transmittal_check_by`): `actorId`, and `approverIds`. The clearing triggers are
 * mirrored in src/test/db/triggers.js. The real rules (the list, the creator, the refusals, the
 * append-only history) are the policy tier's (92-canvass-signoff.test.js).
 */
export function stubCanvassSignoffRpcs({ actorId, approverIds = [] } = {}) {
  const onList = () => approverIds.includes(actorId)
  const winnerOf = (canvass) => rowsOf("sor_canvass_offers").find((o) => o.canvass_id === canvass.id && o.is_winner)
  const ready = (canvass) => !canvass.signed_off_at && String(canvass.reason ?? "").trim() !== "" && Boolean(winnerOf(canvass))

  stubRpc("canvass_sign", (args) => {
    const refuse = (code, message, status = 400) => {
      throw pgrstError(code, `canvass_sign: ${message}`, { status })
    }
    if (!actorId) refuse("42501", "sign in first", 403)
    if (!onList()) refuse("42501", "only the purchasing approver list can sign a Canvass", 403)
    const canvass = rowsOf("sor_canvasses").find((c) => c.id === args.p_canvass_id)
    if (!canvass) refuse("P0002", "not found", 404)
    if (canvass.created_by === actorId) refuse("42501", "you can't sign a Canvass you opened", 403)
    if (canvass.signed_off_at) refuse("55000", "already signed")
    if (!winnerOf(canvass)) refuse("22023", "pick a winner first")
    if (String(canvass.reason ?? "").trim() === "") refuse("22023", "give the reason for the winner first")

    const offerCount = rowsOf("sor_canvass_offers").filter((o) => o.canvass_id === canvass.id).length
    const at = new Date().toISOString()
    updateRow("sor_canvasses", canvass, { signed_off_by: actorId, signed_off_at: at })
    insertRow("sor_canvass_signoff_events", {
      canvass_id: canvass.id,
      kind: "signed",
      actor_id: actorId,
      reason: String(canvass.reason).trim(),
      offer_count: offerCount,
      created_at: at,
    })
    return { canvass_id: canvass.id, number: canvass.number, signed_off_at: at, offer_count: offerCount }
  })

  stubRpc("canvass_signoff_audience", (args) => {
    const canvass = rowsOf("sor_canvasses").find((c) => c.id === args.p_canvass_id)
    if (!canvass || !ready(canvass)) return { ready: false, number: null, notify_ids: [] }
    return { ready: true, number: canvass.number, notify_ids: approverIds.filter((id) => id !== canvass.created_by) }
  })

  stubRpc("canvass_pending_signoffs", () => {
    if (!onList()) return []
    return rowsOf("sor_canvasses")
      .filter((c) => ready(c) && c.created_by !== actorId)
      .map((c) => {
        const winner = winnerOf(c)
        const component = rowsOf("costing_components").find((x) => x.id === c.component_id)
        return {
          canvass_id: c.id,
          number: c.number,
          component_id: c.component_id ?? null,
          requested_item_id: c.requested_item_id ?? null,
          subject_name: component?.name ?? null,
          reason: c.reason,
          creator_id: c.created_by ?? null,
          creator_name: rowsOf("employees").find((e) => e.id === c.created_by)?.name ?? null,
          opportunity_id: null,
          project_title: null,
          client_name: null,
          offer_count: rowsOf("sor_canvass_offers").filter((o) => o.canvass_id === c.id).length,
          winner_brand: winner.brand ?? null,
          winner_supplier: winner.supplier_name ?? null,
          waiting_since: c.updated_at ?? c.created_at,
        }
      })
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
        locked: lockReasonOf(c) !== null,
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
