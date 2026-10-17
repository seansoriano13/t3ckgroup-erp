import { describe, expect, it } from "vitest"
import {
  actionsForSnapshotStage,
  buildDraftSnapshotData,
  classifyFlowStage,
  endsAsWon,
  isLostFlowStage,
  conditionsForSnapshotStage,
  countFlowSnapshotChanges,
  diffFlowSnapshots,
  entryStage,
  flowLockBlockers,
  flowPublishWarnings,
  flowStageTone,
  isAtEntryStage,
  isFlowLockable,
  isLegalMove,
  isPreWonFlowStage,
  isWonOrPostWonFlowStage,
  outgoingStages,
  snapshotRows,
  stageActionTaskTitle,
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

describe("what color a Stage renders with", () => {
  const flow = { id: "flow-1", won_stage_id: "s-won" }
  const lead = STAGES.find((s) => s.id === "s-lead")
  const qualified = STAGES.find((s) => s.id === "s-qualified")
  const won = STAGES.find((s) => s.id === "s-won")
  const lost = STAGES.find((s) => s.id === "s-lost")

  it("is blue for the entry Stage", () => {
    expect(flowStageTone(lead, flow, STAGES)).toBe("blue")
  })

  it("is green for the flow's Won Stage", () => {
    expect(flowStageTone(won, flow, STAGES)).toBe("green")
  })

  it("is amber for a terminal Stage that is not the Won Stage", () => {
    expect(flowStageTone(lost, flow, STAGES)).toBe("amber")
  })

  it("is mauve for a Stage that is none of the above", () => {
    expect(flowStageTone(qualified, flow, STAGES)).toBe("mauve")
  })

  it("prefers a Stage's own color over its role", () => {
    expect(flowStageTone({ ...lead, color: "red" }, flow, STAGES)).toBe("red")
  })

  it("is mauve for a missing Stage rather than throwing", () => {
    expect(flowStageTone(null, flow, STAGES)).toBe("mauve")
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

describe("whether a deal is sitting where it entered", () => {
  it("is true while it is still on the Stage deals enter at", () => {
    expect(isAtEntryStage({ flow_stage_id: "s-lead" }, STAGES)).toBe(true)
  })

  it("is false once it has moved on", () => {
    expect(isAtEntryStage({ flow_stage_id: "s-qualified" }, STAGES)).toBe(false)
  })

  it("is false when the deal is not on a flow at all", () => {
    expect(isAtEntryStage({ flow_stage_id: null }, STAGES)).toBe(false)
    expect(isAtEntryStage(null, STAGES)).toBe(false)
  })

  it("is false for a flow with no Stages, rather than throwing", () => {
    expect(isAtEntryStage({ flow_stage_id: "s-lead" }, [])).toBe(false)
  })

  // Whether the deal has EVER moved is a different question, and a loop back
  // to the entry Stage makes the two disagree. That one needs the deal's
  // history, so it is asked in opportunityService rather than here.
})

describe("shaping a draft into a Flow Snapshot's shape", () => {
  it("carries the Won Stage and Sale Type off the flow, and the rest as given", () => {
    const flow = { won_stage_id: "s-won", sale_type_id: "st-1" }
    const stages = [stage("s-lead", "Lead", 10)]
    const edges = [edge("s-lead", "s-won")]
    const actions = [{ id: "a-1", stage_id: "s-lead", kind: "create_group_task", config: {} }]
    const conditions = [{ id: "c-1", stage_id: "s-lead", kind: "field", config: {} }]

    expect(buildDraftSnapshotData({ flow, stages, edges, actions, conditions })).toEqual({
      stages,
      edges,
      actions,
      conditions,
      stageFields: [],
      formFields: [],
      followUps: [],
      access: { flow: null, stages: [] },
      wonStageId: "s-won",
      saleTypeId: "st-1",
    })
  })

  it("defaults every list to empty and every id to null for a flow with nothing drawn yet", () => {
    expect(buildDraftSnapshotData({ flow: { won_stage_id: null, sale_type_id: null } })).toEqual({
      stages: [],
      edges: [],
      actions: [],
      conditions: [],
      stageFields: [],
      formFields: [],
      followUps: [],
      access: { flow: null, stages: [] },
      wonStageId: null,
      saleTypeId: null,
    })
  })

  it("round-trips through diffFlowSnapshots as identical to its own snapshot_data shape", () => {
    // The same guarantee `previewVersion`/`lockFlow` lean on (issue #189): a
    // draft shaped by this helper, compared against itself, reports no
    // changes — this is what makes "identical to the latest version" a real
    // question rather than one the shapes themselves could answer wrongly.
    const flow = { won_stage_id: "s-won", sale_type_id: "st-1" }
    const stages = [stage("s-lead", "Lead", 10), stage("s-won", "Awarded", 20)]
    const edges = [edge("s-lead", "s-won")]
    const draft = buildDraftSnapshotData({ flow, stages, edges, actions: [], conditions: [] })

    expect(diffFlowSnapshots(draft, draft).hasChanges).toBe(false)
  })
})

describe("comparing two Flow Snapshots", () => {
  const base = {
    stages: [stage("s-lead", "Lead", 10), stage("s-qualified", "Qualified", 20)],
    edges: [edge("s-lead", "s-qualified")],
    actions: [{ id: "a-1", stage_id: "s-lead", kind: "create_group_task", config: { title: "Kickoff" } }],
    conditions: [{ id: "c-1", stage_id: "s-qualified", kind: "field", config: { column: "contact_person" } }],
    wonStageId: "s-qualified",
  }

  it("reports no changes between two identical snapshots", () => {
    const diff = diffFlowSnapshots(base, base)

    expect(diff.hasChanges).toBe(false)
    expect(diff.stages).toEqual({ added: [], removed: [], changed: [] })
    expect(diff.edges).toEqual({ added: [], removed: [] })
    expect(diff.actions).toEqual({ added: [], removed: [], changed: [] })
    expect(diff.conditions).toEqual({ added: [], removed: [], changed: [] })
    expect(diff.accessFlow).toEqual({ added: [], removed: [], changed: [] })
    expect(diff.accessStages).toEqual({ added: [], removed: [], changed: [] })
    expect(diff.wonStageChanged).toBe(false)
  })

  it("reports a Stage added", () => {
    const next = { ...base, stages: [...base.stages, stage("s-won", "Awarded", 30)] }

    const diff = diffFlowSnapshots(base, next)
    expect(diff.hasChanges).toBe(true)
    expect(diff.stages.added.map((s) => s.name)).toEqual(["Awarded"])
    expect(diff.stages.removed).toEqual([])
  })

  it("reports a Stage removed", () => {
    const next = { ...base, stages: base.stages.filter((s) => s.id !== "s-qualified") }

    const diff = diffFlowSnapshots(base, next)
    expect(diff.stages.removed.map((s) => s.name)).toEqual(["Qualified"])
  })

  it("reports a Stage renamed as changed, not as removed-and-added", () => {
    const next = {
      ...base,
      stages: base.stages.map((s) => (s.id === "s-qualified" ? { ...s, name: "Vetted" } : s)),
    }

    const diff = diffFlowSnapshots(base, next)
    expect(diff.stages.added).toEqual([])
    expect(diff.stages.removed).toEqual([])
    expect(diff.stages.changed).toEqual([
      { id: "s-qualified", before: base.stages[1], after: next.stages[1] },
    ])
  })

  it("does not report a Stage as changed when only layout coordinates or database timestamps differ", () => {
    const next = {
      ...base,
      stages: base.stages.map((s) => ({
        ...s,
        pos_x: 240,
        pos_y: 180,
        updated_at: "2026-09-11T12:00:00Z",
        created_at: "2026-09-11T10:00:00Z",
      })),
    }

    const diff = diffFlowSnapshots(base, next)
    expect(diff.stages.changed).toEqual([])
    expect(diff.hasChanges).toBe(false)
  })

  it("does not report changes when object keys are reordered (e.g. by PostgreSQL JSONB)", () => {
    const reorderedStages = base.stages.map((s) => {
      const inverted = {}
      Object.keys(s).reverse().forEach((k) => {
        inverted[k] = s[k]
      })
      return inverted
    })

    const next = { ...base, stages: reorderedStages }
    const diff = diffFlowSnapshots(base, next)
    expect(diff.stages.changed).toEqual([])
    expect(diff.hasChanges).toBe(false)
  })

  it("reports an edge added", () => {
    const next = { ...base, edges: [...base.edges, edge("s-qualified", "s-lead")] }

    const diff = diffFlowSnapshots(base, next)
    expect(diff.edges.added).toEqual([edge("s-qualified", "s-lead")])
    expect(diff.edges.removed).toEqual([])
  })

  it("reports an edge removed", () => {
    const next = { ...base, edges: [] }

    const diff = diffFlowSnapshots(base, next)
    expect(diff.edges.removed).toEqual(base.edges)
    expect(diff.edges.added).toEqual([])
  })

  it("reports a Stage Action's config changed", () => {
    const next = {
      ...base,
      actions: [{ ...base.actions[0], config: { title: "Kickoff call" } }],
    }

    const diff = diffFlowSnapshots(base, next)
    expect(diff.actions.changed).toEqual([
      { id: "a-1", before: base.actions[0], after: next.actions[0] },
    ])
    expect(diff.actions.added).toEqual([])
    expect(diff.actions.removed).toEqual([])
  })

  it("reports the flow-level Access row added, changed, and removed", () => {
    const withAccess = { ...base, access: { flow: { alwaysSees: [{ type: "role", role: "deal_owner" }] }, stages: [] } }

    const added = diffFlowSnapshots(base, withAccess)
    expect(added.hasChanges).toBe(true)
    expect(added.accessFlow.added).toEqual([{ id: "flow", alwaysSees: [{ type: "role", role: "deal_owner" }] }])

    const changed = diffFlowSnapshots(withAccess, {
      ...withAccess,
      access: { flow: { alwaysSees: [], journeyViewers: [{ type: "role", role: "sales_director" }] }, stages: [] },
    })
    expect(changed.accessFlow.changed).toHaveLength(1)

    const removed = diffFlowSnapshots(withAccess, base)
    expect(removed.accessFlow.removed).toEqual([{ id: "flow", alwaysSees: [{ type: "role", role: "deal_owner" }] }])
  })

  it("reports a Stage's Access row added and changed, matched by stage id", () => {
    const withStageAccess = {
      ...base,
      access: { flow: null, stages: [{ id: "s-lead", shutOutRoles: ["registrar"], excludedGroupIds: [] }] },
    }

    const added = diffFlowSnapshots(base, withStageAccess)
    expect(added.hasChanges).toBe(true)
    expect(added.accessStages.added).toEqual([
      { id: "s-lead", shutOutRoles: ["registrar"], excludedGroupIds: [] },
    ])

    const next = {
      ...withStageAccess,
      access: {
        flow: null,
        stages: [{ id: "s-lead", shutOutRoles: ["registrar", "closing_sales"], excludedGroupIds: [] }],
      },
    }
    const changed = diffFlowSnapshots(withStageAccess, next)
    expect(changed.accessStages.changed).toHaveLength(1)
  })

  it("reports a Stage Condition added and one removed", () => {
    const next = {
      ...base,
      conditions: [{ id: "c-2", stage_id: "s-lead", kind: "tickbox", config: {} }],
    }

    const diff = diffFlowSnapshots(base, next)
    expect(diff.conditions.added).toEqual(next.conditions)
    expect(diff.conditions.removed).toEqual(base.conditions)
    expect(diff.conditions.changed).toEqual([])
  })

  it("reports a Stage Field added and one changed", () => {
    const withField = {
      ...base,
      stageFields: [{ id: "f-1", stage_id: "s-lead", label: "Award amount", source: "custom" }],
    }
    const next = {
      ...withField,
      stageFields: [{ id: "f-1", stage_id: "s-lead", label: "Award amount (PHP)", source: "custom" }],
    }

    const added = diffFlowSnapshots(base, withField)
    expect(added.stageFields.added).toEqual(withField.stageFields)
    expect(added.hasChanges).toBe(true)

    const changed = diffFlowSnapshots(withField, next)
    expect(changed.stageFields.changed).toEqual([
      { id: "f-1", before: withField.stageFields[0], after: next.stageFields[0] },
    ])
  })

  it("reports the Won Stage changing", () => {
    const next = { ...base, wonStageId: "s-lead" }

    const diff = diffFlowSnapshots(base, next)
    expect(diff.wonStageChanged).toBe(true)
    expect(diff.hasChanges).toBe(true)
  })
})

// Issue #191 — reading a Stage's rules out of a Flow Snapshot for the
// read-only version page, whichever shape the snapshot stored them in.
describe("a Stage's rules as recorded in a Flow Snapshot", () => {
  const flatConditions = [
    { id: "c1", stage_id: "s1", kind: "field", label: "PO date" },
    { id: "c2", stage_id: "s2", kind: "attachment", label: "NOA" },
    { id: "c3", stage_id: "s1", kind: "tickbox", label: "Checked" },
  ]
  const groupedConditions = {
    s1: [
      { id: "c1", stage_id: "s1", kind: "field", label: "PO date" },
      { id: "c3", stage_id: "s1", kind: "tickbox", label: "Checked" },
    ],
    s2: [{ id: "c2", stage_id: "s2", kind: "attachment", label: "NOA" }],
  }

  it("filters a flat array to the Stage asked for", () => {
    expect(conditionsForSnapshotStage(flatConditions, "s1").map((c) => c.id)).toEqual(["c1", "c3"])
  })

  it("flattens the older per-Stage-keyed shape before filtering", () => {
    expect(conditionsForSnapshotStage(groupedConditions, "s1").map((c) => c.id)).toEqual([
      "c1",
      "c3",
    ])
    expect(actionsForSnapshotStage(groupedConditions, "s2").map((c) => c.id)).toEqual(["c2"])
  })

  it("treats a missing or empty rule set as no rules", () => {
    expect(snapshotRows(undefined)).toEqual([])
    expect(snapshotRows(null)).toEqual([])
    expect(snapshotRows({})).toEqual([])
    expect(conditionsForSnapshotStage(undefined, "s1")).toEqual([])
  })
})

// Issue #178.
describe("stageActionTaskTitle", () => {
  it("brackets the Sales Reference and the project name", () => {
    expect(
      stageActionTaskTitle({ salesReference: "S01234", projectTitle: "Fire truck supply" }),
    ).toBe("[S01234] [Fire truck supply]")
  })

  it("names the missing Sales Reference rather than leaving it blank", () => {
    expect(stageActionTaskTitle({ salesReference: null, projectTitle: "Fire truck supply" })).toBe(
      "[No Sales Reference] [Fire truck supply]",
    )
  })

  it("names the missing project title rather than leaving it blank", () => {
    expect(stageActionTaskTitle({ salesReference: "S01234", projectTitle: "" })).toBe(
      "[S01234] [Untitled Project]",
    )
  })

  it("keeps a long project name intact", () => {
    const long = "A".repeat(200)
    expect(stageActionTaskTitle({ salesReference: "S01234", projectTitle: long })).toBe(
      `[S01234] [${long}]`,
    )
  })

  it("does not strip pattern-breaking characters from the project name", () => {
    const weird = '[PR #2] "Quoted" & <tag> — em-dash'
    expect(stageActionTaskTitle({ salesReference: "S01234", projectTitle: weird })).toBe(
      `[S01234] [${weird}]`,
    )
  })

  it("neither argument required", () => {
    expect(stageActionTaskTitle()).toBe("[No Sales Reference] [Untitled Project]")
  })
})

// Issue #192.
describe("countFlowSnapshotChanges", () => {
  it("is zero for no diff and for a diff with no changes", () => {
    expect(countFlowSnapshotChanges(null)).toBe(0)
    expect(countFlowSnapshotChanges(diffFlowSnapshots({}, {}))).toBe(0)
  })

  it("sums added, removed and changed across every group plus the Won Stage flag", () => {
    const before = {
      stages: [{ id: "s1", name: "Lead" }],
      edges: [{ id: "e1", from_stage_id: "s1", to_stage_id: "s1" }],
      actions: [],
      conditions: [],
      wonStageId: "s1",
    }
    const after = {
      stages: [{ id: "s1", name: "Lead Renamed" }, { id: "s2", name: "Awarded" }],
      edges: [],
      actions: [{ id: "a1", stage_id: "s2", kind: "task" }],
      conditions: [{ id: "c1", stage_id: "s2", kind: "gate" }],
      wonStageId: "s2",
    }
    // 1 changed stage + 1 added stage, 1 removed edge, 1 added action,
    // 1 added condition, 1 Won Stage change = 6.
    expect(countFlowSnapshotChanges(diffFlowSnapshots(before, after))).toBe(6)
  })
})

describe("classifyFlowStage, isPreWonFlowStage, and isWonOrPostWonFlowStage", () => {
  const stages = [
    { id: "s-lead", name: "Lead", sort_order: 0, is_terminal: false },
    { id: "s-prop", name: "Proposal", sort_order: 1, is_terminal: false },
    { id: "s-won", name: "Won", sort_order: 2, is_terminal: false },
    { id: "s-deliv", name: "Delivery", sort_order: 3, is_terminal: false },
    { id: "s-close", name: "Closed Won", sort_order: 4, is_terminal: true },
    { id: "s-lost", name: "Closed Lost", sort_order: 5, is_terminal: true },
  ]
  const edges = [
    { from_stage_id: "s-lead", to_stage_id: "s-prop" },
    { from_stage_id: "s-prop", to_stage_id: "s-won" },
    { from_stage_id: "s-prop", to_stage_id: "s-lost" },
    { from_stage_id: "s-won", to_stage_id: "s-deliv" },
    { from_stage_id: "s-deliv", to_stage_id: "s-close" },
  ]
  const snapshotData = { stages, edges, wonStageId: "s-won" }

  it("classifies pre-won stages as PRE_WON and Open Pipeline", () => {
    const lead = stages.find((s) => s.id === "s-lead")
    const prop = stages.find((s) => s.id === "s-prop")
    expect(classifyFlowStage("s-lead", snapshotData)).toBe("PRE_WON")
    expect(classifyFlowStage("s-prop", snapshotData)).toBe("PRE_WON")
    expect(isPreWonFlowStage(lead, snapshotData)).toBe(true)
    expect(isPreWonFlowStage(prop, snapshotData)).toBe(true)
    expect(isWonOrPostWonFlowStage(lead, snapshotData)).toBe(false)
    expect(isWonOrPostWonFlowStage(prop, snapshotData)).toBe(false)
  })

  it("classifies the won stage as WON", () => {
    const won = stages.find((s) => s.id === "s-won")
    expect(classifyFlowStage("s-won", snapshotData)).toBe("WON")
    expect(isWonOrPostWonFlowStage(won, snapshotData)).toBe(true)
    expect(isPreWonFlowStage(won, snapshotData)).toBe(false)
  })

  it("classifies downstream post-won stages as POST_WON", () => {
    const deliv = stages.find((s) => s.id === "s-deliv")
    expect(classifyFlowStage("s-deliv", snapshotData)).toBe("POST_WON")
    expect(isWonOrPostWonFlowStage(deliv, snapshotData)).toBe(true)
    expect(isPreWonFlowStage(deliv, snapshotData)).toBe(false)
  })

  it("classifies terminal non-won stages as LOST (neither pre-won nor won)", () => {
    const lost = stages.find((s) => s.id === "s-lost")
    const close = stages.find((s) => s.id === "s-close")
    expect(classifyFlowStage("s-lost", snapshotData)).toBe("LOST")
    expect(classifyFlowStage("s-close", snapshotData)).toBe("LOST")
    expect(isPreWonFlowStage(lost, snapshotData)).toBe(false)
    expect(isWonOrPostWonFlowStage(lost, snapshotData)).toBe(false)
    expect(isPreWonFlowStage(close, snapshotData)).toBe(false)
    expect(isWonOrPostWonFlowStage(close, snapshotData)).toBe(false)
  })

  it("counts a Terminal Stage marked as ending won (Closed Won) as POST_WON, not LOST", () => {
    const closedWon = { ...stages[4], terminal_outcome: "won" }
    const marked = stages.map((s) => (s.id === "s-close" ? closedWon : s))
    const data = { ...snapshotData, stages: marked }
    expect(classifyFlowStage("s-close", data)).toBe("POST_WON")
    expect(isWonOrPostWonFlowStage(closedWon, data)).toBe(true)
    expect(isLostFlowStage(closedWon, "s-won")).toBe(false)
  })

  it("keeps a Terminal Stage marked as ending lost, or unmarked, as LOST", () => {
    const closedLost = { ...stages[5], terminal_outcome: "lost" }
    expect(isLostFlowStage(closedLost, "s-won")).toBe(true)
    expect(isLostFlowStage(stages[4], "s-won")).toBe(true)
    expect(endsAsWon(stages[4])).toBe(false)
  })

  it("ignores an outcome on a Stage that isn't terminal", () => {
    expect(endsAsWon({ id: "x", is_terminal: false, terminal_outcome: "won" })).toBe(false)
  })

  it("classifies a terminal won stage as WON, not LOST", () => {
    const termWon = { ...stages[2], is_terminal: true }
    const customStages = stages.map((s) => (s.id === "s-won" ? termWon : s))
    expect(classifyFlowStage("s-won", { ...snapshotData, stages: customStages })).toBe("WON")
  })

  it("evaluates stages dynamically in loops: a deal moved back to proposal is PRE_WON", () => {
    const loopingEdges = [
      ...edges,
      { from_stage_id: "s-won", to_stage_id: "s-prop" },
    ]
    expect(classifyFlowStage("s-prop", { stages, edges: loopingEdges, wonStageId: "s-won" })).toBe("PRE_WON")
  })

  it("falls back to relative order when edges are empty", () => {
    const noEdgesData = { stages, edges: [], wonStageId: "s-won" }
    expect(classifyFlowStage("s-lead", noEdgesData)).toBe("PRE_WON")
    expect(classifyFlowStage("s-won", noEdgesData)).toBe("WON")
    expect(classifyFlowStage("s-deliv", noEdgesData)).toBe("POST_WON")
  })

  it("handles missing or unknown stages gracefully", () => {
    expect(classifyFlowStage("non-existent", snapshotData)).toBe(null)
    expect(classifyFlowStage(null, snapshotData)).toBe(null)
    expect(isPreWonFlowStage(null, snapshotData)).toBe(false)
    expect(isWonOrPostWonFlowStage(null, snapshotData)).toBe(false)
  })

  it("defaults to PRE_WON for all non-terminal stages when wonStageId is null", () => {
    const draftData = { stages, edges, wonStageId: null }
    expect(classifyFlowStage("s-lead", draftData)).toBe("PRE_WON")
    expect(classifyFlowStage("s-won", draftData)).toBe("PRE_WON")
    expect(classifyFlowStage("s-deliv", draftData)).toBe("PRE_WON")
    expect(classifyFlowStage("s-lost", draftData)).toBe("LOST")
  })
})

describe("flowPublishWarnings (#463)", () => {
  const stage = (id, name, sort_order, extra = {}) => ({ id, name, sort_order, is_terminal: false, ...extra })
  const edge = (from, to) => ({ from_stage_id: from, to_stage_id: to })
  const stages = [stage("a", "Lead", 0), stage("b", "Sourcing", 1), stage("c", "Bidding", 2), stage("d", "Submitted", 3)]
  const chain = [edge("a", "b"), edge("b", "c"), edge("c", "d")]
  const condition = (kind) => [{ kind }]
  const opens = [{ kind: "open_costing_matrix" }]

  it("says nothing when the flow has no costing condition", () => {
    expect(flowPublishWarnings({ stages, edges: chain })).toEqual([])
  })

  it("warns for a costing condition reachable without an Open Costing Matrix", () => {
    const warnings = flowPublishWarnings({ stages, edges: chain, conditionsByStage: { c: condition("costing_priced") } })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/^Bidding /)
  })

  it("warns for Costing settled too, once per Stage", () => {
    const warnings = flowPublishWarnings({
      stages,
      edges: chain,
      conditionsByStage: { c: [{ kind: "costing_priced" }, { kind: "costing_settled" }], d: condition("costing_settled") },
    })
    expect(warnings.map((w) => w.split(" ")[0])).toEqual(["Bidding", "Submitted"])
  })

  it("is quiet when every path passes a Stage that opens the matrix", () => {
    expect(
      flowPublishWarnings({ stages, edges: chain, conditionsByStage: { d: condition("costing_settled") }, actionsByStage: { b: opens } }),
    ).toEqual([])
  })

  it("counts the Stage that opens the matrix itself as covered", () => {
    expect(
      flowPublishWarnings({ stages, edges: chain, conditionsByStage: { c: condition("costing_priced") }, actionsByStage: { c: opens } }),
    ).toEqual([])
  })

  it("warns when only some paths pass the opening Stage", () => {
    const edges = [edge("a", "b"), edge("b", "d"), edge("a", "c"), edge("c", "d")]
    const warnings = flowPublishWarnings({
      stages,
      edges,
      conditionsByStage: { d: condition("costing_settled") },
      actionsByStage: { b: opens },
    })
    expect(warnings).toHaveLength(1)
  })

  it("ignores other conditions and other actions", () => {
    expect(
      flowPublishWarnings({
        stages,
        edges: chain,
        conditionsByStage: { c: condition("attachment") },
        actionsByStage: { b: [{ kind: "create_individual_task" }] },
      }),
    ).toEqual([])
  })

  it("does not warn about a Stage no path reaches (that is a lock blocker)", () => {
    expect(flowPublishWarnings({ stages, edges: [edge("a", "b")], conditionsByStage: { d: condition("costing_settled") } })).toEqual([])
  })
})
