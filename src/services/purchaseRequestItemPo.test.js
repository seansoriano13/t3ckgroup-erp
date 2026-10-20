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
      status: "to_order",
      requested_by: salesperson.id,
    }).id
  })

  it("orders with no PO number, without asking Odoo", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })
    let asked = false
    stubEdgeFunction("odoo-po-verify", () => {
      asked = true
      return { success: true, found: false }
    })
    const updated = await purchaseRequestService.orderItem(itemId, { poNumber: "  " })
    expect(updated).toMatchObject({ status: "ordered", po_number: null })
    expect(asked).toBe(false)
  })

  it("sends the item and PO to the server check, and no verdict", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })
    let asked
    stubEdgeFunction("odoo-po-verify", (body) => {
      asked = body
      return { success: true, verdict: "verified", item: { id: itemId } }
    })
    await purchaseRequestService.orderItem(itemId, { poNumber: "p01234" })
    expect(asked).toEqual({ action: "order", itemId, poNumber: "P01234" })
  })

  it("stores the PO as verified when Odoo has it", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found" })
    const updated = await purchaseRequestService.orderItem(itemId, { poNumber: "p01234" })
    expect(updated).toMatchObject({ status: "ordered", po_number: "P01234", po_verification: "VERIFIED" })
    expect(db.rows("purchase_request_messages")[0].metadata.details).toEqual({
      po_number: "P01234",
      po_verification: "VERIFIED",
    })
  })

  it("refuses a PO Odoo doesn't have, naming it, and saves nothing", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "not_found" })
    await expect(purchaseRequestService.orderItem(itemId, { poNumber: "P01234" })).rejects.toThrow(/P01234/)
    expect(item()).toMatchObject({ status: "to_order", po_number: null })
  })

  it("saves the PO as not checked when Odoo doesn't answer", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "unreachable" })
    const updated = await purchaseRequestService.orderItem(itemId, { poNumber: "P01234" })
    expect(updated).toMatchObject({ status: "ordered", po_number: "P01234", po_verification: "PENDING_VERIFICATION" })
  })

  it("refuses a PO check sent straight to the status move", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })
    await expect(
      purchaseRequestService.setItemStatus(itemId, "ordered", { po_number: "P01234", po_verification: "VERIFIED" }),
    ).rejects.toMatchObject({ code: "42501" })
  })

  it("refuses a number that isn't an Odoo PO before touching anything", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })
    await expect(purchaseRequestService.orderItem(itemId, { poNumber: "PO-12" })).rejects.toThrow(/P01234/)
    expect(item().status).toBe("to_order")
  })

  it("offers no lines and refuses a pick while the PO has no IPAS", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found" })
    await purchaseRequestService.orderItem(itemId, { poNumber: "P01234" })

    expect(await purchaseRequestService.poLines(itemId)).toEqual([])
    await expect(purchaseRequestService.pickPoLines(itemId, [501])).rejects.toMatchObject({ code: "22023" })
  })

  it("picks lines from the PO's IPAS copy once it exists", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, ipasLines: { P01234: [501, 502] }, odoo: "found" })
    await purchaseRequestService.orderItem(itemId, { poNumber: "P01234" })

    expect(await purchaseRequestService.poLines(itemId)).toEqual([501, 502])
    expect(await purchaseRequestService.pickPoLines(itemId, [502])).toMatchObject({ odoo_po_line_ids: [502] })
    await expect(purchaseRequestService.pickPoLines(itemId, [999])).rejects.toMatchObject({ code: "22023" })
  })
})
