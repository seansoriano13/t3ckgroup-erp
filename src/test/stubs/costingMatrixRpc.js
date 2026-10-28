import { stubEdgeFunction, stubRpc } from "@/test/msw/server"
import { db, deleteRows, insertRow, updateRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"
import {
  BID_DECISION_TIERS,
  COMPONENT_CANVASS_COST_TIERS,
  COMPONENT_COST_BANDS,
  COMPONENT_COST_TIERS,
  COST_ROW_TIERS,
  tierReadsCostRow,
  COST_ROW_BANDS,
  COSTING_TIER,
  MATRIX_MONEY_BANDS,
  MATRIX_MONEY_TIERS,
  TENDER_PRICE_TIERS,
  tierReads,
  tierReadsBid,
  tierReadsCost,
} from "@/constants/costing"
import { markupPriceUnit, matrixTotals } from "@/utils/costingMath"
import { computeLandedCost } from "@/test/stubs/landedCostFake"
import { tierReadsLandedCost } from "@/constants/costing"

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
 *
 * #269 adds the matrix's default markup factor (supabase/migrations/
 * 20261018120000_costing_matrix_markup.sql): the Closed Book receives the money row, and Markup Price
 * per unit (Acquire x the effective factor, the row's own else the matrix default, x1.00 for a
 * cost-only row) comes with every row for the tiers that read it. `manageMarkup` stands for
 * costing_can_manage_markup (default: the Closed Book). Who may write the factor is the policy tier's
 * (80-costing-markup.test.js).
 *
 * #271 adds the Evaluation of Specification (20261018140000_costing_matrix_evaluation.sql):
 * `costing_sign` is re-implemented here (`onEvaluationList` stands in for membership of the
 * evaluation list, `actorId` for the signed-in employee), the clearing triggers are mirrored in
 * src/test/db/triggers.js, and `costing_history` returns what those triggers wrote. Who may write
 * a verdict (the Technical band) is the policy tier's (82-costing-evaluation.test.js).
 */
