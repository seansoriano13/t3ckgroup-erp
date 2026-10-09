import { beforeEach, describe, expect, it } from "vitest"
import { opportunityService } from "./opportunityService"
import { purchaseRequestService } from "./purchaseRequestService"
import { db } from "@/test/db/store"
import {
  makeEmployee,
  makeFlowEdge,
  makeFlowSnapshot,
  makeFlowStage,
  makeOpportunity,
  makeSaleType,
  makeSalesFlow,
  makeStageCondition,
  seedPipeline,
} from "@/test/factories"
import { stubActionRunRpcs } from "@/test/stubs/actionRunRpc"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { stubPurchasingSettledRpc } from "@/test/stubs/purchasingSettledRpc"

/**
 * Purchasing settled (#311) through a real Stage move, against the fake
 * database: the gate reads the SOR's Requested Items through
 * `sor_purchase_request_item_states` (re-implemented on the store) and the
 * items close through #306's status RPCs. That a left-out Deal Team member
 * gets the same answer is the policy tier's (42-purchasing-settled-condition).
 */
describe("Purchasing settled", () => {
  let owner, buyer, lead, qualified, snapshot, saleType

  beforeEach(() => {
    seedPipeline()
    stubActionRunRpcs()
    stubPurchasingSettledRpc()
    owner = makeEmployee({ name: "Ben Cruz", department: "SALES" })
    buyer = makeEmployee({ name: "Rey Santos", department: "OPERATIONS", has_purchasing_flow: true })
    saleType = makeSaleType({ name: "Flow" })
    const flow = makeSalesFlow({ sale_type_id: saleType.id })
    lead = makeFlowStage({ flow_id: flow.id, name: "Lead", sort_order: 0 })
    qualified = makeFlowStage({ flow_id: flow.id, name: "Qualified", sort_order: 1 })
    makeFlowEdge(lead, qualified)
    makeStageCondition({ stage_id: lead.id, kind: "purchasing_settled", label: "Purchasing settled" })
    snapshot = makeFlowSnapshot({ flow_id: flow.id })
  })

  const dealOnLead = () =>
    makeOpportunity({
      registered_by: owner.id,
      deal_owner_id: owner.id,
      sales_reference: "S00311",
      sale_type_id: saleType.id,
      flow_stage_id: lead.id,
      flow_snapshot_id: snapshot.id,
    })

  const openRequest = (deal, names) => {
    const request = db.seed("purchase_requests", { opportunity_id: deal.id, created_by: owner.id, buyer_id: buyer.id })
    db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
    return names.map(
      (name) => db.seed("purchase_request_items", { request_id: request.id, source: "new", name, quantity: 1, requested_by: owner.id }).id,
    )
  }

  it("blocks a Stage move until the last item closes", async () => {
    const deal = dealOnLead()
    const [harness, helmet] = openRequest(deal, ["Full Body Harness", "Helmet"])
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })

    await expect(opportunityService.updateStatus(deal.id, qualified.id, owner.id)).rejects.toThrow(/Purchasing settled/)

    await purchaseRequestService.setItemStatus(harness, "from_stock")
    await expect(opportunityService.updateStatus(deal.id, qualified.id, owner.id)).rejects.toThrow(/Purchasing settled/)

    await purchaseRequestService.setItemStatus(helmet, "cannot_source")
    const moved = await opportunityService.updateStatus(deal.id, qualified.id, owner.id)
    expect(moved.flow_stage_id).toBe(qualified.id)
  })

  it("passes on an SOR with no Purchase Request", async () => {
    const deal = dealOnLead()
    const moved = await opportunityService.updateStatus(deal.id, qualified.id, owner.id)
    expect(moved.flow_stage_id).toBe(qualified.id)
  })

  it("shows on the Stage checklist as unmet while an item is open", async () => {
    const deal = dealOnLead()
    openRequest(deal, ["Full Body Harness"])
    const checklist = await opportunityService.getStageChecklist(deal.id)
    expect(checklist.map((row) => [row.condition.kind, row.status])).toEqual([["purchasing_settled", "unsatisfied"]])
  })
})
