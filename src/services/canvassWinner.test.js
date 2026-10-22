import { beforeEach, describe, expect, it } from "vitest"

import { canvassService } from "./canvassService"
import { costingMatrixService } from "./costingMatrixService"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { seedCanvass, stubCanvassMoneyRpc, stubCanvassWinnerRpcs } from "@/test/stubs/canvassRpc"
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc"
import { COSTING_TIER } from "@/constants/costing"

/**
 * Marking a winner (#278): the Offer fills its Component's Acquire (converted for a foreign
 * quote), Offer Specification and documents, each marked "from Canvass" until a hand edit; a
 * differing brand is proposed, never written. Through canvassService and costingMatrixService on
 * the fake database, with the winner RPC re-implemented on its store and the mark-nulling and
 * Evaluation-clearing triggers mirrored (src/test/db/triggers.js). The real triggers and the
 * refusals are the policy tier's (91-canvass-winner.test.js).
 */
describe("a winning Offer fills the Component", () => {
  let purchaser
  let opportunity
  let matrix
  let component
  let canvass
  let redleaf
  let ferno
  let hongKong

  const stored = (id) => db.rows("costing_components").find((c) => c.id === id)
  const storedCost = (id) => db.rows("costing_component_costs").find((c) => c.component_id === id)
  const read = async () => (await costingMatrixService.get(opportunity.id)).tenderLines[0].components[0]

  const brochure = (name) => [{ url: `https://files.test/${name}.pdf`, name: `${name}.pdf`, type: "application/pdf", bytes: 1200 }]

  beforeEach(async () => {
    stubCanvassMoneyRpc({ money: true })
    purchaser = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true })
    opportunity = makeOpportunity({ registered_by: purchaser.id, deal_owner_id: purchaser.id, sales_reference: "S07983" })
    matrix = db.seed("costing_matrices", { opportunity_id: opportunity.id })
    stubCostingMatrixRpcs({ tier: COSTING_TIER.CLOSED_BOOK, bands: ["sales", "purchasing", "technical"], actorId: purchaser.id })
    stubCanvassWinnerRpcs({ bands: ["purchasing"] })

    const lineId = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Folding stretcher", quantity: 2, abcUnit: 90000, finalOfferUnit: 95000 })
    const componentId = await costingMatrixService.addComponent(lineId, { name: "Ambulance Folding Stretcher", brand: "Generic" })
    component = stored(componentId)

    canvass = await seedCanvass({ componentId }, purchaser.id)
    redleaf = await canvassService.addOffer(
      canvass.id,
      { supplierName: "Redleaf Inc.", brand: "Redleaf", description: "Folding stretcher, 227 kg, aluminium", unitPrice: 78000, brochure: brochure("redleaf") },
      purchaser.id,
    )
    ferno = await canvassService.addOffer(canvass.id, { supplierName: "Ferno", brand: "Ferno", description: "Ferno stretcher, 200 kg", unitPrice: 82500 }, purchaser.id)
    hongKong = await canvassService.addOffer(
      canvass.id,
      { supplierName: "Hong Kong", brand: "Redleaf", description: "Folding stretcher, straps sold separately", currency: "USD", unitPrice: 1280, comparisonRate: 56.5625, brochure: brochure("hk") },
      purchaser.id,
    )
  })

  it("fills Acquire, Offer Specification and the brochure citation from a PHP winner", async () => {
    const result = await canvassService.markWinner(canvass.id, redleaf.id)
    expect(result.filled).toEqual({ acquire: true, offer_specification: true, documents: true })

    expect(storedCost(component.id)).toMatchObject({ acquire_unit: 78000, acquire_from_offer_id: redleaf.id })
    expect(stored(component.id)).toMatchObject({
      offer_specification: "Folding stretcher, 227 kg, aluminium",
      offer_specification_from_offer_id: redleaf.id,
    })
    expect(stored(component.id).documents).toEqual([{ ...brochure("redleaf")[0], offer_id: redleaf.id }])
  })

  it("converts a USD winner to PHP at its comparison rate", async () => {
    await canvassService.markWinner(canvass.id, hongKong.id)
    expect(storedCost(component.id)).toMatchObject({ acquire_unit: 72400, acquire_from_offer_id: hongKong.id })
  })

  it("keeps one winner: a second pick clears the first", async () => {
    await canvassService.markWinner(canvass.id, redleaf.id)
    await canvassService.markWinner(canvass.id, ferno.id)
    const offers = (await canvassService.getForComponent(component.id)).offers
    expect(offers.filter((o) => o.is_winner).map((o) => o.supplier_name)).toEqual(["Ferno"])
  })

  it("refuses a foreign Offer that has no comparison rate, and fills nothing", async () => {
    const noRate = await canvassService.addOffer(canvass.id, { supplierName: "Tokyo", currency: "JPY", unitPrice: 9000 }, purchaser.id)
    await expect(canvassService.markWinner(canvass.id, noRate.id)).rejects.toMatchObject({ message: expect.stringMatching(/comparison rate/) })
    expect(storedCost(component.id)).toBeUndefined()
    expect((await canvassService.getForComponent(component.id)).offers.some((o) => o.is_winner)).toBe(false)
  })

  it("shows 'from Canvass' on the matrix, and a hand edit takes the mark off", async () => {
    await canvassService.markWinner(canvass.id, redleaf.id)
    expect((await read()).fromCanvass).toEqual({ acquire: true, offerSpecification: true })

    await costingMatrixService.updateComponent(component.id, { acquireUnit: 76500 })
    expect(storedCost(component.id)).toMatchObject({ acquire_unit: 76500, acquire_from_offer_id: null })
    expect((await read()).fromCanvass).toEqual({ acquire: false, offerSpecification: true })

    await costingMatrixService.updateComponent(component.id, { offerSpecification: "Typed by hand" })
    expect((await read()).fromCanvass).toEqual({ acquire: false, offerSpecification: false })
  })

  it("on a re-pick leaves a hand-edited Acquire alone and refills Offer Specification", async () => {
    await canvassService.markWinner(canvass.id, redleaf.id)
    await costingMatrixService.updateComponent(component.id, { acquireUnit: 76500 })

    const result = await canvassService.markWinner(canvass.id, ferno.id)
    expect(result.filled).toMatchObject({ acquire: false, offer_specification: true })
    expect(storedCost(component.id)).toMatchObject({ acquire_unit: 76500, acquire_from_offer_id: null })
    expect(stored(component.id)).toMatchObject({ offer_specification: "Ferno stretcher, 200 kg", offer_specification_from_offer_id: ferno.id })
  })

  it("on a re-pick to an Offer with no price or description keeps the values but drops their marks", async () => {
    const bare = await canvassService.addOffer(canvass.id, { supplierName: "Quote pending", brand: "TBD" }, purchaser.id)
    await canvassService.markWinner(canvass.id, redleaf.id)
    expect((await read()).fromCanvass).toEqual({ acquire: true, offerSpecification: true })

    const result = await canvassService.markWinner(canvass.id, bare.id)
    expect(result.filled).toMatchObject({ acquire: false, offer_specification: false })
    expect(storedCost(component.id)).toMatchObject({ acquire_unit: 78000, acquire_from_offer_id: null })
    expect(stored(component.id)).toMatchObject({ offer_specification: "Folding stretcher, 227 kg, aluminium", offer_specification_from_offer_id: null })
    expect((await read()).fromCanvass).toEqual({ acquire: false, offerSpecification: false })
  })

  it("on a re-pick refills a field that is still marked, and swaps the brochure citation", async () => {
    await canvassService.markWinner(canvass.id, redleaf.id)
    await canvassService.markWinner(canvass.id, hongKong.id)
    expect(storedCost(component.id)).toMatchObject({ acquire_unit: 72400, acquire_from_offer_id: hongKong.id })
    expect(stored(component.id).documents.map((d) => d.name)).toEqual(["hk.pdf"])
  })

  it("leaves a typed Offer Specification alone, and documents someone added", async () => {
    await costingMatrixService.updateComponent(component.id, { offerSpecification: "Written by Purchasing" })
    const own = { url: "https://files.test/own.pdf", name: "own.pdf", type: "application/pdf", bytes: 5 }
    db.internal.rowsOf("costing_components").find((c) => c.id === component.id).documents = [own]

    await canvassService.markWinner(canvass.id, redleaf.id)
    expect(stored(component.id).offer_specification).toBe("Written by Purchasing")
    expect(stored(component.id).documents).toEqual([own, { ...brochure("redleaf")[0], offer_id: redleaf.id }])
  })

  it("clears 'Evaluation approved' when it changes the Offer Specification", async () => {
    for (const c of db.internal.rowsOf("costing_components")) c.compliance = "complies"
    await costingMatrixService.sign(matrix.id, "evaluation_approved")
    expect((await costingMatrixService.get(opportunity.id)).evaluation.approved).toBe(true)

    await canvassService.markWinner(canvass.id, redleaf.id)
    const after = await costingMatrixService.get(opportunity.id)
    expect(after.evaluation.approved).toBe(false)
    expect(after.evaluation.cleared.cleared_reason).toBe("An Offer Specification changed")
  })

  it("fills nothing from a Canvass on a Requested Item", async () => {
    const request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: purchaser.id })
    const item = db.seed("purchase_request_items", { request_id: request.id, name: "Printer paper", quantity: 5, source: "new", requested_by: purchaser.id })
    const itemCanvass = await seedCanvass({ requestedItemId: item.id }, purchaser.id)
    const offer = await canvassService.addOffer(itemCanvass.id, { supplierName: "Paper Co", description: "A4 ream", unitPrice: 250 }, purchaser.id)

    const result = await canvassService.markWinner(itemCanvass.id, offer.id)
    expect(result.filled).toEqual({ acquire: false, offer_specification: false, documents: false })
    expect(db.rows("costing_component_costs")).toHaveLength(0)
    expect(stored(component.id).offer_specification).toBeNull()
  })

  describe("the brand", () => {
    it("is proposed when the winner's differs, never written", async () => {
      await canvassService.markWinner(canvass.id, redleaf.id)
      const row = await read()
      expect(row.brand).toBe("Generic")
      expect(row.brandProposal).toBe("Redleaf")
      expect(row.canvass).toMatchObject({ number: "CNV_0001", signed: false, winner: { id: redleaf.id, brand: "Redleaf", supplierName: "Redleaf Inc." } })
    })

    it("is not proposed when it is the Component's already, or the Canvass has no winner", async () => {
      expect((await read()).brandProposal).toBeNull()
      await costingMatrixService.updateComponent(component.id, { brand: "redleaf" })
      await canvassService.markWinner(canvass.id, redleaf.id)
      expect((await read()).brandProposal).toBeNull()
    })

    it("is written into Brand only when Sales or Purchasing accepts", async () => {
      await canvassService.markWinner(canvass.id, redleaf.id)

      stubCanvassWinnerRpcs({ bands: [] })
      await expect(canvassService.acceptBrand(component.id)).rejects.toMatchObject({ code: "42501" })
      expect(stored(component.id).brand).toBe("Generic")

      stubCanvassWinnerRpcs({ bands: ["purchasing"] })
      expect(await canvassService.acceptBrand(component.id)).toEqual({ brand: "Redleaf" })
      expect(stored(component.id).brand).toBe("Redleaf")
      expect((await read()).brandProposal).toBeNull()
    })
  })
})
