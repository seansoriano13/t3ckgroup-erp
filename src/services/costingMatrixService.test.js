import { beforeEach, describe, expect, it } from "vitest"
import { CostingBandError, costingMatrixService, toBandError } from "./costingMatrixService"
import { opportunityService } from "./opportunityService"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc"
import { COSTING_TIER } from "@/constants/costing"

/**
 * The Costing Matrix through the service (#267), against the fake database with
 * the matrix functions re-implemented on its store (stubCostingMatrixRpcs). What
 * the screen reads: Tender Lines numbered from 1, their totals, what the SOR line
 * now says, and no money key for a tier that never received it. Who may read or
 * write is the policy tier's (78-costing-tender-lines.test.js).
 */
describe("costingMatrixService", () => {
  let salesperson
  let opportunity
  let matrix

  const productList = [
    { product_name: "Full Body Harness", unit: "pc", quantity: 10, unit_price: 5998.1, odoo_product_id: 101 },
    { product_name: "Rope Access Kit", unit: "set", quantity: 2, unit_price: 30000, odoo_product_id: 202 },
  ]

  const lineNamed = async (name) => (await opportunityService.getItems(opportunity.id)).find((l) => l.product_name === name)

  beforeEach(async () => {
    salesperson = makeEmployee({ name: "Sales Person", department: "SALES" })
    opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
    await opportunityService.updateOpportunity(opportunity.id, { items: productList }, salesperson.id)
    matrix = db.seed("costing_matrices", { opportunity_id: opportunity.id })
    stubCostingMatrixRpcs({ tier: COSTING_TIER.PRICE, bands: ["sales"] })
  })

  it("reads nothing before the SOR has a matrix", async () => {
    const other = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
    expect(await costingMatrixService.get(other.id)).toBeNull()
  })

  it("adds typed Tender Lines in order, numbered from 1, with their totals", async () => {
    const first = await costingMatrixService.addTenderLine(matrix.id, {
      tenderSpecification: "Rescue tripod\nAluminium, 3 m",
      unit: "set",
      quantity: 2,
      abcUnit: 120000,
      finalOfferUnit: 99500.5,
    }, salesperson.id)
    await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Anchor plate", unit: "pc", quantity: 4 }, salesperson.id)

    const read = await costingMatrixService.get(opportunity.id)
    expect(read.tier).toBe("price")
    expect(read.matrixId).toBe(matrix.id)
    expect(read.tenderLines.map((l) => [l.number, l.tender_specification])).toEqual([
      [1, "Rescue tripod\nAluminium, 3 m"],
      [2, "Anchor plate"],
    ])
    expect(read.tenderLines[0]).toMatchObject({
      id: first,
      created_by: salesperson.id,
      totals: { abcTotal: 240000, finalOfferTotal: 199001, overAbc: false },
    })
    // The second line has no prices yet: nothing is zero.
    expect(read.tenderLines[1].totals).toEqual({ abcTotal: null, finalOfferTotal: null, overAbc: false, percentOfAbc: null })
    expect(read.totals).toMatchObject({ abcTotal: null, finalOfferTotal: null, missingOffer: 1, missingAbc: 1 })
  })

  it("flags a Tender Line over its ABC and shows Final Offer as a percentage of ABC", async () => {
    await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Over", quantity: 1, abcUnit: 1000, finalOfferUnit: 1000.01 })
    await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Under", quantity: 1, abcUnit: 2000, finalOfferUnit: 1000 })

    const read = await costingMatrixService.get(opportunity.id)
    expect(read.tenderLines.map((l) => l.totals.overAbc)).toEqual([true, false])
    expect(read.totals).toMatchObject({ abcTotal: 3000, finalOfferTotal: 2000.01, overAbc: false, percentOfAbc: 66.67 })
  })

  it("keeps the snapshot of a picked Tender Line after updateOpportunity replaces the lines, and says what the SOR line now says", async () => {
    const harness = await lineNamed("Full Body Harness")
    const id = await costingMatrixService.addTenderLineFromSorLine(matrix.id, harness, { abcUnit: 6500, finalOfferUnit: 6200 })

    await opportunityService.updateOpportunity(
      opportunity.id,
      { items: [{ ...productList[0], quantity: 12, unit_price: 6100 }, productList[1]] },
      salesperson.id,
    )

    const read = await costingMatrixService.get(opportunity.id)
    const [line] = read.tenderLines
    expect(line).toMatchObject({
      id,
      source: "sor_line",
      odoo_product_id: 101,
      tender_specification: "Full Body Harness",
      quantity: 10,
      unit: "pc",
      sor_line_snapshot: { name: "Full Body Harness", quantity: 10, unit: "pc" },
      sor_line_now: { found: true, quantity: 12, unit: "pc" },
      sorChange: { kind: "changed", label: "SOR line now says 12 pc" },
      // The quotation price is the SOR line's, beside Final Offer, never copied into it.
      quotation_price_unit: 6100,
      final_offer_unit: 6200,
    })
    // The totals still use the Tender Line's own quantity.
    expect(line.totals.finalOfferTotal).toBe(62000)
  })

  it("says the SOR line was removed when it is gone, and nothing for a typed line", async () => {
    const harness = await lineNamed("Full Body Harness")
    await costingMatrixService.addTenderLineFromSorLine(matrix.id, harness)
    await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Typed", quantity: 1 })

    await opportunityService.updateOpportunity(opportunity.id, { items: [productList[1]] }, salesperson.id)

    const [picked, typed] = (await costingMatrixService.get(opportunity.id)).tenderLines
    expect(picked.sorChange).toEqual({ kind: "removed", label: "SOR line removed" })
    expect(picked.sor_line_snapshot.quantity).toBe(10)
    expect(typed.sorChange).toBeNull()
    expect(typed.sor_line_now).toBeNull()
  })

  it("updates a line and its prices, and clears a price with null", async () => {
    const id = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "A", quantity: 1, finalOfferUnit: 5 })
    await costingMatrixService.updateTenderLine(id, { tenderSpecification: "A, revised", quantity: 3, abcUnit: 10, finalOfferUnit: null })

    const [line] = (await costingMatrixService.get(opportunity.id)).tenderLines
    expect(line).toMatchObject({ tender_specification: "A, revised", quantity: 3, abc_unit: 10, final_offer_unit: null })
  })

  it("reorders and removes", async () => {
    const a = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "A" })
    const b = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "B" })
    const c = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "C" })

    await costingMatrixService.reorder(matrix.id, [c, a, b])
    expect((await costingMatrixService.get(opportunity.id)).tenderLines.map((l) => l.tender_specification)).toEqual(["C", "A", "B"])

    await costingMatrixService.removeTenderLine(a)
    const after = (await costingMatrixService.get(opportunity.id)).tenderLines
    expect(after.map((l) => [l.number, l.tender_specification])).toEqual([
      [1, "C"],
      [2, "B"],
    ])
  })

  it("gives a Stage Participant the Tender Lines with no money key at all", async () => {
    const id = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Spec", quantity: 2, abcUnit: 100, finalOfferUnit: 90 })
    stubCostingMatrixRpcs({ tier: COSTING_TIER.PARTICIPANT, bands: [] })

    const read = await costingMatrixService.get(opportunity.id)
    expect(read.tier).toBe("participant")
    const [line] = read.tenderLines
    expect(line.id).toBe(id)
    for (const key of ["abc_unit", "final_offer_unit", "quotation_price_unit"]) {
      expect(Object.keys(line)).not.toContain(key)
    }
    // No figure is invented for what was never received.
    expect(line.totals).toEqual({ abcTotal: null, finalOfferTotal: null, overAbc: false, percentOfAbc: null })
    expect(JSON.stringify(read)).not.toMatch(/abc_unit|final_offer_unit|quotation_price_unit/)
  })

  it("gives Purchasing the ABC but never the Final Offer", async () => {
    await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Spec", quantity: 2, abcUnit: 100, finalOfferUnit: 90 })
    stubCostingMatrixRpcs({ tier: COSTING_TIER.COST, bands: ["purchasing"] })

    const [line] = (await costingMatrixService.get(opportunity.id)).tenderLines
    expect(line.abc_unit).toBe(100)
    expect(Object.keys(line)).not.toContain("final_offer_unit")
    expect(line.totals).toMatchObject({ abcTotal: 200, finalOfferTotal: null })
  })

  it("reads no matrix for a caller with no tier", async () => {
    stubCostingMatrixRpcs({ tier: null, bands: [] })
    expect(await costingMatrixService.get(opportunity.id)).toBeNull()
    expect(await costingMatrixService.tier(opportunity.id)).toBeNull()
  })

  it("throws a typed band error naming the column when a write is outside the caller's band", async () => {
    const id = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Spec", quantity: 1 })
    stubCostingMatrixRpcs({ tier: COSTING_TIER.COST, bands: ["purchasing"] })

    const error = await costingMatrixService.updateTenderLine(id, { finalOfferUnit: 5 }).catch((e) => e)
    expect(error).toBeInstanceOf(CostingBandError)
    expect(error).toMatchObject({
      name: "CostingBandError",
      table: "costing_tender_line_prices",
      column: "final_offer_unit",
      bands: ["sales"],
      message: "Final Offer is written by Sales (the Deal Team).",
    })

    const reorder = await costingMatrixService.reorder(matrix.id, [id]).catch((e) => e)
    expect(reorder).toBeInstanceOf(CostingBandError)
    expect(reorder.column).toBe("position")
  })

  it("reads a band refusal off the database error, and nothing else", () => {
    const refusal = toBandError({ code: "42501", message: "costing_band:costing_tender_lines.*:sales" })
    expect(refusal).toMatchObject({ table: "costing_tender_lines", column: "*", bands: ["sales"] })
    expect(refusal.message).toBe("Adding or removing a Tender Line is written by Sales (the Deal Team).")
    expect(toBandError({ code: "42501", message: "costing_band:costing_x.y:sales,management" }).bands).toEqual(["sales", "management"])
    expect(toBandError({ code: "42501", message: "new row violates row-level security policy" })).toBeNull()
    expect(toBandError({ code: "23514", message: "costing_band:costing_tender_lines.*:sales" })).toBeNull()
    expect(toBandError(null)).toBeNull()
  })

  it("serves the history through the database", async () => {
    expect(await costingMatrixService.history(opportunity.id, { table: "costing_tender_lines", limit: 5 })).toEqual([])
  })
})
