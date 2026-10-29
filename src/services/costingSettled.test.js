import { beforeEach, describe, expect, it } from "vitest"
import { opportunityService } from "./opportunityService"
import { supabase } from "@/lib/supabase"
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
 * Costing settled (#272) through a real Stage move, against the fake database: the gate reads the
 * matrix through `costing_condition_inputs` (re-implemented on the store) and the matrix is
 * edited the way the grid edits it. Who may call the RPC, and the real triggers, are the policy
 * tier's (86-costing-settled-condition).
 */
describe("Costing settled", () => {
  let owner, boss, lead, qualified, snapshot, saleType, deal, matrix, line

  beforeEach(() => {
    seedPipeline()
    stubActionRunRpcs()
    stubCostingConditionRpcs()
    owner = makeEmployee({ name: "Ben Cruz", department: "SALES" })
    boss = makeEmployee({ name: "Dina Lim", department: "MANAGEMENT" })
    saleType = makeSaleType({ name: "Flow" })
    const flow = makeSalesFlow({ sale_type_id: saleType.id })
    lead = makeFlowStage({ flow_id: flow.id, name: "Bidding", sort_order: 0 })
    qualified = makeFlowStage({ flow_id: flow.id, name: "Submitted", sort_order: 1 })
    makeFlowEdge(lead, qualified)
    makeStageCondition({ stage_id: lead.id, kind: "costing_settled", label: "Costing settled" })
    snapshot = makeFlowSnapshot({ flow_id: flow.id })
    deal = makeOpportunity({
      registered_by: owner.id,
      deal_owner_id: owner.id,
      sales_reference: "S00272",
      sale_type_id: saleType.id,
      flow_stage_id: lead.id,
      flow_snapshot_id: snapshot.id,
    })
  })

  const openMatrix = () => {
    matrix = db.seed("costing_matrices", { opportunity_id: deal.id })
    line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Harness", quantity: 2 })
    return matrix
  }
  const prices = (abc, offer) => db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: abc, final_offer_unit: offer })
  const costed = (cost = { acquire_unit: 400 }) => {
    const component = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Harness", offer_specification: "Full body" })
    db.seed("costing_component_costs", { component_id: component.id, ...cost })
    return component
  }
  const approve = () =>
    db.seed("costing_signoffs", { matrix_id: matrix.id, role: "evaluation_approved", signed_by: boss.id })
  const decide = (verdict) =>
    db.seed("costing_bid_decisions", {
      matrix_id: matrix.id,
      verdict,
      reason: "Margin is fine",
      decided_by: boss.id,
      final_offer_total: 1000,
      abc_total: 1000,
    })
  const checklist = async () => (await opportunityService.getStageChecklist(deal.id)).map((row) => [row.condition.kind, row.status, row.detail?.failing])
  const move = () => opportunityService.updateStatus(deal.id, qualified.id, owner.id)

  it("is unmet, and blocks the move, with no S0 Evaluation", async () => {
    expect(await checklist()).toEqual([["costing_settled", "unsatisfied", ["no_matrix"]]])
    await expect(move()).rejects.toThrow(/Costing settled — No S0 Evaluation/)
  })

  it("blocks a move until the last check passes", async () => {
    openMatrix()
    await expect(move()).rejects.toThrow(/no Tender Lines|Final Offer/)

    prices(1000, 900)
    expect((await checklist())[0][2]).toEqual(["incomplete_summary", "evaluation_not_approved", "bid_not_go"])
    await expect(move()).rejects.toThrow(/Costing settled/)

    costed()
    expect((await checklist())[0][2]).toEqual(["evaluation_not_approved", "bid_not_go"])

    approve()
    expect((await checklist())[0][2]).toEqual(["bid_not_go"])
    await expect(move()).rejects.toThrow(/Bid Decision/)

    decide("go")
    expect(await checklist()).toEqual([["costing_settled", "satisfied", undefined]])
    const moved = await move()
    expect(moved.flow_stage_id).toBe(qualified.id)
  })

  it("still counts an old deal's Final Acquire as its cost", async () => {
    openMatrix()
    prices(1000, 900)
    costed({ final_acquire_unit: 400 })
    approve()
    decide("go")
    expect(await checklist()).toEqual([["costing_settled", "satisfied", undefined]])
  })

  it("is unmet again when an Offer Specification edit clears the approval", async () => {
    openMatrix()
    prices(1000, 900)
    const component = costed()
    approve()
    decide("go")
    expect((await checklist())[0][1]).toBe("satisfied")

    const { error } = await supabase.from("costing_components").update({ offer_specification: "Half body" }).eq("id", component.id)
    expect(error).toBeNull()

    expect(await checklist()).toEqual([["costing_settled", "unsatisfied", ["evaluation_not_approved"]]])
    await expect(move()).rejects.toThrow(/Evaluation of Specification is not approved/)
  })

  it("fails when the Final Offer total is one centavo over the ABC total", async () => {
    openMatrix()
    prices(1000, 1000.01) // 2 x 1,000.01 = 2,000.02 against 2,000.00
    costed()
    approve()
    decide("go")
    expect(await checklist()).toEqual([["costing_settled", "unsatisfied", ["over_abc"]]])

    await supabase.from("costing_tender_line_prices").update({ final_offer_unit: 1000 }).eq("tender_line_id", line.id)
    expect((await checklist())[0][1]).toBe("satisfied")
  })

  describe("bid submitted", () => {
    const ready = () => {
      openMatrix()
      prices(1000, 900)
      costed()
      approve()
      decide("go")
    }
    const timeline = () =>
      db.internal.rowsOf("sales_opportunity_logs").filter((l) => l.metadata?.event === "COSTING_FINAL_OFFER_CHANGED")

    it("is stamped when the SOR leaves through a met Costing settled", async () => {
      ready()
      expect(matrix.bid_submitted_at ?? null).toBeNull()
      await move()
      expect(db.internal.rowsOf("costing_matrices").find((m) => m.id === matrix.id).bid_submitted_at).toBeTruthy()
    })

    it("is not stamped by a refused move", async () => {
      openMatrix()
      await expect(move()).rejects.toThrow()
      expect(db.internal.rowsOf("costing_matrices").find((m) => m.id === matrix.id).bid_submitted_at ?? null).toBeNull()
    })

    it("tells the timeline about a Final Offer change after the bid was submitted", async () => {
      ready()
      await move()
      await supabase.from("costing_tender_line_prices").update({ final_offer_unit: 950 }).eq("tender_line_id", line.id)
      const entries = timeline()
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        opportunity_id: deal.id,
        type: "SYSTEM",
        content: "Final Offer changed on Tender Line 1 after the bid was submitted.",
      })
      expect(entries[0].content).not.toMatch(/950|900/)
    })

    it("says nothing about a Final Offer change before the bid was submitted", async () => {
      ready()
      await supabase.from("costing_tender_line_prices").update({ final_offer_unit: 950 }).eq("tender_line_id", line.id)
      expect(timeline()).toHaveLength(0)
    })
  })
})
