import { describe, it, expect } from "vitest"
import {
  journeyRows,
  visitSummary,
  visitOwnsTask,
  isTaskOpen,
  isTaskDeleted,
  isConditionOutstanding,
  matchedAttachmentFor,
  stageFieldRows,
  stageFollowUpLogs,
  stageFollowUpReminderCount,
} from "./journey"
import { CONDITION_KINDS, CONDITION_STATUS } from "./stageGate"
import { TASK_STATUS } from "./status"

function makeVisit(overrides = {}) {
  return {
    id: "visit-1",
    sequence: 1,
    stage: { id: "stage-1", name: "Prospecting", bracket: "Lead" },
    enteredAt: "2026-01-01T00:00:00Z",
    enteredBy: { id: "emp-1", name: "Alice" },
    leftAt: null,
    leftBy: null,
    conditions: [],
    tasks: [],
    groupTasks: [],
    requestedItems: [],
    ...overrides,
  }
}

describe("journeyRows", () => {
  it("orders visits latest first by sequence", () => {
    const v1 = makeVisit({ id: "v1", sequence: 1, leftAt: "2026-01-02T00:00:00Z" })
    const v2 = makeVisit({ id: "v2", sequence: 2, leftAt: "2026-01-03T00:00:00Z" })
    const v3 = makeVisit({ id: "v3", sequence: 3 })

    const rows = journeyRows([v1, v2, v3], {})

    expect(rows.map((r) => r.visit.id)).toEqual(["v3", "v2", "v1"])
  })

  it("renders the current (open) visit as a summary line, not expandable", () => {
    const past = makeVisit({ id: "past", sequence: 1, leftAt: "2026-01-02T00:00:00Z" })
    const current = makeVisit({ id: "current", sequence: 2, leftAt: null })

    const rows = journeyRows([past, current], {})

    const currentRow = rows.find((r) => r.visit.id === "current")
    const pastRow = rows.find((r) => r.visit.id === "past")

    expect(currentRow.isCurrent).toBe(true)
    expect(currentRow.isExpanded).toBe(false)
    expect(currentRow.summary).not.toBeNull()
    expect(pastRow.isCurrent).toBe(false)
    expect(pastRow.summary).toBeNull()
  })

  it("handles an SOR that looped through one Stage twice", () => {
    const firstVisit = makeVisit({
      id: "v1",
      sequence: 1,
      stage: { id: "stage-a", name: "Qualification", bracket: "Lead" },
      leftAt: "2026-01-05T00:00:00Z",
    })
    const secondVisit = makeVisit({
      id: "v2",
      sequence: 3,
      stage: { id: "stage-a", name: "Qualification", bracket: "Lead" },
      leftAt: null,
    })

    const rows = journeyRows([firstVisit, secondVisit], {})

    expect(rows).toHaveLength(2)
    expect(rows[0].visit.id).toBe("v2")
    expect(rows[0].isCurrent).toBe(true)
    expect(rows[1].visit.id).toBe("v1")
    expect(rows[1].isCurrent).toBe(false)
  })

  it("expands a past visit only when its id is in expandedIds", () => {
    const past = makeVisit({ id: "past", sequence: 1, leftAt: "2026-01-02T00:00:00Z" })

    const collapsed = journeyRows([past], { expandedIds: [] })
    const expanded = journeyRows([past], { expandedIds: ["past"] })

    expect(collapsed[0].isExpanded).toBe(false)
    expect(expanded[0].isExpanded).toBe(true)
  })

  it("never expands a restricted past visit, even when its id is in expandedIds (#296)", () => {
    const restricted = makeVisit({ id: "past", sequence: 1, leftAt: "2026-01-02T00:00:00Z", isRestricted: true })

    const rows = journeyRows([restricted], { expandedIds: ["past"] })

    expect(rows[0].isExpanded).toBe(false)
  })

  it("handles a visit with no tasks", () => {
    const past = makeVisit({ id: "past", sequence: 1, leftAt: "2026-01-02T00:00:00Z", tasks: [], groupTasks: [] })
    const current = makeVisit({ id: "current", sequence: 2, enteredAt: "2026-01-02T00:00:00Z", tasks: [], groupTasks: [] })

    const [currentRow, pastRow] = journeyRows([past, current], {})

    expect(currentRow.summary.openTasks).toBe(0)
    expect(currentRow.summary.line).toBe("Nothing outstanding")
    expect(pastRow).toMatchObject({ isCurrent: false, isExpanded: false, summary: null })
  })
})

