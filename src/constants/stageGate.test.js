import { describe, expect, it } from "vitest"
import {
  blockingConditions,
  DEADLINE_APPROACHING_DAYS,
  deadlineStatus,
  evaluateCrossing,
  evaluateCondition,
  CONDITION_STATUS,
  stagesCrossed,
} from "./stageGate"
import { PIPELINE_STAGE_SEED } from "./sor"

/**
 * Stage Gate Engine — pure evaluation (Seam 1). No database: every value
 * comes in as an argument, per docs/stage-gate-engine-spec.md's Seam 1
 * testing decision. Business facts are asserted, not implementation shape —
 * see .scratch/stage-gate-engine/issues/01-schema-and-evaluation-engine.md.
 */

const makeCondition = (overrides = {}) => ({
  id: "req-1",
  stage_code: "AWARDED",
  kind: "attachment",
  label: "Notice of Award",
  is_required: true,
  sort_order: 0,
  config: {},
  archived_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
})

describe("stagesCrossed", () => {
  it("crosses only the single stage being left on a one-step move", () => {
    const crossed = stagesCrossed("PROPOSAL_SUBMITTED", "QUALIFIED", PIPELINE_STAGE_SEED)
    expect(crossed.map((s) => s.code)).toEqual(["PROPOSAL_SUBMITTED"])
  })

  it("crosses every stage between and including the one left, on a multi-stage jump", () => {
    // The production case: 17 recorded moves jump Lead straight into the
    // booked region, past every intervening stage.
    const crossed = stagesCrossed("LEAD", "AWARDED", PIPELINE_STAGE_SEED)
    expect(crossed.map((s) => s.code)).toEqual([
      "LEAD",
      "PROPOSAL_SUBMITTED",
      "QUALIFIED",
      "FOR_BIDDING",
      "BID_SUBMITTED",
      "NEGOTIATION",
    ])
  })

  it("does not include the destination stage", () => {
    const crossed = stagesCrossed("LEAD", "QUALIFIED", PIPELINE_STAGE_SEED)
    expect(crossed.map((s) => s.code)).not.toContain("QUALIFIED")
  })

  it("crosses nothing on a backward move", () => {
    expect(stagesCrossed("AWARDED", "LEAD", PIPELINE_STAGE_SEED)).toEqual([])
  })

  it("crosses nothing when the move stays on the same stage", () => {
    expect(stagesCrossed("QUALIFIED", "QUALIFIED", PIPELINE_STAGE_SEED)).toEqual([])
  })

  it("crosses nothing when either code is not in the stage list", () => {
    expect(stagesCrossed("GHOST", "AWARDED", PIPELINE_STAGE_SEED)).toEqual([])
    expect(stagesCrossed("LEAD", "GHOST", PIPELINE_STAGE_SEED)).toEqual([])
  })
})

describe("blockingConditions", () => {
  it("keeps a required, active, non-deadline condition", () => {
    const req = makeCondition()
    expect(blockingConditions([req])).toEqual([req])
  })

  it("drops an archived condition", () => {
    const req = makeCondition({ archived_at: "2026-02-01T00:00:00.000Z" })
    expect(blockingConditions([req])).toEqual([])
  })

  it("drops an optional condition — advisory items never block", () => {
    const req = makeCondition({ is_required: false })
    expect(blockingConditions([req])).toEqual([])
  })

  it("drops a deadline condition — deadlines never block by kind, regardless of is_required", () => {
    const req = makeCondition({ kind: "deadline", is_required: true })
    expect(blockingConditions([req])).toEqual([])
  })
})

