import { describe, expect, it } from "vitest"

import { CONDITION_KINDS, CONDITION_STATUS, evaluateCondition, NEW_CONDITION_KINDS } from "@/constants/stageGate"
import { COSTING_PRICED_CHECKS, COSTING_SETTLED_CHECKS, costingPriced, costingSettled } from "./costingMath"
import { describeFailing, evaluateCostingCondition, isCostingKind } from "./costingConditions"

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

  it("fails closed on a count that is null or absent (blank is never zero)", () => {
    for (const key of ["missing_offer", "missing_cost"]) {
      expect(costingSettled({ ...ready, [key]: null }).met, `${key} null`).toBe(false)
      const { [key]: _gone, ...without } = ready
      expect(costingSettled(without).met, `${key} absent`).toBe(false)
    }
    expect(costingSettled({ ...ready, missing_offer: null }).failing).toEqual(["missing_final_offer"])
    expect(costingSettled({ ...ready, missing_cost: undefined }).failing).toEqual(["incomplete_summary"])
  })

  it("takes the database's word for a caller sent no settled evidence (settled_met only)", () => {
    expect(costingSettled({ has_matrix: true, settled_met: true })).toEqual({ met: true, failing: [] })
    expect(costingSettled({ has_matrix: true, settled_met: false })).toEqual({ met: false, failing: ["not_settled"] })
    expect(costingSettled({ has_matrix: true, settled_met: null }).met).toBe(false)
    expect(COSTING_SETTLED_CHECKS).toContain("not_settled")
    expect(describeFailing(["not_settled"], { has_matrix: true, settled_met: false })).toEqual(["Costing not settled."])
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

// What costing_condition_inputs returns for a matrix Purchasing has fully costed (#463).
const priced = { has_matrix: true, component_count: 2, missing_acquire: 0, has_purchasing_incharge: true }

describe("costingPriced (#463)", () => {
  it("is met when a Component exists, every row has Acquire and an Incharge is named", () => {
    expect(costingPriced(priced)).toEqual({ met: true, failing: [] })
  })

  it.each([
    ["no_components", { component_count: 0 }],
    ["missing_acquire", { missing_acquire: 1 }],
    ["no_purchasing_incharge", { has_purchasing_incharge: false }],
  ])("fails %s alone", (check, change) => {
    expect(costingPriced({ ...priced, ...change })).toEqual({ met: false, failing: [check] })
  })

  it("fails with no matrix, on that check alone", () => {
    expect(costingPriced({ has_matrix: false })).toEqual({ met: false, failing: ["no_matrix"] })
    expect(costingPriced(null)).toEqual({ met: false, failing: ["no_matrix"] })
  })

  it("lists every failing check together, in order", () => {
    const result = costingPriced({ has_matrix: true, component_count: 0, missing_acquire: 1, has_purchasing_incharge: false })
    expect(result.failing).toEqual(["no_components", "missing_acquire", "no_purchasing_incharge"])
    expect(COSTING_PRICED_CHECKS).toEqual(expect.arrayContaining(result.failing))
  })

  it("fails closed on evidence it cannot read", () => {
    expect(costingPriced({ has_matrix: true }).met).toBe(false)
  })

  it("fails closed on a missing Acquire count that is null or absent", () => {
    expect(costingPriced({ ...priced, missing_acquire: null })).toMatchObject({ met: false, failing: ["missing_acquire"] })
    const { missing_acquire: _gone, ...without } = priced
    expect(costingPriced(without)).toMatchObject({ met: false, failing: ["missing_acquire"] })
  })

  it("does not look at Final Acquire, the offer, the evaluation or the Bid Decision", () => {
    expect(costingPriced({ ...priced, missing_cost: 5, missing_offer: 3, evaluation_approved: false, bid_verdict: null }).met).toBe(true)
  })
})

describe("the shared evaluator for Costing priced (#463)", () => {
  it("words each failing check", () => {
    expect(describeFailing(["missing_acquire"], { ...priced, missing_acquire: 1 })).toEqual(["1 row has no Acquire unit cost."])
    expect(describeFailing(["missing_acquire"], { ...priced, missing_acquire: 4 })).toEqual(["4 rows have no Acquire unit cost."])
    expect(describeFailing(["no_components", "no_purchasing_incharge"], priced)).toEqual([
      "The Costing Matrix has no Components.",
      "No Purchasing Incharge is named on the Costing Matrix.",
    ])
  })

  it("is a costing kind and fails closed with no evidence", () => {
    expect(isCostingKind("costing_priced")).toBe(true)
    expect(evaluateCostingCondition("costing_priced", undefined).met).toBe(false)
  })
})

describe("evaluateCondition — costing_priced kind (#463)", () => {
  const condition = { id: "c2", kind: CONDITION_KINDS.COSTING_PRICED, label: "Costing priced", config: {} }

  it("is offered for a new condition", () => {
    expect(NEW_CONDITION_KINDS).toContain("costing_priced")
  })

  it("is satisfied when Purchasing has costed the matrix", () => {
    expect(evaluateCondition(condition, { costingInputs: priced }).status).toBe(CONDITION_STATUS.SATISFIED)
  })

  it("is unsatisfied and carries the failing checks as detail", () => {
    const result = evaluateCondition(condition, { costingInputs: { ...priced, missing_acquire: 2, has_purchasing_incharge: false } })
    expect(result.status).toBe(CONDITION_STATUS.UNSATISFIED)
    expect(result.detail.failing).toEqual(["missing_acquire", "no_purchasing_incharge"])
  })

  it("fails closed when nobody loaded the evidence", () => {
    expect(evaluateCondition(condition).status).toBe(CONDITION_STATUS.UNSATISFIED)
  })
})

describe("the Evaluation of Specification approved kind (#707)", () => {
  it("is met only when a matrix exists and its evaluation sign-off is live", () => {
    expect(isCostingKind("costing_evaluation_approved")).toBe(true)
    expect(evaluateCostingCondition("costing_evaluation_approved", { has_matrix: true, evaluation_approved: true }).met).toBe(true)
    const waiting = evaluateCostingCondition("costing_evaluation_approved", { has_matrix: true, evaluation_approved: false })
    expect(waiting.met).toBe(false)
    expect(waiting.messages).toEqual(["The Evaluation of Specification is not approved."])
    expect(evaluateCostingCondition("costing_evaluation_approved", { has_matrix: false }).failing).toEqual(["no_matrix"])
    expect(evaluateCostingCondition("costing_evaluation_approved", undefined).met).toBe(false)
  })

  it("is offered when adding a new condition", () => {
    expect(NEW_CONDITION_KINDS).toContain("costing_evaluation_approved")
  })
})
