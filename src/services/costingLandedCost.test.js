import { beforeEach, describe, expect, it } from "vitest"
import { costingMatrixService } from "./costingMatrixService"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc"
import { COSTING_TIER } from "@/constants/costing"

/**
 * Landed Cost on the Costing Matrix through the service (#283), against the fake database with
 * costing_landed_costs and costing_component_purchases re-implemented on its store. What the
 * screen reads: each Component's Landed Cost and mark or blank reason, the Tender Line and matrix
 * roll-ups, the PO and IPAS columns, and "ordered 3 of 5"; for a participant no Landed Cost key.
 * That the SQL does the same sums, and who it refuses, is the policy tier's (95-costing-landed-cost).
 */
describe("Landed Cost on the Costing Matrix", () => {
  let owner, opportunity, matrix, line, hose, nozzle, ipas

  const ALL_BANDS = ["sales", "purchasing", "management", "finance"]
  const copy = (lines) => ({ po: { name: "P02552", currency: "Php" }, supplier: { id: 1, name: "Scorpe" }, lines })

  beforeEach(async () => {
    owner = makeEmployee({ name: "Ben Cruz", department: "SALES" })
    opportunity = makeOpportunity({ registered_by: owner.id, deal_owner_id: owner.id })
    matrix = db.seed("costing_matrices", { opportunity_id: opportunity.id })
    stubCostingMatrixRpcs({ tier: COSTING_TIER.CLOSED_BOOK, bands: ALL_BANDS })
    line = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Cutters", quantity: 1, abcUnit: 20000, finalOfferUnit: 15000 })
    hose = await costingMatrixService.addComponent(line, { name: "Cutter", quantity: 6 })
    await costingMatrixService.updateComponent(hose, { acquireUnit: 1300, finalAcquireUnit: 1300 })
    nozzle = await costingMatrixService.addComponent(line, { name: "Blade", quantity: 5 })
    await costingMatrixService.updateComponent(nozzle, { acquireUnit: 90, finalAcquireUnit: 90 })

    ipas = db.seed("ipas", {
      number: "TGIPAS_050",
      po_number: "P02552",
      state: "open",
      purpose: "project",
      source: "local",
      priority: "high",
      created_by: owner.id,
      computation_status: "encoding",
      landed_cost_split: "value",
      odoo_copy: copy([
        { line_id: 11, name: "Cutter", quantity: 6, price_unit: 1250 },
        { line_id: 12, name: "Blade", quantity: 3, price_unit: 80 },
      ]),
    })
  })

  const request = () => db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: owner.id })
  const item = (componentId, fields) =>
    db.seed("purchase_request_items", { request_id: requestId, source: "component", component_id: componentId, name: "Item", status: "ordered", requested_by: owner.id, po_number: "P02552", odoo_po_line_ids: [], ...fields })
  let requestId
  const read = () => costingMatrixService.get(opportunity.id)
  const componentsOf = (m) => m.tenderLines.flatMap((l) => l.components)

  it("attaches each Component's Landed Cost, and rolls the Tender Line and matrix up", async () => {
    requestId = request().id
    item(hose, { quantity: 6, odoo_po_line_ids: [11] })
    item(nozzle, { quantity: 3, odoo_po_line_ids: [12] })

    const m = await read()
    const [cutter, blade] = componentsOf(m)
    expect(cutter.landed_cost).toEqual({ total: 7500, unit: 1250, mark: "provisional", blankReason: null })
    expect(blade.landed_cost).toEqual({ total: 240, unit: 48, mark: "provisional", blankReason: null })
    expect(m.tenderLines[0].totals.landedCost).toEqual({ total: 7740, mark: "provisional" })
    expect(m.totals.landedCost).toEqual({ total: 7740, mark: "provisional" })
    // "ordered 3 of 5": shown, not blocking; the unit still divides by the Component's own quantity.
    expect(blade.purchases.orderedShort).toEqual({ ordered: 3, of: 5 })
    expect(cutter.purchases.orderedShort).toBeNull()
    expect(cutter.purchases.ipas).toEqual([{ poNumber: "P02552", ipasId: ipas.id, number: "TGIPAS_050", state: "open" }])
  })

  it("leaves Markup, the summary, Revenue and Final Acquire exactly as they were", async () => {
    db.seed("costing_settings", { id: 1 })
    const before = await read()
    requestId = request().id
    item(hose, { quantity: 6, odoo_po_line_ids: [11] })
    item(nozzle, { quantity: 5, odoo_po_line_ids: [12] })
    const after = await read()

    expect(after.totals.landedCost).not.toBeNull()
    expect(after.summary).toEqual(before.summary)
    expect(after.markup).toEqual(before.markup)
    expect(after.tenderLines[0].markup).toEqual(before.tenderLines[0].markup)
    expect(componentsOf(after).map((c) => [c.final_acquire_unit, c.acquire_unit, c.markup])).toEqual(componentsOf(before).map((c) => [c.final_acquire_unit, c.acquire_unit, c.markup]))
    expect(after.signoffs).toEqual(before.signoffs)
  })

  it("passes the blank reasons through, and blanks the roll-up", async () => {
    requestId = request().id
    item(hose, { quantity: 6, odoo_po_line_ids: [] })
    item(nozzle, { quantity: 5, odoo_po_line_ids: [99] })

    const m = await read()
    const [cutter, blade] = componentsOf(m)
    expect(cutter.landed_cost.blankReason).toBe("po_line_not_picked")
    expect(blade.landed_cost.blankReason).toBe("line_removed")
    expect(m.tenderLines[0].totals.landedCost).toBeNull()
  })

  it("is final once the IPAS reaches Costs complete", async () => {
    requestId = request().id
    item(hose, { quantity: 6, odoo_po_line_ids: [11] })
    item(nozzle, { quantity: 5, odoo_po_line_ids: [12] })
    db.internal.rowsOf("ipas").find((r) => r.id === ipas.id).computation_status = "lc_odoo_done"
    expect((await read()).totals.landedCost.mark).toBe("final")
  })

  it("gives a Stage Participant the PO and IPAS columns and no Landed Cost key", async () => {
    requestId = request().id
    item(hose, { quantity: 6, odoo_po_line_ids: [11] })
    stubCostingMatrixRpcs({ tier: COSTING_TIER.PARTICIPANT, bands: [] })

    const m = await read()
    const [cutter] = componentsOf(m)
    expect(cutter).not.toHaveProperty("landed_cost")
    expect(m.tenderLines[0].totals).not.toHaveProperty("landedCost")
    expect(m.totals).not.toHaveProperty("landedCost")
    expect(cutter.purchases.poNumbers).toEqual(["P02552"])
  })
})