export function stubCostingMatrixRpcs({ tier = COSTING_TIER.PRICE, bands = ["sales"], manageMarkup = tier === COSTING_TIER.CLOSED_BOOK, actorId = null, onEvaluationList = true, onFinalAcquireList = tier === COSTING_TIER.CLOSED_BOOK } = {}) {
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

  // canvass_po_suppliers (#281): each Component whose P.O./RFQ No. names a live IPAS, with the supplier
  // on that IPAS's stored Odoo copy. Re-implemented on the store; the real gate is the policy tier's.
  stubRpc("canvass_po_suppliers", (args) => {
    if (!tier) return []
    const matrix = rowsOf("costing_matrices").find((m) => m.opportunity_id === args.p_opportunity_id)
    if (!matrix) return []
    const lineIds = rowsOf("costing_tender_lines").filter((l) => l.matrix_id === matrix.id).map((l) => l.id)
    return rowsOf("costing_components")
      .filter((c) => lineIds.includes(c.tender_line_id) && c.po_rfq_no)
      .flatMap((c) => {
        const po = String(c.po_rfq_no).trim().toUpperCase()
        const ipas = rowsOf("ipas").find((i) => i.po_number === po && i.state !== "cancelled")
        if (!ipas) return []
        const supplier = ipas.odoo_copy?.supplier ?? {}
        return [{ component_id: c.id, po_number: ipas.po_number, supplier_id: supplier.id == null ? null : String(supplier.id), supplier_name: supplier.name ?? null }]
      })
  })

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
      costing_signoffs: rowsOf("costing_signoffs")
        .filter((s) => s.matrix_id === matrix.id)
        .sort((a, b) => String(a.signed_at).localeCompare(String(b.signed_at)))
        .map((s) => ({ ...s })),
      costing_tender_lines: lines.map((l) => ({ ...l, sor_line_now: sorLineNow(l) })),
      costing_components: components.map((c) => ({ ...c })),
      costing_inclusions: rowsOf("costing_inclusions")
        .filter((i) => components.some((c) => c.id === i.component_id))
        .sort((a, b) => a.position - b.position)
        .map((i) => ({ ...i })),
    }

    // A unit-cost row carries only the columns this tier may read; a tier that may read none gets no table.
    // The "from Canvass" mark on Acquire (#278) is read by the tiers that read Acquire.
    const costColumns = [
      ...Object.keys(COMPONENT_COST_TIERS).filter((c) => tierReadsCost(tier, c)),
      ...Object.entries(COMPONENT_CANVASS_COST_TIERS).filter(([, tiers]) => tiers.includes(tier)).map(([c]) => c),
    ]
    const onlyReadable = (row, keep) => Object.fromEntries(Object.entries(row).filter(([key]) => keep.includes(key)))
    const money = rowsOf("costing_matrix_money").find((m) => m.matrix_id === matrix.id)
    const rowColumns = Object.keys(COST_ROW_TIERS).filter((c) => tierReadsCostRow(tier, c))
    const withMarkupPrice = (row, factor, columns = costColumns) =>
      columns.includes("markup_price_unit") ? { ...row, markup_price_unit: markupPriceUnit(row.acquire_unit, factor) } : row
    if (costColumns.length > 0) {
      const keep = ["component_id", ...costColumns]
      tables.costing_component_costs = rowsOf("costing_component_costs")
        .filter((c) => components.some((k) => k.id === c.component_id))
        .map((c) => onlyReadable(withMarkupPrice(c, c.markup_factor ?? money?.default_factor ?? null), keep))
    }
    tables.costing_cost_rows = rowsOf("costing_cost_rows")
      .filter((r) => r.matrix_id === matrix.id)
      .sort((a, b) => a.position - b.position)
      .map((r) => onlyReadable(withMarkupPrice(r, r.markup_factor ?? 1, rowColumns), ["id", "matrix_id", "position", "description", "quantity", "created_at", ...rowColumns]))

    // The matrix's own money row: the default markup factor (#269) and Marketing and OPEX (#270), for the tiers that read them.
    const moneyColumns = Object.keys(MATRIX_MONEY_TIERS).filter((c) => MATRIX_MONEY_TIERS[c].includes(tier))
    if (moneyColumns.length > 0) {
      tables.costing_matrix_money = [onlyReadable(money ?? { matrix_id: matrix.id }, ["matrix_id", ...moneyColumns])]
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

  stubRpc("costing_can_manage_markup", () => manageMarkup)

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
    if (tier !== "closed_book") refuse("42501", "only Sales, Purchasing, a Super Admin or the Final Acquire list can decide a bid", 403)
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
    if (rowsOf("costing_bid_decisions").some((d) => d.matrix_id === args.p_matrix_id && d.cleared_at == null && d.verdict === "go")) {
      refuse("22023", "the sheet is locked by a Go. Unlock it first", 400)
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
      planned_cost_total: null,
      unlocked_by: null,
    }).id
  })

  // #704: unlocking a Go takes a reason, clears the Go and records it.
  stubRpc("costing_unlock_bid", (args) => {
    const refuse = (code, message, status) => {
      throw pgrstError(code, `costing_bid: ${message}`, { status })
    }
    if (tier !== "closed_book") refuse("42501", "only a Super Admin or the people on the decider's list can unlock a bid", 403)
    if (!String(args.p_reason ?? "").trim()) refuse("22023", "write the reason for unlocking", 400)
    const live = rowsOf("costing_bid_decisions").find((d) => d.matrix_id === args.p_matrix_id && d.cleared_at == null && d.verdict === "go")
    if (!live) refuse("22023", "there is no Go to unlock", 400)
    updateRow("costing_bid_decisions", live, { cleared_at: new Date().toISOString(), cleared_reason: `Unlocked: ${String(args.p_reason).trim()}` })
    return live.id
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

  // The Costing Desk fill (20261102190000): a Tender Line and one Component (the product) per SOR product
  // not yet in the matrix. Odoo's costs are the edge function's; here Odoo has none to give.
  stubRpc("costing_fill_from_sor", (args) => {
    if (!bands.includes("sales") && !bands.includes("purchasing")) {
      throw pgrstError("42501", "costing_fill: only Sales or Purchasing can fill the matrix from the SOR", { status: 403 })
    }
    const matrix = rowsOf("costing_matrices").find((m) => m.opportunity_id === args.p_opportunity_id)
    if (!matrix) throw pgrstError("22023", "costing_fill: this SOR has no Costing Matrix yet", { status: 400 })
    const lines = rowsOf("costing_tender_lines").filter((l) => l.matrix_id === matrix.id)
    let position = Math.max(0, ...lines.map((l) => l.position))
    const items = rowsOf("sales_opportunity_items")
      .filter((i) => i.opportunity_id === args.p_opportunity_id && !lines.some((l) => l.sor_item_id === i.id))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    for (const item of items) {
      position += 1
      const unit = (item.unit || "").trim() || null
      const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1
      const line = insertRow("costing_tender_lines", {
        matrix_id: matrix.id,
        position,
        source: "sor_line",
        sor_item_id: item.id,
        odoo_product_id: item.odoo_product_id ?? null,
        tender_specification: item.product_name,
        unit,
        quantity,
        sor_line_snapshot: { name: item.product_name, quantity: Number(item.quantity), unit },
      })
      insertRow("costing_components", { tender_line_id: line.id, position: 1, name: item.product_name, quantity, unit, odoo_product_id: item.odoo_product_id ?? null })
    }
    return items.length
  })
  stubEdgeFunction("odoo-costing-costs", { success: true, filled: 0, unpriced: 0 })

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

  // #283: the matrix's Components, for the two reads below.
  const componentsOf = (opportunityId) => {
    const matrix = rowsOf("costing_matrices").find((m) => m.opportunity_id === opportunityId)
    if (!matrix) return []
    const lineIds = rowsOf("costing_tender_lines").filter((l) => l.matrix_id === matrix.id).map((l) => l.id)
    return rowsOf("costing_components").filter((c) => lineIds.includes(c.tender_line_id))
  }
  const LIVE = ["purchased", "received"]
  const liveIpas = (po) =>
    po ? rowsOf("ipas").filter((i) => i.po_number === String(po).trim() && i.state !== "cancelled").sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null : null
  const orderedOf = (componentId) =>
    rowsOf("purchase_request_items").filter((i) => i.component_id === componentId && LIVE.includes(i.status)).reduce((sum, i) => sum + Number(i.quantity), 0)

  // costing_component_purchases (#283): PO numbers and IPAS per Component, no money, every tier.
  stubRpc("costing_component_purchases", (args) => {
    if (!tier) return []
    return componentsOf(args.p_opportunity_id).map((c) => {
      const items = rowsOf("purchase_request_items").filter((i) => i.component_id === c.id)
      const typed = c.po_rfq_no ? String(c.po_rfq_no).trim() || null : null
      const pos = [...new Set([...items.filter((i) => i.status !== "cancelled").map((i) => i.po_number || null), typed].filter(Boolean))].sort()
      return {
        component_id: c.id,
        po_rfq_no: typed,
        ordered_quantity: orderedOf(c.id),
        requests: items.map((i) => ({ item_id: i.id, request_id: i.request_id, name: i.name, po_number: i.po_number || null, status: i.status, odoo_po_line_ids: i.odoo_po_line_ids ?? [] })),
        ipas: pos.map((po) => {
          const ipas = liveIpas(po)
          return { po_number: po, ipas_id: ipas?.id ?? null, number: ipas?.number ?? null, state: ipas?.state ?? null }
        }),
      }
    })
  })

  // costing_landed_costs (#283): the money tier only. Re-implemented on the store with the IPAS's
  // own Landed Cost maths; that the SQL matches it is the policy tier's (95-costing-landed-cost).
  stubRpc("costing_landed_costs", (args) => {
    if (!tierReadsLandedCost(tier)) return []
    const linesOf = (ipas) => {
      const lc = computeLandedCost({
        copy: ipas.odoo_copy,
        payments: rowsOf("ipas_payments").filter((p) => p.ipas_id === ipas.id),
        charges: rowsOf("ipas_charges").filter((p) => p.ipas_id === ipas.id),
        split: ipas.landed_cost_split || "value",
        computationStatus: ipas.computation_status || "encoding",
        filed: ipas.state === "filed",
        referenceRates: rowsOf("currency_rates"),
      })
      return new Map((ipas.odoo_copy?.lines ?? []).map((l) => [l.line_id, { total: lc.lines.find((x) => x.lineId === l.line_id)?.landedPhp ?? null, mark: lc.status }]))
    }
    const live = rowsOf("purchase_request_items").filter((i) => LIVE.includes(i.status))
    return componentsOf(args.p_opportunity_id).map((c) => {
      const items = live.filter((i) => i.component_id === c.id)
      const row = { component_id: c.id, total_php: null, unit_php: null, mark: null, blank_reason: null, ordered_quantity: orderedOf(c.id) }
      if (items.length === 0) return { ...row, blank_reason: "not_ordered" }
      let total = 0
      let final = true
      for (const item of items) {
        const ipas = liveIpas(item.po_number)
        const picked = item.odoo_po_line_ids ?? []
        if (!ipas || picked.length === 0) return { ...row, blank_reason: "po_line_not_picked" }
        const lines = linesOf(ipas)
        for (const id of picked) {
          const line = lines.get(id)
          if (!line) return { ...row, blank_reason: "line_removed" }
          if (line.mark === "unavailable" || line.total === null) return { ...row, blank_reason: "landed_cost_unavailable" }
          const claimants = live.filter((i) => liveIpas(i.po_number)?.id === ipas.id && (i.odoo_po_line_ids ?? []).includes(id))
          const quantity = claimants.reduce((sum, i) => sum + Number(i.quantity), 0)
          total += claimants.length <= 1 ? line.total : (line.total * Number(item.quantity)) / quantity
          if (line.mark !== "final") final = false
        }
      }
      const rounded = Math.round(total * 100) / 100
      return { ...row, total_php: rounded, unit_php: Math.round((rounded / Number(c.quantity)) * 100) / 100, mark: final ? "final" : "provisional" }
    })
  })

  // ipas_summaries_for_sor, as far as Actual Revenue (#605) reads it: the SOR's project IPAS with their state and
  // Computation status. Tests that care about the IPAS list itself stub their own, after this.
  stubRpc("ipas_summaries_for_sor", (args) => {
    const ids = rowsOf("ipas_sors").filter((s) => s.opportunity_id === args.p_opportunity_id).map((s) => s.ipas_id)
    return rowsOf("ipas")
      .filter((i) => ids.includes(i.id))
      .map((i) => ({ ipas_id: i.id, number: i.number, po_number: i.po_number, state: i.state, computation_status: i.computation_status ?? "encoding" }))
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

  stubRpc("costing_sign", (args) => {
    const role = args.p_role
    if (!["prepared", "costed", "evaluation_approved", "final_approved"].includes(role)) {
      throw pgrstError("22023", `costing_sign: ${role} is not a sign-off`, { status: 400 })
    }
    const matrix = rowsOf("costing_matrices").find((m) => m.id === args.p_matrix_id)
    if (!matrix) throw pgrstError("P0002", "costing_sign: not found", { status: 404 })
    if (!tier) throw pgrstError("42501", "costing_sign: not allowed", { status: 403 })
    // #274: Prepared by is the Sales incharge's, Costed by the Purchasing incharge's, Final Acquire and offer the list's,
    // and since 20261102180000 anyone's who reads this matrix at the Closed Book.
    const refusal = {
      prepared: matrix.sales_incharge_id !== actorId && "only the Sales incharge can sign Prepared by",
      costed: matrix.purchasing_incharge_id !== actorId && "only the Purchasing incharge can sign Costed by",
      evaluation_approved: !onEvaluationList && "only someone on the evaluation list can approve the evaluation",
      final_approved: !onFinalAcquireList && tier !== "closed_book" && "only Sales, Purchasing or the Final Acquire list can approve the Final Acquire and offer",
    }[role]
    if (refusal) throw pgrstError("42501", `costing_sign: ${refusal}`, { status: 403 })
    if (rowsOf("costing_signoffs").some((s) => s.matrix_id === matrix.id && s.role === role && !s.cleared_at)) {
      throw pgrstError("55000", role === "evaluation_approved" ? "costing_sign: the evaluation is already approved" : "costing_sign: that sign-off is already signed", { status: 409 })
    }
    if (role !== "evaluation_approved") {
      const signoff = insertRow("costing_signoffs", { matrix_id: matrix.id, role, signed_by: actorId, signature_declined: Boolean(args.p_decline_signature), signature_version: null })
      return { signoff }
    }
    const lineIds = rowsOf("costing_tender_lines").filter((l) => l.matrix_id === matrix.id).map((l) => l.id)
    const missing = rowsOf("costing_components").filter((c) => lineIds.includes(c.tender_line_id) && !c.compliance).length
    if (missing > 0) {
      throw pgrstError("55000", `costing_sign: ${missing} Component${missing === 1 ? " has" : "s have"} no verdict yet`, { status: 409 })
    }
    const signoff = insertRow("costing_signoffs", { matrix_id: matrix.id, role, signed_by: actorId })
    return { signoff }
  })

  // The history the mirrored triggers wrote, newest first, in the shape costing_history returns.
  stubRpc("costing_history", (args) => {
    const matrix = rowsOf("costing_matrices").find((m) => m.opportunity_id === args.p_opportunity_id)
    if (!matrix || !tier) return null
    return rowsOf("costing_events")
      .filter((e) => e.matrix_id === matrix.id)
      .filter((e) => !args.p_table || e.detail.table === args.p_table)
      .filter((e) => !args.p_row || e.detail.row === args.p_row)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, args.p_limit ?? 100)
      .map((e) => ({ id: e.id, at: e.created_at, actor_id: e.actor_id, kind: e.kind, detail: e.detail }))
  })
}
