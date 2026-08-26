import { describe, expect, it } from "vitest"
import {
  blockingRequirements,
  deadlineStatus,
  evaluateCrossing,
  evaluateRequirement,
  REQUIREMENT_STATUS,
  stagesCrossed,
} from "./stageGate"
import { PIPELINE_STAGE_SEED } from "./sor"

/**
 * Stage Gate Engine — pure evaluation (Seam 1). No database: every value
 * comes in as an argument, per docs/stage-gate-engine-spec.md's Seam 1
 * testing decision. Business facts are asserted, not implementation shape —
 * see .scratch/stage-gate-engine/issues/01-schema-and-evaluation-engine.md.
 */

const makeRequirement = (overrides = {}) => ({
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

describe("blockingRequirements", () => {
  it("keeps a required, active, non-deadline requirement", () => {
    const req = makeRequirement()
    expect(blockingRequirements([req])).toEqual([req])
  })

  it("drops an archived requirement", () => {
    const req = makeRequirement({ archived_at: "2026-02-01T00:00:00.000Z" })
    expect(blockingRequirements([req])).toEqual([])
  })

  it("drops an optional requirement — advisory items never block", () => {
    const req = makeRequirement({ is_required: false })
    expect(blockingRequirements([req])).toEqual([])
  })

  it("drops a deadline requirement — deadlines never block by kind, regardless of is_required", () => {
    const req = makeRequirement({ kind: "deadline", is_required: true })
    expect(blockingRequirements([req])).toEqual([])
  })
})

describe("evaluateRequirement — attachment kind", () => {
  it("is satisfied when a matching document is on file", () => {
    const req = makeRequirement({
      kind: "attachment",
      config: { documentType: "NOTICE_OF_AWARD" },
    })
    const result = evaluateRequirement(req, {
      attachments: [{ documentType: "NOTICE_OF_AWARD", uploadedBy: "emp-1", uploadedAt: "2026-03-01" }],
    })
    expect(result.status).toBe(REQUIREMENT_STATUS.SATISFIED)
    expect(result.satisfiedBy).toBe("emp-1")
  })

  it("is unsatisfied when no document of the named type is on file", () => {
    const req = makeRequirement({
      kind: "attachment",
      config: { documentType: "NOTICE_OF_AWARD" },
    })
    const result = evaluateRequirement(req, {
      attachments: [{ documentType: "PERFORMANCE_BOND" }],
    })
    expect(result.status).toBe(REQUIREMENT_STATUS.UNSATISFIED)
  })

  it("accepts any attachment when no document type is configured", () => {
    const req = makeRequirement({ kind: "attachment", config: {} })
    const result = evaluateRequirement(req, { attachments: [{ documentType: "ANYTHING" }] })
    expect(result.status).toBe(REQUIREMENT_STATUS.SATISFIED)
  })
})

describe("evaluateRequirement — field kind", () => {
  it("is satisfied when the named column is non-empty", () => {
    const req = makeRequirement({ kind: "field", config: { column: "po_date" } })
    const result = evaluateRequirement(req, { opportunity: { po_date: "2026-04-01" } })
    expect(result.status).toBe(REQUIREMENT_STATUS.SATISFIED)
  })

  it("is unsatisfied when the named column is empty", () => {
    const req = makeRequirement({ kind: "field", config: { column: "po_date" } })
    const result = evaluateRequirement(req, { opportunity: { po_date: null } })
    expect(result.status).toBe(REQUIREMENT_STATUS.UNSATISFIED)
  })

  it("un-satisfies again once a filled field is cleared — the record is the evidence, not a cached answer", () => {
    const req = makeRequirement({ kind: "field", config: { column: "po_date" } })
    const filled = evaluateRequirement(req, { opportunity: { po_date: "2026-04-01" } })
    const cleared = evaluateRequirement(req, { opportunity: { po_date: "" } })
    expect(filled.status).toBe(REQUIREMENT_STATUS.SATISFIED)
    expect(cleared.status).toBe(REQUIREMENT_STATUS.UNSATISFIED)
  })
})

describe("evaluateRequirement — assignment kind", () => {
  it("is satisfied when a member from the named department is on the SOR", () => {
    const req = makeRequirement({ kind: "assignment", config: { department: "Purchasing" } })
    const result = evaluateRequirement(req, {
      members: [{ employeeId: "emp-2", department: "Purchasing" }],
    })
    expect(result.status).toBe(REQUIREMENT_STATUS.SATISFIED)
    expect(result.satisfiedBy).toBe("emp-2")
  })

  it("is unsatisfied when nobody from the named department is a member", () => {
    const req = makeRequirement({ kind: "assignment", config: { department: "Purchasing" } })
    const result = evaluateRequirement(req, { members: [{ employeeId: "emp-3", department: "Sales" }] })
    expect(result.status).toBe(REQUIREMENT_STATUS.UNSATISFIED)
  })
})

describe("evaluateRequirement — tickbox kind", () => {
  it("is satisfied only once a status row exists, and records who and when", () => {
    const req = makeRequirement({ kind: "tickbox", config: {} })
    const unticked = evaluateRequirement(req, { statusRow: null })
    const ticked = evaluateRequirement(req, {
      statusRow: { satisfied_by: "emp-4", satisfied_at: "2026-05-01T00:00:00.000Z" },
    })
    expect(unticked.status).toBe(REQUIREMENT_STATUS.UNSATISFIED)
    expect(ticked.status).toBe(REQUIREMENT_STATUS.SATISFIED)
    expect(ticked.satisfiedBy).toBe("emp-4")
    expect(ticked.satisfiedAt).toBe("2026-05-01T00:00:00.000Z")
  })
})

describe("evaluateRequirement — never applied vs unsatisfied", () => {
  it("is not_applicable when the requirement was created after the crossing being evaluated", () => {
    const req = makeRequirement({
      kind: "field",
      config: { column: "po_date" },
      created_at: "2026-06-01T00:00:00.000Z",
    })
    const result = evaluateRequirement(req, {
      opportunity: { po_date: null },
      asOf: "2026-05-01T00:00:00.000Z", // the deal crossed before this requirement existed
    })
    expect(result.status).toBe(REQUIREMENT_STATUS.NOT_APPLICABLE)
  })

  it("is evaluated normally when the requirement predates the crossing", () => {
    const req = makeRequirement({
      kind: "field",
      config: { column: "po_date" },
      created_at: "2026-01-01T00:00:00.000Z",
    })
    const result = evaluateRequirement(req, {
      opportunity: { po_date: null },
      asOf: "2026-05-01T00:00:00.000Z",
    })
    expect(result.status).toBe(REQUIREMENT_STATUS.UNSATISFIED)
  })

  it("is not_applicable once archived, regardless of satisfaction", () => {
    const req = makeRequirement({ kind: "tickbox", archived_at: "2026-02-01T00:00:00.000Z" })
    const result = evaluateRequirement(req, { statusRow: null })
    expect(result.status).toBe(REQUIREMENT_STATUS.NOT_APPLICABLE)
  })
})

describe("deadlineStatus", () => {
  it("counts days remaining before the due date", () => {
    const req = makeRequirement({ kind: "deadline", config: { days: 10 } })
    const { daysRemaining, isBreached } = deadlineStatus(req, {
      enteredAt: "2026-06-01T00:00:00.000Z",
      asOf: "2026-06-04T00:00:00.000Z",
    })
    expect(daysRemaining).toBe(7)
    expect(isBreached).toBe(false)
  })

  it("is not breached on the boundary day itself", () => {
    const req = makeRequirement({ kind: "deadline", config: { days: 10 } })
    const { daysRemaining, isBreached } = deadlineStatus(req, {
      enteredAt: "2026-06-01T00:00:00.000Z",
      asOf: "2026-06-11T00:00:00.000Z", // exactly ten days later
    })
    expect(daysRemaining).toBe(0)
    expect(isBreached).toBe(false)
  })

  it("is breached the day after the boundary", () => {
    const req = makeRequirement({ kind: "deadline", config: { days: 10 } })
    const { daysRemaining, isBreached } = deadlineStatus(req, {
      enteredAt: "2026-06-01T00:00:00.000Z",
      asOf: "2026-06-12T00:00:00.000Z",
    })
    expect(daysRemaining).toBe(-1)
    expect(isBreached).toBe(true)
  })

  it("returns nulls rather than throwing when it cannot compute", () => {
    const req = makeRequirement({ kind: "deadline", config: {} })
    expect(deadlineStatus(req, { enteredAt: null, asOf: "2026-06-01T00:00:00.000Z" })).toEqual({
      daysRemaining: null,
      isBreached: false,
    })
  })
})

describe("evaluateCrossing", () => {
  const requirementsByStage = {
    LEAD: [makeRequirement({ id: "r-lead", stage_code: "LEAD", kind: "tickbox", label: "Lead checklist" })],
    QUALIFIED: [
      makeRequirement({ id: "r-qual", stage_code: "QUALIFIED", kind: "field", config: { column: "budget_confirmed" }, label: "Budget confirmed" }),
    ],
  }

  it("names the stage that was skipped over, not just the destination, when it owes something", () => {
    const result = evaluateCrossing({
      fromCode: "LEAD",
      toCode: "AWARDED",
      stages: PIPELINE_STAGE_SEED,
      requirementsByStage,
      opportunity: { budget_confirmed: null },
      statusRowsByRequirement: {},
      asOf: "2026-07-01T00:00:00.000Z",
    })
    expect(result.blocked).toBe(true)
    const stageCodes = result.missing.map((m) => m.stage.code)
    expect(stageCodes).toEqual(expect.arrayContaining(["LEAD", "QUALIFIED"]))
  })

  it("unblocks once the last outstanding requirement is satisfied", () => {
    const result = evaluateCrossing({
      fromCode: "LEAD",
      toCode: "AWARDED",
      stages: PIPELINE_STAGE_SEED,
      requirementsByStage,
      opportunity: { budget_confirmed: "Yes" },
      statusRowsByRequirement: { "r-lead": { satisfied_by: "emp-1", satisfied_at: "2026-07-01" } },
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
      requirementsByStage,
      opportunity: {},
      asOf: "2026-07-01T00:00:00.000Z",
    })
    expect(result.crossed).toEqual([])
    expect(result.blocked).toBe(false)
  })

  it("a requirement added after the deal already crossed does not block it", () => {
    const lateRequirement = {
      LEAD: [
        makeRequirement({
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
      requirementsByStage: lateRequirement,
      opportunity: {},
      asOf: "2026-07-01T00:00:00.000Z", // before the requirement existed
    })
    expect(result.blocked).toBe(false)
  })
})