describe("evaluateCondition — attachment kind", () => {
  it("is satisfied when a matching document is on file", () => {
    const req = makeCondition({
      kind: "attachment",
      config: { documentType: "NOTICE_OF_AWARD" },
    })
    const result = evaluateCondition(req, {
      attachments: [{ documentType: "NOTICE_OF_AWARD", uploadedBy: "emp-1", uploadedAt: "2026-03-01" }],
    })
    expect(result.status).toBe(CONDITION_STATUS.SATISFIED)
    expect(result.satisfiedBy).toBe("emp-1")
  })

  it("is unsatisfied when no document of the named type is on file", () => {
    const req = makeCondition({
      kind: "attachment",
      config: { documentType: "NOTICE_OF_AWARD" },
    })
    const result = evaluateCondition(req, {
      attachments: [{ documentType: "PERFORMANCE_BOND" }],
    })
    expect(result.status).toBe(CONDITION_STATUS.UNSATISFIED)
  })

  it("accepts any attachment when no document type is configured", () => {
    const req = makeCondition({ kind: "attachment", config: {} })
    const result = evaluateCondition(req, { attachments: [{ documentType: "ANYTHING" }] })
    expect(result.status).toBe(CONDITION_STATUS.SATISFIED)
  })
})

describe("evaluateCondition — field kind", () => {
  it("is satisfied when the named column is non-empty", () => {
    const req = makeCondition({ kind: "field", config: { column: "po_date" } })
    const result = evaluateCondition(req, { opportunity: { po_date: "2026-04-01" } })
    expect(result.status).toBe(CONDITION_STATUS.SATISFIED)
  })

  it("is unsatisfied when the named column is empty", () => {
    const req = makeCondition({ kind: "field", config: { column: "po_date" } })
    const result = evaluateCondition(req, { opportunity: { po_date: null } })
    expect(result.status).toBe(CONDITION_STATUS.UNSATISFIED)
  })

  it("un-satisfies again once a filled field is cleared — the record is the evidence, not a cached answer", () => {
    const req = makeCondition({ kind: "field", config: { column: "po_date" } })
    const filled = evaluateCondition(req, { opportunity: { po_date: "2026-04-01" } })
    const cleared = evaluateCondition(req, { opportunity: { po_date: "" } })
    expect(filled.status).toBe(CONDITION_STATUS.SATISFIED)
    expect(cleared.status).toBe(CONDITION_STATUS.UNSATISFIED)
  })
})

describe("evaluateCondition — assignment kind", () => {
  it("is satisfied when a member from the named department is on the SOR", () => {
    const req = makeCondition({ kind: "assignment", config: { department: "Purchasing" } })
    const result = evaluateCondition(req, {
      members: [{ employeeId: "emp-2", department: "Purchasing" }],
    })
    expect(result.status).toBe(CONDITION_STATUS.SATISFIED)
    expect(result.satisfiedBy).toBe("emp-2")
  })

  it("is unsatisfied when nobody from the named department is a member", () => {
    const req = makeCondition({ kind: "assignment", config: { department: "Purchasing" } })
    const result = evaluateCondition(req, { members: [{ employeeId: "emp-3", department: "Sales" }] })
    expect(result.status).toBe(CONDITION_STATUS.UNSATISFIED)
  })
})

describe("evaluateCondition — tickbox kind", () => {
  it("is satisfied only once a status row exists, and records who and when", () => {
    const req = makeCondition({ kind: "tickbox", config: {} })
    const unticked = evaluateCondition(req, { statusRow: null })
    const ticked = evaluateCondition(req, {
      statusRow: { satisfied_by: "emp-4", satisfied_at: "2026-05-01T00:00:00.000Z" },
    })
    expect(unticked.status).toBe(CONDITION_STATUS.UNSATISFIED)
    expect(ticked.status).toBe(CONDITION_STATUS.SATISFIED)
    expect(ticked.satisfiedBy).toBe("emp-4")
    expect(ticked.satisfiedAt).toBe("2026-05-01T00:00:00.000Z")
  })
})

// Issue #50.
describe("evaluateCondition — project_evaluation kind", () => {
  it("is satisfied by existence alone, whether or not it was signed off", () => {
    const req = makeCondition({ kind: "project_evaluation", config: {} })

    const missing = evaluateCondition(req, { hasProjectEvaluation: false })
    const unsigned = evaluateCondition(req, { hasProjectEvaluation: true })

    expect(missing.status).toBe(CONDITION_STATUS.UNSATISFIED)
    expect(unsigned.status).toBe(CONDITION_STATUS.SATISFIED)
  })

  it("defaults to unsatisfied when the caller says nothing about it", () => {
    const req = makeCondition({ kind: "project_evaluation", config: {} })
    expect(evaluateCondition(req).status).toBe(CONDITION_STATUS.UNSATISFIED)
  })

  it("evaluates only the Stage being left — no positional comparison enters into it", () => {
    // hasProjectEvaluation is a fact about the deal, not about any Stage, so
    // nothing here reads stage_code, sort_order, or any other Stage besides
    // the one the condition itself lives on.
    const req = makeCondition({ kind: "project_evaluation", stage_code: "PROPOSAL" })
    expect(evaluateCondition(req, { hasProjectEvaluation: true }).status).toBe(
      CONDITION_STATUS.SATISFIED,
    )
  })
})