describe("visitSummary", () => {
  it("reports outstanding conditions and open tasks", () => {
    const visit = makeVisit({
      conditions: [{ status: CONDITION_STATUS.UNSATISFIED }, { status: CONDITION_STATUS.SATISFIED }],
      tasks: [{ status: TASK_STATUS.INCOMPLETE }, { status: TASK_STATUS.COMPLETE }],
      groupTasks: [{ status: "HR_PENDING" }],
    })

    const summary = visitSummary(visit)

    expect(summary.outstandingConditions).toBe(1)
    expect(summary.openTasks).toBe(1)
    expect(summary.line).toBe("1 condition outstanding · 1 open task")
  })

  it("says nothing outstanding when everything is settled", () => {
    const visit = makeVisit({
      conditions: [{ status: CONDITION_STATUS.SATISFIED }],
      tasks: [{ status: TASK_STATUS.COMPLETE }],
    })

    expect(visitSummary(visit).line).toBe("Nothing outstanding")
  })

  it("reports 'This stage is restricted' rather than counting anything, for a restricted visit (#296)", () => {
    // Even if conditions/tasks somehow arrived on the object (they never do —
    // RLS already stripped them), a restricted visit's summary must not
    // count them: the line would otherwise misread as "nothing outstanding"
    // rather than "you can't see what's here".
    const visit = makeVisit({
      isRestricted: true,
      conditions: [{ status: CONDITION_STATUS.UNSATISFIED }],
      tasks: [{ status: TASK_STATUS.INCOMPLETE }],
    })

    const summary = visitSummary(visit)
    expect(summary.line).toBe("This stage is restricted")
    expect(summary.isRestricted).toBe(true)
    expect(summary.outstandingConditions).toBe(0)
    expect(summary.openTasks).toBe(0)
  })
})

describe("isTaskDeleted", () => {
  it("is true only for a deleted task", () => {
    expect(isTaskDeleted({ status: TASK_STATUS.DELETED })).toBe(true)
    expect(isTaskDeleted({ status: TASK_STATUS.COMPLETE })).toBe(false)
    expect(isTaskDeleted({ status: "ACTIVE" })).toBe(false)
  })
})

describe("isConditionOutstanding", () => {
  it("counts an unsatisfied condition, never a satisfied or not-applicable one", () => {
    expect(isConditionOutstanding({ status: CONDITION_STATUS.UNSATISFIED })).toBe(true)
    expect(isConditionOutstanding({ status: CONDITION_STATUS.SATISFIED })).toBe(false)
    expect(isConditionOutstanding({ status: CONDITION_STATUS.NOT_APPLICABLE })).toBe(false)
  })
})

describe("isTaskOpen", () => {
  it("treats completed, deleted, and HR-settled statuses as closed", () => {
    expect(isTaskOpen({ status: TASK_STATUS.COMPLETE })).toBe(false)
    expect(isTaskOpen({ status: TASK_STATUS.DELETED })).toBe(false)
    expect(isTaskOpen({ status: "HR_PENDING" })).toBe(false)
    expect(isTaskOpen({ status: "HR_VERIFIED" })).toBe(false)
    expect(isTaskOpen({ status: TASK_STATUS.INCOMPLETE })).toBe(true)
  })
})

describe("matchedAttachmentFor (#397)", () => {
  it("returns the attachment tagged with the condition's own id, filtered by accepted type", () => {
    const condition = { id: "cond-1", kind: CONDITION_KINDS.ATTACHMENT, config: { accepts: ["pdf"] } }
    const attachments = [
      { conditionId: "cond-1", type: "image", name: "wrong-type.png" },
      { conditionId: "cond-1", type: "pdf", name: "quote.pdf" },
      { conditionId: "cond-2", type: "pdf", name: "not-mine.pdf" },
    ]

    expect(matchedAttachmentFor(condition, attachments)).toMatchObject({ name: "quote.pdf" })
  })

  it("falls back to the legacy documentType match for a pre-#203 condition", () => {
    const condition = { id: "cond-1", kind: CONDITION_KINDS.ATTACHMENT, config: { documentType: "NDA" } }
    const attachments = [{ documentType: "NDA", name: "nda.pdf" }]

    expect(matchedAttachmentFor(condition, attachments)).toMatchObject({ name: "nda.pdf" })
  })

  it("returns null when nothing matches, or the condition isn't an attachment kind", () => {
    const condition = { id: "cond-1", kind: CONDITION_KINDS.ATTACHMENT, config: {} }
    expect(matchedAttachmentFor(condition, [])).toBeNull()
    expect(matchedAttachmentFor({ id: "cond-2", kind: CONDITION_KINDS.TICKBOX }, [{ conditionId: "cond-2" }])).toBeNull()
  })
})

