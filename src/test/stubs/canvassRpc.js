import { stubRpc } from "@/test/msw/server"
import { db, insertRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"

const rowsOf = (table) => db.internal.rowsOf(table)

/**
 * The Canvass RPCs of spec #956 (supabase/migrations/20261205100000_967_canvass_per_request.sql),
 * re-implemented on the in-memory store, so a test of the service or a screen can read and write a
 * Canvass without a database. The fake has no caller and no tier, so a test says which side it is
 * on: `{ money: true }` is a purchaser (closed_book, cost or price), `{ money: false }` a reader
 * who may not see money. The real rules (who reads, who writes, who sees money) are proven in the
 * policy tier (90-canvass-tables.test.js).
 *
 *   canvass_can_read_money   whether the caller may see unit prices and comparison rates
 *   canvass_add_supplier     the first supplier makes the request's Canvass (and its number); later
 *                            ones join it. The supplier and its rate row are written together.
 *   canvass_save_quote       one supplier's answer on one line, and its price row, together
 *   canvass_list             one row per Canvass, for the Canvasses page
 *
 * And the rules RPCs of #969 (20261206100000_969_canvass_rules.sql), the ones the grid calls:
 *
 *   canvass_pick_supplier_for_all   "This supplier wins every line": one reason, skips the lines it
 *                                   did not quote and any cancelled or locked line
 *   canvass_use_same_reason         copies one reason to every picked line that isn't locked
 *   canvass_unlock_line             a Super Admin lifts a Purchased line's lock, with the reason
 *   canvass_offer_projection        whatever the test passes as `projection` (null by default, as
 *                                   the database answers a caller outside the Closed Book and Cost)
 *
 * Who may call them, and the three-supplier gate on a single pick, are the database's (policy
 * tier 969-canvass-rules.test.js); the fake has no caller. A blank reason is refused, as there.
 */
const lockedItem = (item) => ["purchased", "received"].includes(item?.status)
const hasUnlock = (itemId) => rowsOf("request_canvass_line_unlocks").some((u) => u.item_id === itemId)
const lineIsLocked = (item) => lockedItem(item) && !hasUnlock(item.id)
const needsReason = () => pgrstError("22023", "A winner needs a reason.", { status: 400 })

export function stubCanvassMoneyRpc({ money = true, projection = null } = {}) {
  stubRpc("canvass_can_read_money", () => money)

  stubRpc("canvass_pick_supplier_for_all", (args) => {
    const canvass = rowsOf("request_canvasses").find((c) => c.id === args.p_canvass_id)
    if (!canvass) throw pgrstError("P0002", "canvass_pick_supplier_for_all: not found", { status: 404 })
    const reason = String(args.p_reason ?? "").trim()
    if (!reason) throw needsReason()
    let picked = 0
    let skipped = 0
    const quotes = rowsOf("request_canvass_quotes").filter((q) => q.canvass_id === canvass.id && q.supplier_id === args.p_supplier_id)
    for (const quote of quotes) {
      const item = rowsOf("purchase_request_items").find((i) => i.id === quote.item_id)
      if (item?.status === "cancelled" || lineIsLocked(item)) {
        skipped += 1
        continue
      }
      const fields = { supplier_id: args.p_supplier_id, reason, chosen_at: new Date().toISOString() }
      const winner = rowsOf("request_canvass_winners").find((w) => w.item_id === quote.item_id)
      if (winner) Object.assign(winner, fields)
      else insertRow("request_canvass_winners", { item_id: quote.item_id, ...fields })
      picked += 1
    }
    return { canvass_id: canvass.id, supplier_id: args.p_supplier_id, picked, skipped }
  })

  stubRpc("canvass_use_same_reason", (args) => {
    const reason = String(args.p_reason ?? "").trim()
    if (!reason) throw needsReason()
    let changed = 0
    for (const winner of rowsOf("request_canvass_winners")) {
      const quote = rowsOf("request_canvass_quotes").find(
        (q) => q.canvass_id === args.p_canvass_id && q.item_id === winner.item_id && q.supplier_id === winner.supplier_id,
      )
      const item = rowsOf("purchase_request_items").find((i) => i.id === winner.item_id)
      if (!quote || lineIsLocked(item)) continue
      winner.reason = reason
      changed += 1
    }
    return { canvass_id: args.p_canvass_id, changed }
  })

  stubRpc("canvass_unlock_line", (args) => {
    const reason = String(args.p_reason ?? "").trim()
    if (!reason) throw pgrstError("22023", "canvass_unlock_line: say why it is being unlocked", { status: 400 })
    const item = rowsOf("purchase_request_items").find((i) => i.id === args.p_item_id)
    if (!item) throw pgrstError("P0002", "canvass_unlock_line: not found", { status: 404 })
    if (!lockedItem(item) || hasUnlock(item.id)) return { item_id: item.id, unlocked: false }
    insertRow("request_canvass_line_unlocks", { item_id: item.id, reason })
    return { item_id: item.id, unlocked: true }
  })

  stubRpc("canvass_offer_projection", () => projection)

  stubRpc("canvass_add_supplier", (args) => {
    const supplierInput = args.p_supplier ?? {}
    const priceInput = args.p_price ?? {}
    if (!String(supplierInput.supplier_name ?? "").trim()) {
      throw pgrstError("23514", 'new row for relation "request_canvass_suppliers" violates check constraint "request_canvass_suppliers_name_chk"', { status: 400 })
    }
    let canvass = rowsOf("request_canvasses").find((c) => c.request_id === args.p_request_id)
    if (!canvass) {
      canvass = insertRow("request_canvasses", {
        request_id: args.p_request_id,
        created_by: supplierInput.created_by ?? null,
        canvasser_id: supplierInput.created_by ?? null,
      })
    }
    const siblings = rowsOf("request_canvass_suppliers").filter((s) => s.canvass_id === canvass.id)
    const { created_by, ...columns } = supplierInput
    const supplier = insertRow("request_canvass_suppliers", {
      ...columns,
      canvass_id: canvass.id,
      sort_order: siblings.length,
      created_by: created_by ?? null,
    })
    if (money) {
      try {
        insertRow("request_canvass_supplier_prices", { comparison_rate: null, ...priceInput, supplier_id: supplier.id })
      } catch (error) {
        const rows = rowsOf("request_canvass_suppliers")
        rows.splice(rows.findIndex((s) => s.id === supplier.id), 1)
        throw error
      }
    }
    return { canvass_id: canvass.id, number: canvass.number, supplier }
  })

  stubRpc("canvass_save_quote", (args) => {
    const quoteInput = args.p_quote ?? {}
    const priceInput = args.p_price ?? {}
    const supplier = rowsOf("request_canvass_suppliers").find((s) => s.id === args.p_supplier_id)
    if (!supplier) throw pgrstError("P0002", "canvass_save_quote: that supplier is not on a Canvass you can see", { status: 404 })

    let quote = rowsOf("request_canvass_quotes").find((q) => q.supplier_id === args.p_supplier_id && q.item_id === args.p_item_id)
    if (quote) {
      Object.assign(quote, quoteInput, { updated_at: new Date().toISOString() })
    } else {
      quote = insertRow("request_canvass_quotes", {
        brochure: [],
        ...quoteInput,
        canvass_id: supplier.canvass_id,
        supplier_id: args.p_supplier_id,
        item_id: args.p_item_id,
      })
    }
    const price = rowsOf("request_canvass_quote_prices").find((p) => p.quote_id === quote.id)
    if (price) Object.assign(price, priceInput)
    else insertRow("request_canvass_quote_prices", { unit_price: null, ...priceInput, quote_id: quote.id })
    return quote
  })
}

/**
 * A started Canvass for a test's setup, with no supplier yet: the row `canvass_add_supplier` would
 * write, written straight to the store (the real app only writes it with its first supplier).
 * Returns the Canvass as `canvassService.get` reads it. Needs `stubCanvassMoneyRpc` registered.
 */
export async function seedCanvass(requestId, actorId = null) {
  const { canvassService } = await import("@/services/canvassService")
  const row = insertRow("request_canvasses", { request_id: requestId, created_by: actorId, canvasser_id: actorId })
  return canvassService.get({ canvassId: row.id })
}

/**
 * `canvass_list` (the same migration), re-implemented on the in-memory store for the Canvasses
 * page. The list returns every Canvass (who may read which is the policy tier's).
 */
export function stubCanvassListRpcs() {
  const nameOf = (id) => rowsOf("employees").find((e) => e.id === id)?.name ?? null

  stubRpc("canvass_list", () =>
    rowsOf("request_canvasses").map((c) => {
      const request = rowsOf("purchase_requests").find((r) => r.id === c.request_id)
      const items = rowsOf("purchase_request_items").filter((i) => i.request_id === c.request_id)
      const quotes = rowsOf("request_canvass_quotes").filter((q) => q.canvass_id === c.id)
      const canvasserId = c.canvasser_id ?? request?.buyer_id ?? null
      return {
        id: c.id,
        number: c.number,
        request_id: request?.id ?? null,
        request_label: request?.title ?? null,
        opportunity_id: request?.opportunity_id ?? null,
        sales_reference: null,
        project_title: null,
        canvasser_id: canvasserId,
        canvasser_name: nameOf(canvasserId),
        supplier_count: rowsOf("request_canvass_suppliers").filter((s) => s.canvass_id === c.id).length,
        line_count: items.filter((i) => i.status !== "cancelled").length,
        quoted_line_count: new Set(quotes.map((q) => q.item_id)).size,
        winner_count: rowsOf("request_canvass_winners").filter((w) => items.some((i) => i.id === w.item_id)).length,
        created_by: c.created_by ?? null,
        created_at: c.created_at,
        updated_at: c.updated_at ?? c.created_at,
      }
    }),
  )
}