describe("evaluateCondition — never applied vs unsatisfied", () => {
  it("is not_applicable when the condition was created after the crossing being evaluated", () => {
    const req = makeCondition({
      kind: "field",
      config: { column: "po_date" },
      created_at: "2026-06-01T00:00:00.000Z",
    })
    const result = evaluateCondition(req, {
      opportunity: { po_date: null },
      asOf: "2026-05-01T00:00:00.000Z", // the deal crossed before this condition existed
    })
    expect(result.status).toBe(CONDITION_STATUS.NOT_APPLICABLE)
  })

  it("is evaluated normally when the condition predates the crossing", () => {
    const req = makeCondition({
      kind: "field",
      config: { column: "po_date" },
      created_at: "2026-01-01T00:00:00.000Z",
    })
    const result = evaluateCondition(req, {
      opportunity: { po_date: null },
      asOf: "2026-05-01T00:00:00.000Z",
    })
    expect(result.status).toBe(CONDITION_STATUS.UNSATISFIED)
  })

  it("is not_applicable once archived, regardless of satisfaction", () => {
    const req = makeCondition({ kind: "tickbox", archived_at: "2026-02-01T00:00:00.000Z" })
    const result = evaluateCondition(req, { statusRow: null })
    expect(result.status).toBe(CONDITION_STATUS.NOT_APPLICABLE)
  })

  // Issue #50's own acceptance criterion: a deal that already crossed the
  // Stage before a Project Evaluation condition existed reads as
  // not_applicable, never as blocked after the fact.
  it("is not_applicable for a project_evaluation condition added after the deal already crossed", () => {
    const req = makeCondition({
      kind: "project_evaluation",
      config: {},
      created_at: "2026-06-01T00:00:00.000Z",
    })
    const result = evaluateCondition(req, {
      hasProjectEvaluation: false,
      asOf: "2026-05-01T00:00:00.000Z",
    })
    expect(result.status).toBe(CONDITION_STATUS.NOT_APPLICABLE)
  })
})

describe("deadlineStatus", () => {
  it("counts days remaining before the due date", () => {
    const req = makeCondition({ kind: "deadline", config: { days: 10 } })
    const { daysRemaining, isBreached } = deadlineStatus(req, {
      enteredAt: "2026-06-01T00:00:00.000Z",
      asOf: "2026-06-04T00:00:00.000Z",
    })
    expect(daysRemaining).toBe(7)
    expect(isBreached).toBe(false)
  })

  it("is not breached on the boundary day itself", () => {
    const req = makeCondition({ kind: "deadline", config: { days: 10 } })
    const { daysRemaining, isBreached } = deadlineStatus(req, {
      enteredAt: "2026-06-01T00:00:00.000Z",
      asOf: "2026-06-11T00:00:00.000Z", // exactly ten days later
    })
    expect(daysRemaining).toBe(0)
    expect(isBreached).toBe(false)
  })

  it("is breached the day after the boundary", () => {
    const req = makeCondition({ kind: "deadline", config: { days: 10 } })
    const { daysRemaining, isBreached } = deadlineStatus(req, {
      enteredAt: "2026-06-01T00:00:00.000Z",
      asOf: "2026-06-12T00:00:00.000Z",
    })
    expect(daysRemaining).toBe(-1)
    expect(isBreached).toBe(true)
  })

  it("returns nulls rather than throwing when it cannot compute", () => {
    const req = makeCondition({ kind: "deadline", config: {} })
    expect(deadlineStatus(req, { enteredAt: null, asOf: "2026-06-01T00:00:00.000Z" })).toEqual({
      daysRemaining: null,
      isBreached: false,
      isApproaching: false,
    })
  })

  it("is not yet approaching with days to spare", () => {
    const req = makeCondition({ kind: "deadline", config: { days: 10 } })
    const { isApproaching } = deadlineStatus(req, {
      enteredAt: "2026-06-01T00:00:00.000Z",
      asOf: "2026-06-04T00:00:00.000Z", // 7 days left
    })
    expect(isApproaching).toBe(false)
  })

  it(`is approaching at exactly the ${DEADLINE_APPROACHING_DAYS}-day threshold`, () => {
    const req = makeCondition({ kind: "deadline", config: { days: 10 } })
    const { daysRemaining, isApproaching } = deadlineStatus(req, {
      enteredAt: "2026-06-01T00:00:00.000Z",
      asOf: "2026-06-08T00:00:00.000Z", // 3 days left
    })
    // Literal, not DEADLINE_APPROACHING_DAYS — this test has to be able to
    // disagree with the constant it's checking (docs/testing.md).
    expect(daysRemaining).toBe(3)
    expect(isApproaching).toBe(true)
  })

  it("is not \"approaching\" once it has already breached — that's a different state", () => {
    const req = makeCondition({ kind: "deadline", config: { days: 10 } })
    const { isBreached, isApproaching } = deadlineStatus(req, {
      enteredAt: "2026-06-01T00:00:00.000Z",
      asOf: "2026-06-12T00:00:00.000Z",
    })
    expect(isBreached).toBe(true)
    expect(isApproaching).toBe(false)
  })
})

