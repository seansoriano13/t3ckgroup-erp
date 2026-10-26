import { beforeEach, describe, expect, it } from "vitest"
import { purchaseRequestService } from "./purchaseRequestService"
import { db } from "@/test/db/store"
import { stubEdgeFunction } from "@/test/msw/server"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"

/**
 * The PO number and PO lines on Ordered (#312) through the service, against
 * the fake database with the RPCs re-implemented on its store and Odoo's
 * `odoo-po-verify` stubbed (it can't run locally). Proves the wiring; the
 * rules are the policy tier's (43-purchase-request-item-po).
 */
describe("purchaseRequestService — PO on Ordered", () => {
  let salesperson, buyer, request, itemId
  const item = () => db.rows("purchase_request_items").find((r) => r.id === itemId)

  beforeEach(() => {
    salesperson = makeEmployee({ name: "Sales Person", department: "SALES" })
    buyer = makeEmployee({ name: "Buyer", department: "OPERATIONS", has_purchasing_flow: true })
    const opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
    request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id, buyer_id: buyer.id })
    db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
    itemId = db.seed("purchase_request_items", {
      request_id: request.id,
      source: "new",
      name: "Full Body Harness",
      quantity: 10,
      status: "to_purchase",
      requested_by: salesperson.id,
    }).id
  })

  it("sends the item and P0 to the server, and no verdict or facts", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })
    let asked
    stubEdgeFunction("odoo-po-verify", (body) => {
      asked = body
      return { success: true, verdict: "verified", item: { id: itemId } }
    })
    await purchaseRequestService.attachP0(itemId, "p01234")
    expect(asked).toEqual({ action: "attach", itemId, poNumber: "P01234" })
  })

  it("makes the line Purchased from a confirmed P0 and keeps what was bought", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found", p0s: { P01234: { bought_as: "Harness XL" } } })
    const updated = await purchaseRequestService.attachP0(itemId, "p01234")
    expect(updated).toMatchObject({ status: "purchased", po_number: "P01234", po_verification: "VERIFIED", bought_as: "Harness XL" })
  })

  it("keeps an RFQ at To purchase", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found", p0s: { P01234: { state: "rfq" } } })
    expect(await purchaseRequestService.attachP0(itemId, "P01234")).toMatchObject({ status: "to_purchase", po_state: "rfq" })
  })

  it("makes the line Received when everything arrived", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found", p0s: { P01234: { ordered: 10, received: 10 } } })
    expect(await purchaseRequestService.attachP0(itemId, "P01234")).toMatchObject({ status: "received" })
  })

  it("refuses a P0 Odoo doesn't have, naming it, and saves nothing", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "not_found" })
    await expect(purchaseRequestService.attachP0(itemId, "P01234")).rejects.toThrow(/P01234/)
    expect(item()).toMatchObject({ status: "to_purchase", po_number: null })
  })

  it("attaches nothing when Odoo doesn't answer", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "unreachable" })
    await expect(purchaseRequestService.attachP0(itemId, "P01234")).rejects.toThrow(/not attached/)
    expect(item()).toMatchObject({ status: "to_purchase", po_number: null })
  })

  it("refuses a PO check sent straight to the status move", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })
    await expect(
      purchaseRequestService.setItemStatus(itemId, "purchased", { po_number: "P01234", po_verification: "VERIFIED" }),
    ).rejects.toMatchObject({ code: "42501" })
  })

  it("refuses a number that isn't an Odoo P0 before touching anything", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })
    await expect(purchaseRequestService.attachP0(itemId, "PO-12")).rejects.toThrow(/P01234/)
    expect(item().status).toBe("to_purchase")
  })

  it("reads the suggested and other P0s", async () => {
    let asked
    stubEdgeFunction("odoo-po-suggest", (body) => {
      asked = body
      return { success: true, suggested: [{ name: "P1" }], others: [{ name: "P2" }] }
    })
    expect(await purchaseRequestService.suggestP0s({ reference: "S01237", productId: 7 })).toEqual({ suggested: [{ name: "P1" }], others: [{ name: "P2" }] })
    expect(asked).toEqual({ reference: "S01237", productId: 7 })
  })

  it("throws when Odoo didn't answer, so an outage never reads as no P0s", async () => {
    stubEdgeFunction("odoo-po-suggest", () => ({ success: false, message: "Odoo is down." }))
    await expect(purchaseRequestService.suggestP0s({ reference: "S01237" })).rejects.toThrow(/Odoo is down/)
  })

  it("offers no lines and refuses a pick while the PO has no IPAS", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found" })
    await purchaseRequestService.attachP0(itemId, "P01234")

    expect(await purchaseRequestService.poLines(itemId)).toEqual([])
    await expect(purchaseRequestService.pickPoLines(itemId, [501])).rejects.toMatchObject({ code: "22023" })
  })

  it("picks lines from the PO's IPAS copy once it exists", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, ipasLines: { P01234: [501, 502] }, odoo: "found" })
    await purchaseRequestService.attachP0(itemId, "P01234")

    expect(await purchaseRequestService.poLines(itemId)).toEqual([501, 502])
    expect(await purchaseRequestService.pickPoLines(itemId, [502])).toMatchObject({ odoo_po_line_ids: [502] })
    await expect(purchaseRequestService.pickPoLines(itemId, [999])).rejects.toMatchObject({ code: "22023" })
  })
})
