import { describe, expect, it } from "vitest"
import {
  entryStage,
  flowLockBlockers,
  isFlowLockable,
  isLegalMove,
  outgoingStages,
} from "./salesFlow"

/**
 * The Sales Flow graph, per ADR 0006 and issue #36. Expected values here are
 * literals drawn from the decisions, never recomputed the way the
 * implementation computes them — a test that re-derives the answer cannot
 * disagree with the code.
 *
 * The flow below is deliberately not a line. It has a branch (Qualified goes
 * to either Bidding or straight to Negotiation), a loop back (Negotiation
 * returns to Qualified) and a terminal Stage reachable from anywhere.
 */
const stage = (id, name, sort_order, overrides = {}) => ({
  id,
  flow_id: "flow-1",
  name,
  sort_order,
  is_terminal: false,
  ...overrides,
})

const STAGES = [
  stage("s-lead", "Lead", 10),
  stage("s-qualified", "Qualified", 20),
  stage("s-bidding", "For Bidding", 30),
  stage("s-negotiation", "Negotiation", 40),
  stage("s-won", "Awarded", 50),
  stage("s-lost", "Lost", 60, { is_terminal: true }),
]

const edge = (from, to) => ({ id: `${from}->${to}`, flow_id: "flow-1", from_stage_id: from, to_stage_id: to })

const EDGES = [
  edge("s-lead", "s-qualified"),
  edge("s-qualified", "s-bidding"),
  edge("s-qualified", "s-negotiation"),
  edge("s-bidding", "s-negotiation"),
  edge("s-negotiation", "s-qualified"),
  edge("s-negotiation", "s-won"),
  edge("s-lead", "s-lost"),
  edge("s-qualified", "s-lost"),
]

describe("which moves a flow permits", () => {
  it("permits a move along an edge that was drawn", () => {
    expect(isLegalMove("s-lead", "s-qualified", EDGES)).toBe(true)
  })

  it("refuses a move along an edge that does not exist", () => {
    // The load-bearing rule: paths that never happen in reality are not
    // offered. Lead to Awarded is two Stages further on than anything drawn.
    expect(isLegalMove("s-lead", "s-won", EDGES)).toBe(false)
  })

  it("refuses a move backwards along a forward edge", () => {
    // Edges are directed. Qualified -> Bidding exists; the reverse does not.
    expect(isLegalMove("s-bidding", "s-qualified", EDGES)).toBe(false)
  })

  it("permits a loop back that was drawn as its own edge", () => {
    expect(isLegalMove("s-negotiation", "s-qualified", EDGES)).toBe(true)
  })

  it("permits a skip ahead that was drawn as its own edge", () => {
    // Qualified straight to Negotiation, never touching For Bidding.
    expect(isLegalMove("s-qualified", "s-negotiation", EDGES)).toBe(true)
  })

  it("refuses a move to the Stage the deal is already on", () => {
    expect(isLegalMove("s-qualified", "s-qualified", EDGES)).toBe(false)
  })

  it("refuses everything when a flow has no edges at all", () => {
    expect(isLegalMove("s-lead", "s-qualified", [])).toBe(false)
  })

  it("refuses a move naming a Stage the flow does not have", () => {
    expect(isLegalMove("s-lead", "s-elsewhere", EDGES)).toBe(false)
    expect(isLegalMove(null, "s-qualified", EDGES)).toBe(false)
  })

  it("lists exactly the Stages a deal may move to next, in flow order", () => {
    // What a stage picker renders: a branch offers both of its arms plus the
    // terminal Stage drawn from it, and nothing else.
    expect(outgoingStages("s-qualified", STAGES, EDGES).map((s) => s.name)).toEqual([
      "For Bidding",
      "Negotiation",
      "Lost",
    ])
  })

  it("offers nothing from a Stage with no outgoing edges", () => {
    expect(outgoingStages("s-lost", STAGES, EDGES)).toEqual([])
  })
})

describe("where a deal enters a flow", () => {
  it("is the Stage that sorts first", () => {
    expect(entryStage(STAGES).name).toBe("Lead")
  })

  it("does not depend on the order the Stages arrive in", () => {
    const shuffled = [...STAGES].reverse()
    expect(entryStage(shuffled).name).toBe("Lead")
  })

  it("is still the first Stage when something loops back to it", () => {
    // "The Stage with no incoming edges" would answer nothing here. Deriving
    // the entry from order survives the loops that make this a graph.
    const looping = [...EDGES, edge("s-won", "s-lead")]
    expect(isLegalMove("s-won", "s-lead", looping)).toBe(true)
    expect(entryStage(STAGES).name).toBe("Lead")
  })

  it("is null for a flow with no Stages yet", () => {
    expect(entryStage([])).toBeNull()
  })

  it("breaks a sort_order tie by name, so the entry never moves on its own", () => {
    const tied = [stage("s-b", "Beta", 10), stage("s-a", "Alpha", 10)]
    expect(entryStage(tied).name).toBe("Alpha")
  })
})

describe("whether a flow may be locked", () => {
  const lockable = { stages: STAGES, edges: EDGES, wonStageId: "s-won" }

  it("is lockable once it has Stages, edges and one Won Stage", () => {
    expect(flowLockBlockers(lockable)).toEqual([])
    expect(isFlowLockable(lockable)).toBe(true)
  })

  it("refuses to lock a flow with no Won Stage", () => {
    // Issue #36: the canvas refuses to lock a flow without one, because
    // Realized has no other answer once position stopped meaning anything.
    const blockers = flowLockBlockers({ ...lockable, wonStageId: null })
    expect(blockers).toEqual(["This flow has no Won Stage — set where the deal is won."])
    expect(isFlowLockable({ ...lockable, wonStageId: null })).toBe(false)
  })

  it("refuses to lock when the Won Stage belongs to another flow", () => {
    // Structurally there can never be two Won Stages, but there can be a
    // stale one left behind by a Stage that was deleted or moved.
    expect(flowLockBlockers({ ...lockable, wonStageId: "s-elsewhere" })).toEqual([
      "This flow's Won Stage is not one of its own Stages.",
    ])
  })

  it("refuses to lock an empty flow", () => {
    expect(flowLockBlockers({ stages: [], edges: [], wonStageId: null })).toEqual([
      "This flow has no Stages.",
    ])
  })

  it("refuses to lock a flow whose Stages are not joined up", () => {
    const orphaned = [...STAGES, stage("s-orphan", "Orphan", 70)]
    expect(flowLockBlockers({ ...lockable, stages: orphaned })).toEqual([
      "Orphan cannot be reached from Lead.",
    ])
  })

  it("counts a Stage reachable only by a skip as joined up", () => {
    // Reachability follows the edges she drew, not the sort order.
    const skipOnly = STAGES.filter((s) => s.id !== "s-bidding")
    const skipEdges = EDGES.filter((e) => !e.id.includes("s-bidding"))
    expect(flowLockBlockers({ stages: skipOnly, edges: skipEdges, wonStageId: "s-won" })).toEqual([])
  })

  it("reports every blocker at once rather than one at a time", () => {
    // She is at the lock screen with the Operations Manager. Fixing one
    // problem only to be told about the next is the wrong shape of feedback.
    const broken = [...STAGES, stage("s-orphan", "Orphan", 70)]
    expect(flowLockBlockers({ stages: broken, edges: EDGES, wonStageId: null })).toEqual([
      "This flow has no Won Stage — set where the deal is won.",
      "Orphan cannot be reached from Lead.",
    ])
  })
})