describe("evaluateCrossing", () => {
  const conditionsByStage = {
    LEAD: [makeCondition({ id: "r-lead", stage_code: "LEAD", kind: "tickbox", label: "Lead checklist" })],
    QUALIFIED: [
      makeCondition({ id: "r-qual", stage_code: "QUALIFIED", kind: "field", config: { column: "budget_confirmed" }, label: "Budget confirmed" }),
    ],
  }

  it("names the stage that was skipped over, not just the destination, when it owes something", () => {
    const result = evaluateCrossing({
      fromCode: "LEAD",
      toCode: "AWARDED",
      stages: PIPELINE_STAGE_SEED,
      conditionsByStage,
      opportunity: { budget_confirmed: null },
      statusRowsByCondition: {},
      asOf: "2026-07-01T00:00:00.000Z",
    })
    expect(result.blocked).toBe(true)
    const stageCodes = result.missing.map((m) => m.stage.code)
    expect(stageCodes).toEqual(expect.arrayContaining(["LEAD", "QUALIFIED"]))
  })

  it("unblocks once the last outstanding condition is satisfied", () => {
    const result = evaluateCrossing({
      fromCode: "LEAD",
      toCode: "AWARDED",
      stages: PIPELINE_STAGE_SEED,
      conditionsByStage,
      opportunity: { budget_confirmed: "Yes" },
      statusRowsByCondition: { "r-lead": { satisfied_by: "emp-1", satisfied_at: "2026-07-01" } },
      asOf: "2026-07-01T00:00:00.000Z",
    })
    expect(result.blocked).toBe(false)
    expect(result.missing).toEqual([])
  })

  it("evaluates nothing on a backward move", () => {
    const result = evaluateCrossing({
      fromCode: "AWARDED",
      toCode: "LEAD",
      stages: PIPELINE_STAGE_SEED,
      conditionsByStage,
      opportunity: {},
      asOf: "2026-07-01T00:00:00.000Z",
    })
    expect(result.crossed).toEqual([])
    expect(result.blocked).toBe(false)
  })

  it("a condition added after the deal already crossed does not block it", () => {
    const lateCondition = {
      LEAD: [
        makeCondition({
          id: "r-late",
          stage_code: "LEAD",
          kind: "tickbox",
          created_at: "2026-08-01T00:00:00.000Z",
        }),
      ],
    }
    const result = evaluateCrossing({
      fromCode: "LEAD",
      toCode: "QUALIFIED",
      stages: PIPELINE_STAGE_SEED,
      conditionsByStage: lateCondition,
      opportunity: {},
      asOf: "2026-07-01T00:00:00.000Z", // before the condition existed
    })
    expect(result.blocked).toBe(false)
  })
})
