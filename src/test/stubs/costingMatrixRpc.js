import { stubRpc } from "@/test/msw/server"
import { db, deleteRows, insertRow, updateRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"
import {
  BID_DECISION_TIERS,
  COMPONENT_COST_BANDS,
  COMPONENT_COST_TIERS,
  COST_ROW_BANDS,
  COSTING_TIER,
  MATRIX_MONEY_BANDS,
  MATRIX_MONEY_TIERS,
  TENDER_PRICE_TIERS,
  tierReads,
  tierReadsBid,
  tierReadsCost,
} from "@/constants/costing"
import { matrixTotals } from "@/utils/costingMath"

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

    // #270: Marketing and OPEX sit on the matrix's money row, read by Closed Book alone.
    const moneyColumns = Object.keys(MATRIX_MONEY_TIERS).filter((c) => MATRIX_MONEY_TIERS[c].includes(tier))
    if (moneyColumns.length > 0) {
      const money = rowsOf("costing_matrix_money").find((m) => m.matrix_id === matrix.id) ?? { matrix_id: matrix.id }
      tables.costing_matrix_money = [onlyReadable(money, ["matrix_id", ...moneyColumns])]
    }

    // #320: the Bid Decision rows, each cut to the columns this tier may read (the price tier gets no stamped figure).
    const bidColumns = Object.keys(BID_DECISION_TIERS).filter((c) => tierReadsBid(tier, c))
    if (bidColumns.length > 0) {
      tables.costing_bid_decisions = rowsOf("costing_bid_decisions")
        .filter((d) => d.matrix_id === matrix.id)
        .sort((a, b) => String(a.decided_at).localeCompare(String(b.decided_at)))
        .map((d) => onlyReadable(d, bidColumns))
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

  // Which bands may write each column of each money table, as the registry says.
  const MONEY_BANDS = {
    costing_tender_line_prices: { abc_unit: ["sales"], final_offer_unit: ["sales"] },
    costing_component_costs: COMPONENT_COST_BANDS,
    costing_cost_rows: { ...COST_ROW_BANDS },
    costing_matrix_money: MATRIX_MONEY_BANDS,
  }
  const MONEY_KEY = {
    costing_tender_line_prices: "tender_line_id",
    costing_component_costs: "component_id",
    costing_cost_rows: "id",
    costing_matrix_money: "matrix_id",
  }

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
    // The trigger that clears a live Bid Decision when a Final Offer or a Final Acquire changes (#320).
    const changesOffer = table === "costing_tender_line_prices" && "final_offer_unit" in args.p_patch
    const changesAcquire = (table === "costing_component_costs" || table === "costing_cost_rows") && "final_acquire_unit" in args.p_patch
    if (changesOffer || changesAcquire) {
      const matrix = matrixOfMoneyRow(table, args.p_row)
      for (const decision of rowsOf("costing_bid_decisions").filter((d) => d.matrix_id === matrix && d.cleared_at == null)) {
        updateRow("costing_bid_decisions", decision, {
          cleared_at: new Date().toISOString(),
          cleared_reason: changesOffer ? "The Final Offer changed" : "A Final Acquire changed",
        })
      }
    }
    return null
  })

  // The matrix a money row belongs to, walking up the way costing_matrix_of does.
  const matrixOfMoneyRow = (table, rowId) => {
    if (table === "costing_matrix_money") return rowId
    if (table === "costing_cost_rows") return rowsOf(table).find((r) => r.id === rowId)?.matrix_id
    const lineId =
      table === "costing_tender_line_prices"
        ? rowId
        : rowsOf("costing_components").find((c) => c.id === rowId)?.tender_line_id
    return rowsOf("costing_tender_lines").find((l) => l.id === lineId)?.matrix_id
  }

  // #320: the Bid Decision, taken by Closed Book only, stamped with the totals at that moment.
  stubRpc("costing_decide_bid", (args) => {
    const refuse = (code, message, status) => {
      throw pgrstError(code, `costing_bid: ${message}`, { status })
    }
    if (tier !== "closed_book") refuse("42501", "only a Super Admin or the Final Acquire list can decide a bid", 403)
    if (!["go", "no_go", "revise"].includes(args.p_verdict)) refuse("23514", "the verdict must be Go, No-go or Revise", 400)
    if (!String(args.p_reason ?? "").trim()) refuse("23514", "write the reason for the decision", 400)
    const lines = rowsOf("costing_tender_lines").filter((l) => l.matrix_id === args.p_matrix_id)
    const prices = rowsOf("costing_tender_line_prices")
    const totals = matrixTotals(
      lines.map((l) => ({ quantity: l.quantity, ...(prices.find((p) => p.tender_line_id === l.id) ?? {}) })),
    )
    if (lines.length === 0 || totals.missingOffer > 0) {
      refuse("23514", "every Tender Line needs a Final Offer before the bid can be decided", 400)
    }
    for (const live of rowsOf("costing_bid_decisions").filter((d) => d.matrix_id === args.p_matrix_id && d.cleared_at == null)) {
      updateRow("costing_bid_decisions", live, { cleared_at: new Date().toISOString(), cleared_reason: "Decided again" })
    }
    return insertRow("costing_bid_decisions", {
      matrix_id: args.p_matrix_id,
      verdict: args.p_verdict,
      reason: String(args.p_reason).trim(),
      decided_by: null,
      decided_at: new Date().toISOString(),
      final_offer_total: totals.finalOfferTotal,
      abc_total: totals.abcTotal,
    }).id
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

  // #273: the Requested Items that name a Component of this SOR's matrix, as {id, component_id, status, request_id}.
  stubRpc("costing_component_requests", (args) => {
    if (!tier) return null
    const matrix = rowsOf("costing_matrices").find((m) => m.opportunity_id === args.p_opportunity_id)
    if (!matrix) return []
    const lineIds = rowsOf("costing_tender_lines").filter((l) => l.matrix_id === matrix.id).map((l) => l.id)
    const componentIds = rowsOf("costing_components").filter((c) => lineIds.includes(c.tender_line_id)).map((c) => c.id)
    return rowsOf("purchase_request_items")
      .filter((i) => i.component_id && componentIds.includes(i.component_id))
      .map((i) => ({ id: i.id, component_id: i.component_id, status: i.status, request_id: i.request_id }))
  })

  stubRpc("costing_history", () => [])
}
