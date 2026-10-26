import { beforeEach, describe, expect, it } from "vitest"
import { purchaseRequestService } from "./purchaseRequestService"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"

/**
 * The Requested Item status path (#306) through the service, against the fake
 * database with the RPCs re-implemented on its store. Proves the wiring; the
 * rules themselves are the policy tier's (40-purchase-request-item-status).
 */
describe("purchaseRequestService — item status", () => {
  let salesperson, buyer, request, itemId

  beforeEach(() => {
    salesperson = makeEmployee({ name: "Sales Person", department: "SALES" })
    buyer = makeEmployee({ name: "Buyer", department: "OPERATIONS", has_purchasing_flow: true })
    const opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
    request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id, buyer_id: buyer.id })
    db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
    db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
    itemId = db.seed("purchase_request_items", {
      request_id: request.id,
      source: "new",
      name: "Full Body Harness",
      quantity: 10,
      unit: "pc",
      requested_by: salesperson.id,
    }).id
  })

  it("walks an item along the path and records who moved it", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })
    for (const status of ["to_purchase", "still_canvassing"]) {
      const item = await purchaseRequestService.setItemStatus(itemId, status)
      expect(item).toMatchObject({ id: itemId, status, status_changed_by: buyer.id })
    }
    expect(db.rows("purchase_request_messages").map((m) => m.metadata.to)).toEqual(["to_purchase", "still_canvassing"])
  })

  it("won't set Purchased or Received by hand: a P0 does that", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })
    await purchaseRequestService.setItemStatus(itemId, "to_purchase")
    for (const status of ["purchased", "received"]) {
      await expect(purchaseRequestService.setItemStatus(itemId, status)).rejects.toMatchObject({ code: "42501" })
    }
    expect(db.rows("purchase_request_items")[0].status).toBe("to_purchase")
  })

  it("lets the sales side cancel or choose To purchase, but not set Purchased", async () => {
    stubPurchaseRequestItemRpcs({ actorId: salesperson.id })
    await expect(purchaseRequestService.setItemStatus(itemId, "purchased")).rejects.toMatchObject({ code: "42501" })
    await purchaseRequestService.cancelItem(itemId)
    expect(db.rows("purchase_request_items")[0].status).toBe("cancelled")
  })

  it("reads the caller's side and whether they may substitute", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, canSubstitute: true })
    expect(await purchaseRequestService.itemActor(request.id)).toEqual({ side: "purchasing", canSubstitute: true })
    expect(await purchaseRequestService.itemActor(null)).toEqual({ side: null, canSubstitute: false })
  })
})
