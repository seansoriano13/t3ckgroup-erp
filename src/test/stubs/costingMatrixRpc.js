import { stubRpc } from "@/test/msw/server"
import { db, deleteRows, insertRow, updateRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"
import { COMPONENT_COST_BANDS, COMPONENT_COST_TIERS, COST_ROW_BANDS, COSTING_TIER, TENDER_PRICE_TIERS, tierReads, tierReadsCost } from "@/constants/costing"

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
 *
 * #268 adds Components, their costs, Inclusions and cost-only rows (supabase/
 * migrations/20261018110000_costing_matrix_components.sql); the unit-cost columns
 * a tier receives are `COMPONENT_COST_TIERS`, proven equal to the registry in
 * 79-costing-components.test.js. The rows the database refuses by trigger
 * (an Inclusion under a non-bundle) are refused here with the same message.
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
    const components = rowsOf("costing_components")
      .filter((c) => lines.some((l) => l.id === c.tender_line_id))
      .sort((a, b) => a.position - b.position)
    const tables = {
      costing_matrices: [{ ...matrix }],
      costing_tender_lines: lines.map((l) => ({ ...l, sor_line_now: sorLineNow(l) })),
      costing_components: components.map((c) => ({ ...c })),
      costing_inclusions: rowsOf("costing_inclusions")
        .filter((i) => components.some((c) => c.id === i.component_id))
        .sort((a, b) => a.position - b.position)
        .map((i) => ({ ...i })),
    }

    // A unit-cost row carries only the columns this tier may read; a tier that may read none gets no table.
    const costColumns = Object.keys(COMPONENT_COST_TIERS).filter((c) => tierReadsCost(tier, c))
    const onlyReadable = (row, keep) => Object.fromEntries(Object.entries(row).filter(([key]) => keep.includes(key)))
    if (costColumns.length > 0) {
      const keep = ["component_id", ...costColumns]
      tables.costing_component_costs = rowsOf("costing_component_costs")
        .filter((c) => components.some((k) => k.id === c.component_id))
        .map((c) => onlyReadable(c, keep))
    }
    tables.costing_cost_rows = rowsOf("costing_cost_rows")
      .filter((r) => r.matrix_id === matrix.id)
      .sort((a, b) => a.position - b.position)
      .map((r) => onlyReadable(r, ["id", "matrix_id", "position", "description", "quantity", "created_at", ...costColumns]))

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

  // Which bands may write each column of each money table, as the registry says.
  const MONEY_BANDS = {
    costing_tender_line_prices: { abc_unit: ["sales"], final_offer_unit: ["sales"] },
    costing_component_costs: COMPONENT_COST_BANDS,
    costing_cost_rows: { ...COST_ROW_BANDS },
  }
  const MONEY_KEY = { costing_tender_line_prices: "tender_line_id", costing_component_costs: "component_id", costing_cost_rows: "id" }

  stubRpc("costing_set_money", (args) => {
    const table = args.p_table
    const bandsOf = MONEY_BANDS[table]
    if (!bandsOf) throw pgrstError("22023", `costing_set_money: ${table} is not a money table`, { status: 400 })
    for (const column of Object.keys(args.p_patch ?? {})) requireBand(table, column, bandsOf[column] ?? ["sales"])
    const key = MONEY_KEY[table]
    const existing = rowsOf(table).find((r) => r[key] === args.p_row)
    if (existing) updateRow(table, existing, args.p_patch)
    else if (table === "costing_cost_rows") throw pgrstError("P0002", "costing_set_money: not found", { status: 404 })
    else insertRow(table, { [key]: args.p_row, ...args.p_patch })
    return null
  })

  stubRpc("costing_move_inclusion", (args) => {
    requireBand("costing_inclusions", "component_id", ["sales", "purchasing"])
    const inclusion = rowsOf("costing_inclusions").find((i) => i.id === args.p_inclusion_id)
    const target = rowsOf("costing_components").find((c) => c.id === args.p_component_id)
    if (!inclusion || !target) throw pgrstError("P0002", "costing_move_inclusion: not found", { status: 404 })
    if (!target.is_bundle) {
      throw pgrstError("23514", "costing_move_inclusion: an Inclusion can only sit under a bundle Component", { status: 400 })
    }
    const last = Math.max(0, ...rowsOf("costing_inclusions").filter((i) => i.component_id === target.id).map((i) => i.position))
    updateRow("costing_inclusions", inclusion, { component_id: target.id, position: last + 1 })
    return null
  })

  stubRpc("costing_add_cost_row", (args) => {
    requireBand("costing_cost_rows", "*", ["sales", "purchasing"])
    const last = Math.max(0, ...rowsOf("costing_cost_rows").filter((r) => r.matrix_id === args.p_matrix_id).map((r) => r.position))
    return insertRow("costing_cost_rows", {
      matrix_id: args.p_matrix_id,
      position: last + 1,
      description: args.p_description ?? "",
      quantity: args.p_quantity ?? 1,
      markup_factor: 1,
    }).id
  })

  stubRpc("costing_remove_cost_row", (args) => {
    requireBand("costing_cost_rows", "*", ["sales", "purchasing"])
    const row = rowsOf("costing_cost_rows").find((r) => r.id === args.p_row_id)
    if (!row) throw pgrstError("P0002", "costing_remove_cost_row: not found", { status: 404 })
    deleteRows("costing_cost_rows", [row])
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
