import { stubRpc } from "@/test/msw/server"
import { db, insertRow, updateRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"
import { canvassFill } from "@/test/db/triggers"

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
 * adds an Offer gets the RPC.
 */
export function stubCanvassMoneyRpc({ money = true } = {}) {
  stubRpc("canvass_subject_can_read_money", () => money)

  stubRpc("canvass_add_offer", (args) => {
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
  })
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
export function stubCanvassWinnerRpcs({ bands = ["purchasing"] } = {}) {
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
