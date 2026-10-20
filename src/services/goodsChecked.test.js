import { beforeEach, describe, expect, it } from "vitest"
import { opportunityService } from "./opportunityService"
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
import { stubOrderConditionRpcs } from "@/test/stubs/orderConditionRpc"

/**
 * Goods checked (#465) through a real Stage move, against the fake database: the gate reads the
 * SOR's Transmittals through `order_condition_inputs` (re-implemented on the store). Who may call
 * the RPC, and the SQL itself, are the policy tier's (102-goods-checked-orders-filed).
 */
describe("Goods checked", () => {
  let owner, lead, next, dealA, dealB
  let slipSeq = 0

  beforeEach(() => {
    seedPipeline()
    stubActionRunRpcs()
    stubOrderConditionRpcs()
    owner = makeEmployee({ name: "Ben Cruz", department: "SALES" })
    const saleType = makeSaleType({ name: "Flow" })
    const flow = makeSalesFlow({ sale_type_id: saleType.id })
    lead = makeFlowStage({ flow_id: flow.id, name: "Project Delivery", sort_order: 0 })
    next = makeFlowStage({ flow_id: flow.id, name: "Closing", sort_order: 1 })
    makeFlowEdge(lead, next)
    makeStageCondition({ stage_id: lead.id, kind: "goods_checked", label: "Goods checked" })
    const snapshot = makeFlowSnapshot({ flow_id: flow.id })
    const deal = (ref) =>
      makeOpportunity({
        registered_by: owner.id,
        deal_owner_id: owner.id,
        sales_reference: ref,
        sale_type_id: saleType.id,
        flow_stage_id: lead.id,
        flow_snapshot_id: snapshot.id,
      })
    dealA = deal("S00465A")
    dealB = deal("S00465B")
  })

  const slip = (state, sors) => {
    const t = db.seed("transmittals", {
      number: `TG03-${(slipSeq += 1)}`,
      origin: "purchasing",
      priority: "high",
      entity: "T3ck Trading",
      prepared_by: owner.id,
      state,
    })
    sors.forEach((sor, i) =>
      db.seed("transmittal_lines", {
        transmittal_id: t.id,
        position: i + 1,
        kind: "typed",
        description: "Harness",
        quantity: 1,
        opportunity_id: sor.id,
      }),
    )
    return t
  }
  const checklist = async (deal) =>
    (await opportunityService.getStageChecklist(deal.id)).map((row) => [row.condition.kind, row.status, row.detail?.failing])
  const move = (deal) => opportunityService.updateStatus(deal.id, next.id, owner.id)

  it("is met, and lets the move through, for an SOR no Transmittal names", async () => {
    expect(await checklist(dealA)).toEqual([["goods_checked", "satisfied", undefined]])
    expect((await move(dealA)).flow_stage_id).toBe(next.id)
  })

  it("ignores Drafts, Closed and Cancelled slips", async () => {
    slip("draft", [dealA])
    slip("closed", [dealA])
    slip("cancelled", [dealA])
    expect((await checklist(dealA))[0][1]).toBe("satisfied")
  })

  it("blocks the move while a submitted slip is still in its checks", async () => {
    slip("technical_inspection", [dealA])
    expect(await checklist(dealA)).toEqual([["goods_checked", "unsatisfied", ["slips_not_closed"]]])
    await expect(move(dealA)).rejects.toThrow(/Goods checked — 1 Transmittal naming this SOR is not Closed yet/)
  })

  it("counts a slip with lines for two SORs against both, and releases both when it closes", async () => {
    const t = slip("warehouse_checking", [dealA, dealB])
    expect((await checklist(dealA))[0][1]).toBe("unsatisfied")
    expect((await checklist(dealB))[0][1]).toBe("unsatisfied")

    db.internal.rowsOf("transmittals").find((row) => row.id === t.id).state = "closed"
    expect((await checklist(dealA))[0][1]).toBe("satisfied")
    expect((await checklist(dealB))[0][1]).toBe("satisfied")
    expect((await move(dealB)).flow_stage_id).toBe(next.id)
  })

  it("does not count a slip that names only the other SOR", async () => {
    slip("awaiting_check", [dealB])
    expect((await checklist(dealA))[0][1]).toBe("satisfied")
    expect((await checklist(dealB))[0][1]).toBe("unsatisfied")
  })
})
