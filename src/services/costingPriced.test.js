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
import { stubCostingConditionRpcs } from "@/test/stubs/costingConditionRpc"

/**
 * Costing priced (#463) through a real Stage move, against the fake database: the gate reads the
 * matrix through `costing_condition_inputs` (re-implemented on the store). Who may call the RPC
 * is the policy tier's (87-costing-priced-condition).
 */
describe("Costing priced", () => {
  let owner, buyer, lead, qualified, deal, matrix, line

  beforeEach(() => {
    seedPipeline()
    stubActionRunRpcs()
    stubCostingConditionRpcs()
    owner = makeEmployee({ name: "Ben Cruz", department: "SALES" })
    buyer = makeEmployee({ name: "Pia Reyes", department: "PURCHASING" })
    const saleType = makeSaleType({ name: "Flow" })
    const flow = makeSalesFlow({ sale_type_id: saleType.id })
    lead = makeFlowStage({ flow_id: flow.id, name: "PMS Sourcing", sort_order: 0 })
    qualified = makeFlowStage({ flow_id: flow.id, name: "Pricing", sort_order: 1 })
    makeFlowEdge(lead, qualified)
    makeStageCondition({ stage_id: lead.id, kind: "costing_priced", label: "Costing priced" })
    const snapshot = makeFlowSnapshot({ flow_id: flow.id })
    deal = makeOpportunity({
      registered_by: owner.id,
      deal_owner_id: owner.id,
      sales_reference: "S00463",
      sale_type_id: saleType.id,
      flow_stage_id: lead.id,
      flow_snapshot_id: snapshot.id,
    })
  })

  const openMatrix = (extra = {}) => {
    matrix = db.seed("costing_matrices", { opportunity_id: deal.id, ...extra })
    line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Harness", quantity: 2 })
    return matrix
  }
  const component = (acquire) => {
    const c = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Harness", offer_specification: "Full body", is_bundle: true })
    db.seed("costing_component_costs", { component_id: c.id, acquire_unit: acquire })
    return c
  }
  const checklist = async () => (await opportunityService.getStageChecklist(deal.id)).map((row) => [row.condition.kind, row.status, row.detail?.failing])
  const move = () => opportunityService.updateStatus(deal.id, qualified.id, owner.id)

  it("is unmet, and blocks the move, with no Costing Matrix", async () => {
    expect(await checklist()).toEqual([["costing_priced", "unsatisfied", ["no_matrix"]]])
    await expect(move()).rejects.toThrow(/Costing priced — No Costing Matrix/)
  })

  it("blocks a move until the last check passes, then lets it through", async () => {
    openMatrix()
    expect((await checklist())[0][2]).toEqual(["no_components", "no_purchasing_incharge"])
    await expect(move()).rejects.toThrow(/Costing priced/)

    const c = component(null)
    expect((await checklist())[0][2]).toEqual(["missing_acquire", "no_purchasing_incharge"])

    db.internal.rowsOf("costing_component_costs").find((k) => k.component_id === c.id).acquire_unit = 450
    expect((await checklist())[0][2]).toEqual(["no_purchasing_incharge"])
    await expect(move()).rejects.toThrow(/Purchasing Incharge/)

    db.internal.rowsOf("costing_matrices").find((m) => m.id === matrix.id).purchasing_incharge_id = buyer.id
    expect(await checklist()).toEqual([["costing_priced", "satisfied", undefined]])
    const moved = await move()
    expect(moved.flow_stage_id).toBe(qualified.id)
  })

  it("counts a cost-only row without Acquire, and ignores Inclusions", async () => {
    openMatrix({ purchasing_incharge_id: buyer.id })
    const c = component(450)
    db.seed("costing_inclusions", { component_id: c.id, position: 1, description: "Lanyard" })
    expect((await checklist())[0][1]).toBe("satisfied")

    const row = db.seed("costing_cost_rows", { matrix_id: matrix.id, position: 1, description: "Freight", acquire_unit: null })
    expect(await checklist()).toEqual([["costing_priced", "unsatisfied", ["missing_acquire"]]])

    db.internal.rowsOf("costing_cost_rows").find((r) => r.id === row.id).acquire_unit = 120
    expect((await checklist())[0][1]).toBe("satisfied")
  })

  it("does not wait for Final Acquire, Final Offers, the evaluation or a Bid Decision", async () => {
    openMatrix({ purchasing_incharge_id: buyer.id })
    component(450)
    const moved = await move()
    expect(moved.flow_stage_id).toBe(qualified.id)
    expect(db.internal.rowsOf("costing_matrices").find((m) => m.id === matrix.id).bid_submitted_at ?? null).toBeNull()
  })
})
