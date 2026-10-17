import { describe, expect, it } from "vitest"

import { CONDITION_KINDS, CONDITION_STATUS, evaluateCondition, NEW_CONDITION_KINDS } from "@/constants/stageGate"
import { COSTING_SETTLED_CHECKS, costingSettled } from "./costingMath"
import { describeFailing, evaluateCostingCondition } from "./costingConditions"

// What costing_condition_inputs returns for a matrix that is ready to bid.
const ready = {
  has_matrix: true,
  line_count: 2,
  missing_offer: 0,
  over_abc: false,
  costed_rows: 3,
  missing_cost: 0,
  evaluation_approved: true,
  bid_verdict: "go",
}

describe("costingSettled (#272)", () => {
  it("is met when every check passes", () => {
    expect(costingSettled(ready)).toEqual({ met: true, failing: [] })
  })

  it.each([
    ["missing_final_offer", { missing_offer: 1 }],
    ["incomplete_summary", { missing_cost: 2 }],
    ["incomplete_summary", { costed_rows: 0 }],
    ["evaluation_not_approved", { evaluation_approved: false }],
    ["over_abc", { over_abc: true }],
    ["bid_not_go", { bid_verdict: null }],
    ["bid_not_go", { bid_verdict: "no_go" }],
    ["bid_not_go", { bid_verdict: "revise" }],
  ])("fails %s alone", (check, change) => {
    expect(costingSettled({ ...ready, ...change })).toEqual({ met: false, failing: [check] })
  })

  it("fails with no Tender Lines, on that check alone", () => {
    expect(costingSettled({ ...ready, line_count: 0, missing_offer: 0 })).toEqual({
      met: false,
      failing: ["no_tender_lines"],
    })
  })

  it("fails with no matrix, on that check alone", () => {
    expect(costingSettled({ has_matrix: false })).toEqual({ met: false, failing: ["no_matrix"] })
    expect(costingSettled(null)).toEqual({ met: false, failing: ["no_matrix"] })
  })

  it("lists every failing check together, in order", () => {
    const result = costingSettled({
      has_matrix: true,
      line_count: 2,
      missing_offer: 2,
      over_abc: true,
      costed_rows: 1,
      missing_cost: 1,
      evaluation_approved: false,
      bid_verdict: null,
    })
    expect(result.met).toBe(false)
    expect(result.failing).toEqual([
      "missing_final_offer",
      "incomplete_summary",
      "evaluation_not_approved",
      "over_abc",
      "bid_not_go",
    ])
    expect(COSTING_SETTLED_CHECKS).toEqual(expect.arrayContaining(result.failing))
  })

  it("fails closed on evidence it cannot read", () => {
    expect(costingSettled({ has_matrix: true }).met).toBe(false)
  })
})

describe("the shared costing evaluator", () => {
  it("words each failing check in plain sentences", () => {
    expect(describeFailing(["missing_final_offer"], { ...ready, missing_offer: 1 })).toEqual([
      "1 Tender Line has no Final Offer.",
    ])
    expect(describeFailing(["missing_final_offer"], { ...ready, missing_offer: 3 })).toEqual([
      "3 Tender Lines have no Final Offer.",
    ])
    expect(describeFailing(["bid_not_go"], { ...ready, bid_verdict: "revise" })).toEqual(["The Bid Decision is Revise."])
    expect(describeFailing(["bid_not_go"], { ...ready, bid_verdict: null })).toEqual(["There is no Bid Decision yet."])
  })

  it("fails closed when nobody loaded the evidence", () => {
    const result = evaluateCostingCondition("costing_settled", undefined)
    expect(result.met).toBe(false)
    expect(result.messages).toEqual(["The Costing Matrix could not be checked."])
  })
})

describe("evaluateCondition — costing_settled kind (#272)", () => {
  const condition = { id: "c1", kind: CONDITION_KINDS.COSTING_SETTLED, label: "Costing settled", config: {} }

  it("is offered for a new condition", () => {
    expect(NEW_CONDITION_KINDS).toContain("costing_settled")
  })

  it("is satisfied when the matrix is ready", () => {
    expect(evaluateCondition(condition, { costingInputs: ready }).status).toBe(CONDITION_STATUS.SATISFIED)
  })

  it("is unsatisfied and carries the failing checks as detail", () => {
    const result = evaluateCondition(condition, { costingInputs: { ...ready, evaluation_approved: false, over_abc: true } })
    expect(result.status).toBe(CONDITION_STATUS.UNSATISFIED)
    expect(result.detail.failing).toEqual(["evaluation_not_approved", "over_abc"])
    expect(result.detail.messages).toEqual([
      "The Evaluation of Specification is not approved.",
      "The Final Offer total is over the ABC total.",
    ])
  })

  it("is unsatisfied with no matrix", () => {
    const result = evaluateCondition(condition, { costingInputs: { has_matrix: false } })
    expect(result.status).toBe(CONDITION_STATUS.UNSATISFIED)
    expect(result.detail.failing).toEqual(["no_matrix"])
  })

  it("fails closed when nobody loaded the evidence", () => {
    expect(evaluateCondition(condition).status).toBe(CONDITION_STATUS.UNSATISFIED)
  })
})
