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
 * Orders filed (#466) through a real Stage move, against the fake database: the gate reads the
 * SOR's IPAS through `order_condition_inputs` (re-implemented on the store). The SQL and who may
 * call it are the policy tier's (102-goods-checked-orders-filed).
 */
describe("Orders filed", () => {
  let owner, lead, next, dealA, dealB
  let ipasSeq = 0

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
    makeStageCondition({ stage_id: lead.id, kind: "orders_filed", label: "Orders filed" })
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
    dealA = deal("S00466A")
    dealB = deal("S00466B")
  })

  const ipas = (state, sors) => {
    const n = (ipasSeq += 1)
    const row = db.seed("ipas", {
      number: `IPAS_${n}`,
      po_number: `P9${n}`,
      priority: "high",
      source: "local",
      purpose: "project",
      odoo_copy: {},
      state,
    })
    sors.forEach((sor) => db.seed("ipas_sors", { ipas_id: row.id, opportunity_id: sor.id }))
    return row
  }
  const checklist = async (deal) =>
    (await opportunityService.getStageChecklist(deal.id)).map((row) => [row.condition.kind, row.status, row.detail?.failing])
  const move = (deal) => opportunityService.updateStatus(deal.id, next.id, owner.id)

  const basis = async (deal) => (await opportunityService.getStageChecklist(deal.id))[0].detail?.basis

  it("is unmet, and blocks the move, for an SOR no IPAS names: nothing is ticked without a basis", async () => {
    expect(await checklist(dealA)).toEqual([["orders_filed", "unsatisfied", ["no_orders"]]])
    await expect(move(dealA)).rejects.toThrow(/Orders filed — No IPAS names this SOR yet/)
  })

  it("does not take a cancelled IPAS as a basis, and is met once a filed IPAS names the SOR", async () => {
    ipas("cancelled", [dealA])
    expect((await checklist(dealA))[0][2]).toEqual(["no_orders"])
    ipas("filed", [dealA])
    expect((await checklist(dealA))[0][1]).toBe("satisfied")
    expect((await move(dealA)).flow_stage_id).toBe(next.id)
  })

  it("names each IPAS it read, with its state, met or not", async () => {
    const filed = ipas("filed", [dealA])
    const open = ipas("open", [dealA])
    expect(await basis(dealA)).toEqual([
      { number: filed.number, state: "Filed" },
      { number: open.number, state: "Open" },
    ])
  })

  it("blocks the move while an uncancelled IPAS is unfiled, naming it", async () => {
    ipas("open", [dealA])
    expect(await checklist(dealA)).toEqual([["orders_filed", "unsatisfied", ["orders_not_filed"]]])
    await expect(move(dealA)).rejects.toThrow(/Orders filed — 1 IPAS naming this SOR is not filed yet/)
  })

  it("counts an IPAS naming several SORs for each, and releases each when it is filed", async () => {
    const row = ipas("open", [dealA, dealB])
    expect((await checklist(dealA))[0][1]).toBe("unsatisfied")
    expect((await checklist(dealB))[0][1]).toBe("unsatisfied")

    db.internal.rowsOf("ipas").find((r) => r.id === row.id).state = "filed"
    expect((await checklist(dealA))[0][1]).toBe("satisfied")
    expect((await move(dealB)).flow_stage_id).toBe(next.id)
  })

  it("does not count an IPAS that names only the other SOR", async () => {
    ipas("open", [dealB])
    expect((await checklist(dealA))[0][2]).toEqual(["no_orders"])
    expect((await checklist(dealB))[0][2]).toEqual(["orders_not_filed"])
  })
})
