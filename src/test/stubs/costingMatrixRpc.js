import { stubRpc } from "@/test/msw/server"
import { db, insertRow, updateRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"
import { COSTING_TIER, TENDER_PRICE_TIERS, tierReads } from "@/constants/costing"

const rowsOf = (table) => db.internal.rowsOf(table)

/**
 * Issue #267 — the Costing Matrix functions (supabase/migrations/
 * 20261018100000_costing_matrix_tender_lines.sql) live in Postgres, which the
 * fake database does not execute. Re-implemented here against the in-memory
 * store, so a service test reads and writes real Tender Line rows.
 *
 * The fake has no signed-in identity, so the caller is given: `tier` stands in
 * for costing_tier (default Deal Team: the price tier) and `bands` for the
 * write bands costing_in_band finds. What a tier reads is the same
 * `TENDER_PRICE_TIERS` the screen uses; that this equals the database registry
 * is proven in the policy tier (78-costing-tender-lines.test.js), as is the band
 * trigger. A write outside `bands` is refused here with the trigger's message.
 */
export function stubCostingMatrixRpcs({ tier = COSTING_TIER.PRICE, bands = ["sales"] } = {}) {
  const refuse = (table, column, needed) => {
    throw pgrstError("42501", `costing_band:${table}.${column}:${needed.join(",")}`, { status: 403 })
  }
  const requireBand = (table, column, needed) => {
    if (!needed.some((band) => bands.includes(band))) refuse(table, column, needed)
  }

  const matchingSorLine = (line) => {
    const matrix = rowsOf("costing_matrices").find((m) => m.id === line.matrix_id)
    if (!matrix || line.source !== "sor_line") return null
    const snap = line.sor_line_snapshot ?? {}
    const lower = (value) => String(value ?? "").trim().toLowerCase()
    const matches = rowsOf("sales_opportunity_items").filter(
      (sl) =>
        sl.opportunity_id === matrix.opportunity_id &&
        (line.odoo_product_id != null ? sl.odoo_product_id === line.odoo_product_id : lower(sl.product_name) === lower(snap.name)),
    )
    matches.sort((a, b) => Number(Number(b.quantity) === Number(snap.quantity)) - Number(Number(a.quantity) === Number(snap.quantity)))
    return matches[0] ?? null
  }

  const sorLineNow = (line) => {
    if (line.source !== "sor_line") return null
    const found = matchingSorLine(line)
    if (!found) return { found: false }
    return {
      found: true,
      name: found.product_name,
      quantity: Number(found.quantity),
      unit: (found.unit || "").trim() || null,
      odoo_product_id: found.odoo_product_id ?? null,
    }
  }

  stubRpc("costing_tier", () => tier)

  stubRpc("costing_matrix_read", (args) => {
    if (!tier) return null
    const matrix = rowsOf("costing_matrices").find((m) => m.opportunity_id === args.p_opportunity_id)
    if (!matrix) return null
    const lines = rowsOf("costing_tender_lines")
      .filter((l) => l.matrix_id === matrix.id)
      .sort((a, b) => a.position - b.position)
    const tables = {
      costing_matrices: [{ ...matrix }],
      costing_tender_lines: lines.map((l) => ({ ...l, sor_line_now: sorLineNow(l) })),
    }

    const priceColumns = Object.keys(TENDER_PRICE_TIERS).filter((c) => tierReads(tier, c))
    if (priceColumns.length > 0) {
      tables.costing_tender_line_prices = rowsOf("costing_tender_line_prices")
        .filter((p) => lines.some((l) => l.id === p.tender_line_id))
        .map((p) => {
          const line = lines.find((l) => l.id === p.tender_line_id)
          const row = { tender_line_id: p.tender_line_id, abc_unit: p.abc_unit, final_offer_unit: p.final_offer_unit, quotation_price_unit: matchingSorLine(line)?.unit_price ?? null }
          return Object.fromEntries(Object.entries(row).filter(([key]) => key === "tender_line_id" || priceColumns.includes(key)))
        })
    }
    return { tier, matrix_id: matrix.id, bands, tables }
  })

  stubRpc("costing_set_money", (args) => {
    for (const column of Object.keys(args.p_patch ?? {})) requireBand("costing_tender_line_prices", column, ["sales"])
    const existing = rowsOf("costing_tender_line_prices").find((p) => p.tender_line_id === args.p_row)
    if (existing) updateRow("costing_tender_line_prices", existing, args.p_patch)
    else insertRow("costing_tender_line_prices", { tender_line_id: args.p_row, ...args.p_patch })
    return null
  })

  stubRpc("costing_reorder_tender_lines", (args) => {
    requireBand("costing_tender_lines", "position", ["sales"])
    args.p_ids.forEach((id, index) => {
      const row = rowsOf("costing_tender_lines").find((l) => l.id === id)
      if (row) updateRow("costing_tender_lines", row, { position: index + 1 })
    })
    return null
  })

  stubRpc("costing_history", () => [])
}
