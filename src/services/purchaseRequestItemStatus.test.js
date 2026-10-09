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
    for (const status of ["to_order", "canvassing", "ordered", "received"]) {
      const item = await purchaseRequestService.setItemStatus(itemId, status)
      expect(item).toMatchObject({ id: itemId, status, status_changed_by: buyer.id })
    }
    expect(db.rows("purchase_request_messages").map((m) => m.metadata.to)).toEqual([
      "to_order",
      "canvassing",
      "ordered",
      "received",
    ])
  })

  it("lets the sales side cancel but not set Ordered", async () => {
    stubPurchaseRequestItemRpcs({ actorId: salesperson.id })
    await expect(purchaseRequestService.setItemStatus(itemId, "to_order")).rejects.toMatchObject({ code: "42501" })
    await purchaseRequestService.cancelItem(itemId)
    expect(db.rows("purchase_request_items")[0].status).toBe("cancelled")
  })

  it("adds the Buyer's substitute and moves the original to Substituted", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, canSubstitute: true })
    const id = await purchaseRequestService.addSubstitute(itemId, { name: "Harness, other brand", quantity: "10", unit: "pc" })

    const rows = db.rows("purchase_request_items")
    expect(rows.find((r) => r.id === id)).toMatchObject({ substitute_for_item_id: itemId, status: "requested", quantity: 10 })
    expect(rows.find((r) => r.id === itemId).status).toBe("substituted")
  })

  it("reads the caller's side and whether they may substitute", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, canSubstitute: true })
    expect(await purchaseRequestService.itemActor(request.id)).toEqual({ side: "purchasing", canSubstitute: true })
    expect(await purchaseRequestService.itemActor(null)).toEqual({ side: null, canSubstitute: false })
  })
})
