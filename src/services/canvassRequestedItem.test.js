import { beforeEach, describe, expect, it } from "vitest"

import { canvassService } from "./canvassService"
import { costingMatrixService } from "./costingMatrixService"
import { purchaseRequestService } from "./purchaseRequestService"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { seedCanvass, stubCanvassMoneyRpc, stubCanvassWinnerRpcs } from "@/test/stubs/canvassRpc"
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { COSTING_TIER } from "@/constants/costing"

/**
 * Canvass on a Requested Item (#280): Inventory, Supplies and Events purchases are canvassed
 * against the item itself; an item that names a Component is canvassed through the Component.
 * Through the services on the fake database, with the subject trigger mirrored
 * (src/test/db/triggers.js). Who may read what is the policy tier's (94-canvass-requested-item).
 */
describe("Canvass on a Requested Item", () => {
  let purchaser
  let opportunity
  let request
  let plainItem
  let componentItem
  let componentId

  beforeEach(async () => {
    stubCanvassMoneyRpc({ money: true })
    purchaser = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true })
    opportunity = makeOpportunity({ registered_by: purchaser.id, deal_owner_id: purchaser.id })
    stubCostingMatrixRpcs({ tier: COSTING_TIER.COST, bands: ["sales", "purchasing"], actorId: purchaser.id })
    stubCanvassWinnerRpcs({ bands: ["purchasing"] })
    stubPurchaseRequestItemRpcs({ actorId: purchaser.id, purchasing: true })

    const matrix = db.seed("costing_matrices", { opportunity_id: opportunity.id })
    const lineId = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Stretcher", quantity: 1 })
    componentId = await costingMatrixService.addComponent(lineId, { name: "Ambulance Folding Stretcher" })

    request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: purchaser.id })
    db.seed("purchase_request_members", { request_id: request.id, employee_id: purchaser.id, side: "purchasing" })
    plainItem = db.seed("purchase_request_items", { request_id: request.id, name: "Printer paper", quantity: 5, unit: "ream", source: "new", requested_by: purchaser.id })
    componentItem = db.seed("purchase_request_items", { request_id: request.id, name: "Ambulance Folding Stretcher", quantity: 1, source: "component", component_id: componentId, requested_by: purchaser.id })
  })

  it("starts one Canvass on an item that names no Component, once", async () => {
    const first = await canvassService.start({ requestedItemId: plainItem.id }, {}, { supplierName: "Paper Co" }, purchaser.id)
    const second = await canvassService.start({ requestedItemId: plainItem.id }, {}, { supplierName: "Office Hub" }, purchaser.id)
    expect(second.canvassId).toBe(first.canvassId)
    expect(first.number).toBe("CNV_0001")
    expect((await canvassService.getForRequestedItem(plainItem.id)).id).toBe(first.canvassId)
  })

  it("refuses to start one on an item that names a Component", async () => {
    await expect(
      canvassService.start({ requestedItemId: componentItem.id }, {}, { supplierName: "Ferno" }, purchaser.id),
    ).rejects.toMatchObject({ code: "23514" })
    expect(db.rows("sor_canvasses")).toHaveLength(0)
  })

  describe("the Canvassing status", () => {
    const statusOf = (id) => db.rows("purchase_request_items").find((i) => i.id === id).status

    it("moves a To order item to Canvassing when its Canvass opens", async () => {
      const item = db.seed("purchase_request_items", { request_id: request.id, name: "Toner", quantity: 2, source: "new", requested_by: purchaser.id, status: "to_purchase" })
      await seedCanvass({ requestedItemId: item.id }, purchaser.id)
      expect(statusOf(item.id)).toBe("still_canvassing")
    })

    it("moves the To order items that name a Component when the Component's Canvass opens", async () => {
      db.internal.rowsOf("purchase_request_items").find((i) => i.id === componentItem.id).status = "to_purchase"
      const ordered = db.seed("purchase_request_items", { request_id: request.id, name: "Ambulance Folding Stretcher", quantity: 1, source: "component", component_id: componentId, requested_by: purchaser.id, status: "purchased" })
      await seedCanvass({ componentId }, purchaser.id)
      expect(statusOf(componentItem.id)).toBe("still_canvassing")
      expect(statusOf(ordered.id)).toBe("purchased")
    })

    it("leaves an item at any other status alone", async () => {
      expect(statusOf(plainItem.id)).toBe("not_checked")
      await seedCanvass({ requestedItemId: plainItem.id }, purchaser.id)
      expect(statusOf(plainItem.id)).toBe("not_checked")
    })
  })

  it("has no Canvass to show for an item nobody has canvassed", async () => {
    expect(await canvassService.getForRequestedItem(plainItem.id)).toBeNull()
    expect(await canvassService.getForRequestedItem(null)).toBeNull()
  })

  it("writes nothing to the Costing Matrix when a winner is marked on an item's Canvass", async () => {
    const canvass = await seedCanvass({ requestedItemId: plainItem.id }, purchaser.id)
    const offer = await canvassService.addOffer(canvass.id, { supplierName: "Paper Co", description: "A4 ream", unitPrice: 250 }, purchaser.id)

    const result = await canvassService.markWinner(canvass.id, offer.id)
    expect(result.filled).toEqual({ acquire: false, offer_specification: false, documents: false })
    expect(db.rows("costing_component_costs").every((c) => c.acquire_unit == null)).toBe(true)
    expect(db.rows("costing_components").find((c) => c.id === componentId).offer_specification ?? null).toBeNull()
  })

  describe("each Requested Item in the Purchase Request view", () => {
    const itemFor = async (id) => (await purchaseRequestService.listItems(request.id)).find((i) => i.id === id)

    it("shows its own Canvass number and signed state", async () => {
      const canvass = await seedCanvass({ requestedItemId: plainItem.id }, purchaser.id)
      expect((await itemFor(plainItem.id)).canvass).toEqual({ id: canvass.id, number: "CNV_0001", signed: false, viaComponent: false })

      db.internal.rowsOf("sor_canvasses").find((c) => c.id === canvass.id).signed_off_at = "2026-10-19T08:00:00Z"
      expect((await itemFor(plainItem.id)).canvass).toMatchObject({ number: "CNV_0001", signed: true })
    })

    it("shows its Component's Canvass number when it names a Component", async () => {
      const canvass = await seedCanvass({ componentId }, purchaser.id)
      expect((await itemFor(componentItem.id)).canvass).toEqual({ id: canvass.id, number: canvass.number, signed: false, viaComponent: true })
    })

    it("carries no Canvass on an item that has none", async () => {
      expect(await itemFor(plainItem.id)).not.toHaveProperty("canvass")
      expect(await itemFor(componentItem.id)).not.toHaveProperty("canvass")
    })
  })
})
