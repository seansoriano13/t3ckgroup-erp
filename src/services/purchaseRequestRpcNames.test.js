import { beforeEach, describe, expect, it } from "vitest"
import { purchaseRequestService } from "./purchaseRequestService"
import { stubRpc } from "@/test/msw/server"

/**
 * #506: every purchasing RPC answers to a `purchase_request_` name. The
 * database keeps the old `pr_*` names as aliases for an older frontend; this
 * one calls only the new names. An unstubbed RPC answers 404, so a service
 * method still calling a `pr_*` name fails here.
 */
describe("purchaseRequestService — RPC names", () => {
  let sent

  const RENAMED = {
    purchase_request_queue: [],
    purchase_request_actor_side: "purchasing",
    purchase_request_can_add_substitute: true,
    purchase_request_set_item_status: { id: "item-1" },
    purchase_request_item_po_lines: [7],
    purchase_request_pick_po_lines: { id: "item-1" },
    purchase_request_add_substitute: "item-2",
    purchase_request_take: { id: "r1" },
    purchase_request_set_buyer: { id: "r1" },
  }

  beforeEach(() => {
    sent = []
    for (const [name, result] of Object.entries(RENAMED)) {
      stubRpc(name, () => {
        sent.push(name)
        return result
      })
    }
  })

  it("calls the queue, status, PO line, substitute and Buyer RPCs by their purchase_request_ names", async () => {
    await purchaseRequestService.listQueue()
    await purchaseRequestService.get("r1")
    await purchaseRequestService.itemActor("r1")
    await purchaseRequestService.setItemStatus("item-1", "to_order")
    await purchaseRequestService.cancelItem("item-1")
    await purchaseRequestService.poLines("item-1")
    await purchaseRequestService.pickPoLines("item-1", [7])
    await purchaseRequestService.addSubstitute("item-1", { name: "Other brand", quantity: 1 })
    await purchaseRequestService.take("r1")
    await purchaseRequestService.setBuyer("r1", null)

    expect(new Set(sent)).toEqual(new Set(Object.keys(RENAMED)))
  })
})