describe("stageFieldRows (#397)", () => {
  it("splits custom fields into filled (with value) and not-filled (label only)", () => {
    const fields = [
      { id: "f1", label: "Site survey date", source: "custom" },
      { id: "f2", label: "Access notes", source: "custom" },
      { id: "f3", label: "Ignored SOR field", source: "sor", sor_field: "po_date" },
    ]
    const values = { f1: "2026-02-01" }

    expect(stageFieldRows(fields, values)).toEqual({
      filled: [{ id: "f1", label: "Site survey date", value: "2026-02-01" }],
      notFilled: ["Access notes"],
    })
  })

  it("treats blank/whitespace values as not filled", () => {
    const fields = [{ id: "f1", label: "Notes", source: "custom" }]
    expect(stageFieldRows(fields, { f1: "   " }).notFilled).toEqual(["Notes"])
  })
})

describe("stageFollowUpLogs / stageFollowUpReminderCount (#397)", () => {
  const logs = [
    {
      author_id: "emp-1",
      created_at: "2026-01-05T00:00:00Z",
      content: "Follow-up logged: Called the client, awaiting reply",
      metadata: { event: "FOLLOW_UP_LOGGED", stageVisitId: "visit-1", attachments: [{ name: "call-notes.pdf" }] },
    },
    {
      author_id: "emp-2",
      created_at: "2026-01-01T00:00:00Z",
      content: "Follow-up logged",
      metadata: { event: "FOLLOW_UP_LOGGED", stageVisitId: "visit-1" },
    },
    {
      author_id: "emp-3",
      created_at: "2026-01-03T00:00:00Z",
      content: "Follow-up logged: not this visit",
      metadata: { event: "FOLLOW_UP_LOGGED", stageVisitId: "visit-2" },
    },
    { author_id: null, created_at: "2026-01-06T00:00:00Z", content: null, metadata: { event: "FOLLOW_UP_REMINDER", stageVisitId: "visit-1" } },
    { author_id: null, created_at: "2026-01-08T00:00:00Z", content: null, metadata: { event: "FOLLOW_UP_REMINDER", stageVisitId: "visit-1" } },
    { author_id: null, created_at: "2026-01-09T00:00:00Z", content: null, metadata: { event: "FOLLOW_UP_REMINDER", stageVisitId: "visit-2" } },
  ]

  it("lists a visit's logged follow-ups oldest first, with note text stripped of the system prefix", () => {
    const rows = stageFollowUpLogs(logs, "visit-1")

    expect(rows).toEqual([
      { loggedBy: "emp-2", loggedAt: "2026-01-01T00:00:00Z", note: "", files: [] },
      {
        loggedBy: "emp-1",
        loggedAt: "2026-01-05T00:00:00Z",
        note: "Called the client, awaiting reply",
        files: [{ name: "call-notes.pdf" }],
      },
    ])
  })

  it("counts only this visit's reminders", () => {
    expect(stageFollowUpReminderCount(logs, "visit-1")).toBe(2)
    expect(stageFollowUpReminderCount(logs, "visit-2")).toBe(1)
    expect(stageFollowUpReminderCount(logs, "visit-3")).toBe(0)
  })
})

describe("visitOwnsTask", () => {
  const visit = { id: "visit-1", enteredAt: "2026-01-01T00:00:00Z", leftAt: "2026-01-10T00:00:00Z" }

  it("trusts a stamped stage_visit_id over timing", () => {
    expect(visitOwnsTask({ stage_visit_id: "visit-1" }, visit)).toBe(true)
    expect(visitOwnsTask({ stage_visit_id: "visit-2", created_at: "2026-01-05T00:00:00Z" }, visit)).toBe(false)
  })

  it("falls back to the created_at window for unstamped tasks", () => {
    expect(visitOwnsTask({ created_at: "2026-01-05T00:00:00Z" }, visit)).toBe(true)
    expect(visitOwnsTask({ created_at: "2025-12-31T00:00:00Z" }, visit)).toBe(false)
  })

  it("excludes the instant the visit left, so a looped-back visit doesn't claim it", () => {
    expect(visitOwnsTask({ created_at: "2026-01-10T00:00:00Z" }, visit)).toBe(false)
  })

  it("includes an open-ended window when the visit has not left yet", () => {
    const openVisit = { id: "visit-2", enteredAt: "2026-01-01T00:00:00Z", leftAt: null }
    expect(visitOwnsTask({ created_at: "2026-06-01T00:00:00Z" }, openVisit)).toBe(true)
  })
})
