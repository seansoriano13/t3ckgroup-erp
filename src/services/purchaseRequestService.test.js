import { describe, it, expect } from "vitest"
import { stubRpc } from "@/test/msw/server"
import { purchaseRequestService } from "./purchaseRequestService"

/**
 * Members join and leave a live Purchase Request through two RPCs; the
 * database decides who may and what side and window a new member gets.
 */
describe("purchaseRequestService", () => {
  it("adds a member through the RPC", async () => {
    let sent
    stubRpc("purchase_request_add_member", (args) => {
      sent = args
      return null
    })

    await purchaseRequestService.addMember("r1", "e1")

    expect(sent).toEqual({ p_request_id: "r1", p_employee_id: "e1" })
  })

  it("removes a member through the RPC", async () => {
    let sent
    stubRpc("purchase_request_remove_member", (args) => {
      sent = args
      return null
    })

    await purchaseRequestService.removeMember("r1", "e1")

    expect(sent).toEqual({ p_request_id: "r1", p_employee_id: "e1" })
  })

  it("surfaces the database's refusal", async () => {
    stubRpc("purchase_request_add_member", () => {
      throw Object.assign(new Error("purchase_request_add_member: not allowed"), { code: "42501" })
    })

    await expect(purchaseRequestService.addMember("r1", "e1")).rejects.toThrow(
      "purchase_request_add_member: not allowed",
    )
  })
})
