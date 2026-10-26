import { beforeEach, describe, expect, it } from "vitest"
import { purchaseRequestService } from "./purchaseRequestService"
import { costingMatrixService } from "./costingMatrixService"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { COSTING_TIER } from "@/constants/costing"

/**
 * Requested Items added from the Costing Matrix (#273), through the services against the fake database
 * with the RPCs re-implemented on its store. What is proven here: the item copies the Component and
 * names it, one Component may have several items, a Component on another SOR is refused, the item
 * keeps its own copy when the Component is edited, and the grid's read of what is being bought for
 * each Component. Who may add (Purchasing access only) is the policy tier's
 * (83-costing-purchase-request-items.test.js).
 */
describe("Requested Items from the Costing Matrix", () => {
  let purchaser
  let opportunity
  let otherOpportunity
  let request
  let lineId
  let hose
  let nozzle
  let foreign

  const itemsOf = (requestId = request.id) => purchaseRequestService.listItems(requestId)

  beforeEach(async () => {
    purchaser = makeEmployee({ name: "Pat Purchaser", has_purchasing_flow: true })
    opportunity = makeOpportunity({ registered_by: purchaser.id, deal_owner_id: purchaser.id })
    otherOpportunity = makeOpportunity({ registered_by: purchaser.id, deal_owner_id: purchaser.id })
    stubCostingMatrixRpcs({ tier: COSTING_TIER.COST, bands: ["sales", "purchasing"] })
    stubPurchaseRequestItemRpcs({ actorId: purchaser.id, purchasing: true })

    const matrix = db.seed("costing_matrices", { opportunity_id: opportunity.id })
    lineId = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Fire hose, 65 mm", quantity: 4 })
    hose = await costingMatrixService.addComponent(lineId, { name: "Hose reel", quantity: 4, unit: "pc", availability: "for_order", odooProductId: 101 })
    nozzle = await costingMatrixService.addComponent(lineId, { name: "Nozzle", quantity: 2, unit: "pc", availability: "available" })

    const otherMatrix = db.seed("costing_matrices", { opportunity_id: otherOpportunity.id })
    const otherLine = await costingMatrixService.addTenderLine(otherMatrix.id, { tenderSpecification: "Other", quantity: 1 })
    foreign = await costingMatrixService.addComponent(otherLine, { name: "Foreign part", quantity: 1 })

    request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: purchaser.id })
    db.seed("purchase_request_members", { request_id: request.id, employee_id: purchaser.id, side: "purchasing" })
  })

  it("adds an item per Component that copies it and names it", async () => {
    const ids = await purchaseRequestService.addItemsFromComponents(request.id, [hose, nozzle])
    expect(ids).toHaveLength(2)

    const items = await itemsOf()
    expect(items.map((i) => [i.source, i.component_id, i.name, Number(i.quantity), i.unit, i.odoo_product_id, i.status])).toEqual([
      ["component", hose, "Hose reel", 4, "pc", 101, "not_checked"],
      ["component", nozzle, "Nozzle", 2, "pc", null, "not_checked"],
    ])
    // The request view reads "1.1 · Hose reel".
    expect(items.map((i) => i.component)).toEqual([
      { id: hose, number: "1.1", name: "Hose reel" },
      { id: nozzle, number: "1.2", name: "Nozzle" },
    ])
  })

  it("allows a second Requested Item on the same Component", async () => {
    await purchaseRequestService.addItemsFromComponents(request.id, [hose])
    await purchaseRequestService.addItemsFromComponents(request.id, [hose])

    const items = await itemsOf()
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.component_id === hose)).toBe(true)
  })

  it("refuses a Component on another SOR's matrix, and adds nothing", async () => {
    await expect(purchaseRequestService.addItemsFromComponents(request.id, [hose, foreign])).rejects.toMatchObject({
      message: expect.stringMatching(/not on this SOR's Costing Matrix/),
    })
    expect(await itemsOf()).toEqual([])
  })

  it("keeps its own copy when the Component is edited later", async () => {
    await purchaseRequestService.addItemsFromComponents(request.id, [hose])

    await costingMatrixService.updateComponent(hose, { name: "Hose reel, 30 m", quantity: 6, unit: "set", odooProductId: 999 })

    const [item] = await itemsOf()
    expect(item).toMatchObject({ name: "Hose reel", unit: "pc", odoo_product_id: 101, component_id: hose })
    expect(Number(item.quantity)).toBe(4)
    // The label follows the Component, the item's own fields do not.
    expect(item.component).toEqual({ id: hose, number: "1.1", name: "Hose reel, 30 m" })
  })

  it("leaves a request with no Component items to a single read", async () => {
    const line = db.seed("sales_opportunity_items", { opportunity_id: opportunity.id, product_name: "Line", quantity: 1, sort_order: 0 })
    await purchaseRequestService.addItemFromLine(request.id, line.id)
    const [item] = await itemsOf()
    expect(item.component).toBeUndefined()
  })

  it("serves the grid each Component's Requested Items with their statuses and nothing else", async () => {
    const [first] = await purchaseRequestService.addItemsFromComponents(request.id, [hose])
    await purchaseRequestService.addItemsFromComponents(request.id, [hose, nozzle])
    db.internal.rowsOf("purchase_request_items").find((i) => i.id === first).status = "purchased"
    // An item of the other SOR's request does not show on this matrix.
    const otherRequest = db.seed("purchase_requests", { opportunity_id: otherOpportunity.id, created_by: purchaser.id })
    await purchaseRequestService.addItemsFromComponents(otherRequest.id, [foreign])

    const requests = await costingMatrixService.componentRequests(opportunity.id)
    expect(requests.map((r) => [r.component_id, r.status])).toEqual([
      [hose, "purchased"],
      [hose, "not_checked"],
      [nozzle, "not_checked"],
    ])
    expect(Object.keys(requests[0]).sort()).toEqual(["component_id", "id", "request_id", "status"])
  })

  it("reads no Requested Items for a caller with no Costing Matrix tier", async () => {
    stubCostingMatrixRpcs({ tier: null, bands: [] })
    expect(await costingMatrixService.componentRequests(opportunity.id)).toEqual([])
  })
})
