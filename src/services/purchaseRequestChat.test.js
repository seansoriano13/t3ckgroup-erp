import { beforeEach, describe, expect, it } from "vitest"
import { purchaseRequestService } from "./purchaseRequestService"
import { db } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"
import { stubRpc } from "@/test/msw/server"
import { makeEmployee, makeOpportunity } from "@/test/factories"

/**
 * The request's Chat and Buyer (#307) through the service, against the fake
 * database. Proves the wiring; who may post, Take or name the Buyer, and who
 * is notified, are the policy tier's (41-purchase-request-chat-and-buyer).
 */
describe("purchaseRequestService — chat and Buyer", () => {
  let salesperson, buyer, request

  beforeEach(() => {
    salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
    buyer = makeEmployee({ name: "Ben Cruz", department: "OPERATIONS", has_purchasing_flow: true })
    const opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
    request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id })
    db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
    db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
  })

  it("posts a message, keeping only the mentions still named in the text", async () => {
    const posted = await purchaseRequestService.postMessage(request.id, salesperson.id, "  @Ben Cruz can you quote this?  ", {
      mentions: [
        { id: buyer.id, name: "Ben Cruz" },
        { id: salesperson.id, name: "Ana Reyes" },
      ],
      attachments: [{ url: "https://cdn.example/spec.pdf", name: "spec.pdf" }, { name: "never uploaded" }],
    })

    expect(posted.author).toMatchObject({ id: salesperson.id, name: "Ana Reyes" })
    expect(db.rows("purchase_request_messages")).toEqual([
      expect.objectContaining({
        request_id: request.id,
        author_id: salesperson.id,
        content: "@Ben Cruz can you quote this?",
        metadata: {
          mentions: [{ id: buyer.id, name: "Ben Cruz" }],
          attachments: [{ url: "https://cdn.example/spec.pdf", name: "spec.pdf" }],
        },
      }),
    ])
  })

  it("refuses an empty message", async () => {
    await expect(purchaseRequestService.postMessage(request.id, salesperson.id, "   ")).rejects.toThrow(/Write a message/)
    expect(db.rows("purchase_request_messages")).toEqual([])
  })

  it("reads the thread oldest first, with authors, and the members by name", async () => {
    db.seed("purchase_request_messages", {
      request_id: request.id, author_id: null, content: "Purchase Request opened.", metadata: { event: "opened" },
      created_at: "2026-10-01T00:00:00Z",
    })
    db.seed("purchase_request_messages", {
      request_id: request.id, author_id: buyer.id, content: "On it.", created_at: "2026-10-02T00:00:00Z",
    })

    const messages = await purchaseRequestService.listMessages(request.id)
    expect(messages.map((m) => [m.content, m.author?.name ?? null])).toEqual([
      ["Purchase Request opened.", null],
      ["On it.", "Ben Cruz"],
    ])
    expect((await purchaseRequestService.listMembers(request.id)).map((m) => [m.name, m.side])).toEqual([
      ["Ana Reyes", "sales"],
      ["Ben Cruz", "purchasing"],
    ])
  })

  it("Takes and names the Buyer through the RPCs", async () => {
    const calls = []
    stubRpc("purchase_request_take", (args) => {
      calls.push(["purchase_request_take", args])
      return { ...request, buyer_id: buyer.id }
    })
    stubRpc("purchase_request_set_buyer", (args) => {
      calls.push(["purchase_request_set_buyer", args])
      return { ...request, buyer_id: args.p_employee_id }
    })

    expect((await purchaseRequestService.take(request.id)).buyer_id).toBe(buyer.id)
    expect((await purchaseRequestService.setBuyer(request.id, null)).buyer_id).toBeNull()
    expect(calls).toEqual([
      ["purchase_request_take", { p_request_id: request.id }],
      ["purchase_request_set_buyer", { p_request_id: request.id, p_employee_id: null }],
    ])
  })

  it("surfaces a Take someone else won", async () => {
    stubRpc("purchase_request_take", () => {
      throw pgrstError("55000", "purchase_request_take: Ben Cruz is already the Buyer")
    })
    await expect(purchaseRequestService.take(request.id)).rejects.toMatchObject({ code: "55000" })
  })
})
