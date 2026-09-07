import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  addEdge,
  addStage,
  addStageAction,
  addStageCondition,
  createFlowPlanDoc,
  deleteStage,
  encodeFlowPlanState,
  loadFlowPlanState,
  readFlowPlan,
  removeEdge,
  removeStageAction,
  removeStageCondition,
  reorderStageConditions,
  reorderStages,
  setWonStage,
  updateStage,
  updateStageAction,
} from "./flowPlanDoc"

/**
 * A Flow Plan is a shared document, not a set of rows: two people work on one
 * plan at the same time and both keep their work. Every test here is two docs
 * exchanging updates, which is the whole of the concurrency contract — and it
 * runs without a realtime connection, because the merge is the CRDT's job and
 * the transport's only job is delivery.
 */
describe("flowPlanDoc", () => {
  /** Delivers everything each doc knows to the other, in both directions. */
  const sync = (...docs) => {
    const merged = new Y.Doc()
    for (const doc of docs) Y.applyUpdate(merged, Y.encodeStateAsUpdate(doc))
    const state = Y.encodeStateAsUpdate(merged)
    for (const doc of docs) Y.applyUpdate(doc, state)
  }

  const stageNames = (doc) => readFlowPlan(doc).stages.map((s) => s.name)

  it("reads a new plan as an empty flow", () => {
    const plan = readFlowPlan(createFlowPlanDoc())

    expect(plan.stages).toEqual([])
    expect(plan.edges).toEqual([])
    expect(plan.conditions).toEqual([])
    expect(plan.actions).toEqual([])
    expect(plan.flow.won_stage_id).toBeNull()
  })

  it("reads back a stage that was added", () => {
    const doc = createFlowPlanDoc()

    const stage = addStage(doc, { name: "Qualified", pos_x: 40, pos_y: 80 })

    expect(readFlowPlan(doc).stages).toEqual([
      expect.objectContaining({ id: stage.id, name: "Qualified", pos_x: 40, pos_y: 80, sort_order: 0 }),
    ])
  })

  describe("two people on one plan", () => {
    it("keeps both edits when one adds a stage while the other moves a different one", () => {
      const ana = createFlowPlanDoc()
      const ben = createFlowPlanDoc()
      const existing = addStage(ana, { name: "Lead" })
      sync(ana, ben)

      addStage(ana, { name: "Qualified" })
      updateStage(ben, existing.id, { pos_x: 300, pos_y: 120 })
      sync(ana, ben)

      for (const doc of [ana, ben]) {
        const plan = readFlowPlan(doc)
        expect(plan.stages.map((s) => s.name)).toEqual(["Lead", "Qualified"])
        expect(plan.stages[0]).toMatchObject({ pos_x: 300, pos_y: 120 })
      }
    })

    it("propagates a rename and a delete between sessions", () => {
      const ana = createFlowPlanDoc()
      const ben = createFlowPlanDoc()
      const keep = addStage(ana, { name: "Lead" })
      const drop = addStage(ana, { name: "Scrapped" })
      sync(ana, ben)

      updateStage(ana, keep.id, { name: "Qualified Lead" })
      deleteStage(ben, drop.id)
      sync(ana, ben)

      expect(stageNames(ana)).toEqual(["Qualified Lead"])
      expect(stageNames(ben)).toEqual(["Qualified Lead"])
    })

    it("settles a simultaneous rename of one stage on the same answer in both sessions", () => {
      const ana = createFlowPlanDoc()
      const ben = createFlowPlanDoc()
      const stage = addStage(ana, { name: "Lead" })
      sync(ana, ben)

      // Neither has seen the other's rename when they make it.
      updateStage(ana, stage.id, { name: "Ana's name" })
      updateStage(ben, stage.id, { name: "Ben's name" })
      sync(ana, ben)

      expect(stageNames(ana)).toEqual(stageNames(ben))
      expect(["Ana's name", "Ben's name"]).toContain(stageNames(ana)[0])
    })

    it("reconciles a session that was away rather than clobbering what happened while it was gone", () => {
      const ana = createFlowPlanDoc()
      const ben = createFlowPlanDoc()
      const shared = addStage(ana, { name: "Lead" })
      sync(ana, ben)

      // Ben drops off. Ana keeps working; Ben edits from his stale copy.
      addStage(ana, { name: "Qualified" })
      updateStage(ana, shared.id, { pos_x: 500 })
      updateStage(ben, shared.id, { name: "Renamed while offline" })

      // Ben comes back and the two exchange what each missed.
      sync(ana, ben)

      for (const doc of [ana, ben]) {
        const plan = readFlowPlan(doc)
        expect(plan.stages.map((s) => s.name)).toEqual(["Renamed while offline", "Qualified"])
        expect(plan.stages[0].pos_x).toBe(500)
      }
    })

    it("survives the same update being delivered twice", () => {
      const ana = createFlowPlanDoc()
      const ben = createFlowPlanDoc()
      addStage(ana, { name: "Lead" })

      const update = Y.encodeStateAsUpdate(ana)
      Y.applyUpdate(ben, update)
      Y.applyUpdate(ben, update)

      expect(stageNames(ben)).toEqual(["Lead"])
    })
  })

  describe("what gets stored", () => {
    it("round-trips the merged state, so reopening the plan shows what the session arrived at", () => {
      const ana = createFlowPlanDoc()
      const ben = createFlowPlanDoc()
      const lead = addStage(ana, { name: "Lead" })
      sync(ana, ben)
      const won = addStage(ben, { name: "Won" })
      addEdge(ana, lead.id, won.id)
      setWonStage(ben, won.id)
      sync(ana, ben)

      const reopened = createFlowPlanDoc()
      loadFlowPlanState(reopened, encodeFlowPlanState(ana))

      const plan = readFlowPlan(reopened)
      expect(plan.stages.map((s) => s.name)).toEqual(["Lead", "Won"])
      expect(plan.edges).toEqual([
        expect.objectContaining({ from_stage_id: lead.id, to_stage_id: won.id }),
      ])
      expect(plan.flow.won_stage_id).toBe(won.id)
    })

    it("loads a plan saved before the document existed, when the column held plain JSON", () => {
      // The first cut of the sandbox wrote JSON.stringify into yjs_state. Those
      // rows have to keep opening, so the loader reads them and seeds the doc.
      const legacy = new TextEncoder().encode(
        JSON.stringify({
          flow: { id: "flow-1", sale_type_id: "sandbox", won_stage_id: "stage-2", state: "draft" },
          stages: [
            { id: "stage-1", name: "Lead", pos_x: 0, pos_y: 0 },
            { id: "stage-2", name: "Won", pos_x: 200, pos_y: 0 },
          ],
          edges: [{ id: "edge-1", from_stage_id: "stage-1", to_stage_id: "stage-2" }],
          conditions: [{ id: "cond-1", stage_id: "stage-1", label: "Budget confirmed", sort_order: 0 }],
          actions: [],
        }),
      )

      const doc = createFlowPlanDoc()
      loadFlowPlanState(doc, legacy)

      const plan = readFlowPlan(doc)
      expect(plan.stages.map((s) => s.name)).toEqual(["Lead", "Won"])
      expect(plan.edges).toHaveLength(1)
      expect(plan.conditions[0].label).toBe("Budget confirmed")
      expect(plan.flow.won_stage_id).toBe("stage-2")
    })

    it("treats an absent state as a new, empty plan", () => {
      const doc = createFlowPlanDoc()
      loadFlowPlanState(doc, null)

      expect(readFlowPlan(doc).stages).toEqual([])
    })
  })

  describe("deleting a stage", () => {
    it("takes its edges, conditions and actions with it", () => {
      const doc = createFlowPlanDoc()
      const from = addStage(doc, { name: "Lead" })
      const to = addStage(doc, { name: "Won" })
      addEdge(doc, from.id, to.id)
      addStageCondition(doc, { stage_id: from.id, label: "Budget confirmed" })
      addStageAction(doc, { stage_id: from.id, kind: "NOTIFY" })

      deleteStage(doc, from.id)

      const plan = readFlowPlan(doc)
      expect(plan.stages.map((s) => s.id)).toEqual([to.id])
      expect(plan.edges).toEqual([])
      expect(plan.conditions).toEqual([])
      expect(plan.actions).toEqual([])
    })

    it("leaves a stage deleted when the other session was editing it at the same time", () => {
      const ana = createFlowPlanDoc()
      const ben = createFlowPlanDoc()
      const stage = addStage(ana, { name: "Lead" })
      sync(ana, ben)

      deleteStage(ana, stage.id)
      updateStage(ben, stage.id, { name: "Still editing" })
      sync(ana, ben)

      expect(readFlowPlan(ana).stages).toEqual(readFlowPlan(ben).stages)
      expect(readFlowPlan(ana).stages).toEqual([])
    })
  })

  describe("the rest of the plan", () => {
    it("adds and removes edges", () => {
      const doc = createFlowPlanDoc()
      const from = addStage(doc, { name: "Lead" })
      const to = addStage(doc, { name: "Won" })
      const edge = addEdge(doc, from.id, to.id)

      expect(readFlowPlan(doc).edges).toHaveLength(1)

      removeEdge(doc, edge.id)
      expect(readFlowPlan(doc).edges).toEqual([])
    })

    it("orders stages by the order the plan was given", () => {
      const doc = createFlowPlanDoc()
      const a = addStage(doc, { name: "A" })
      const b = addStage(doc, { name: "B" })
      const c = addStage(doc, { name: "C" })

      reorderStages(doc, [c.id, a.id, b.id])

      expect(stageNames(doc)).toEqual(["C", "A", "B"])
    })

    it("reorders a stage's conditions by the order given", () => {
      const doc = createFlowPlanDoc()
      const stage = addStage(doc, { name: "Lead" })
      const first = addStageCondition(doc, { stage_id: stage.id, label: "First" })
      const second = addStageCondition(doc, { stage_id: stage.id, label: "Second" })

      reorderStageConditions(doc, [
        { id: second.id, sortOrder: 0 },
        { id: first.id, sortOrder: 1 },
      ])

      expect(readFlowPlan(doc).conditions.map((c) => c.label)).toEqual(["Second", "First"])
    })

    it("keeps a stage's conditions and actions in their own sort order", () => {
      const doc = createFlowPlanDoc()
      const stage = addStage(doc, { name: "Lead" })
      const second = addStageCondition(doc, { stage_id: stage.id, label: "Second" })
      addStageCondition(doc, { stage_id: stage.id, label: "Third" })
      const action = addStageAction(doc, { stage_id: stage.id, kind: "NOTIFY" })

      updateStageAction(doc, action.id, { config: { to: "sales" } })
      removeStageCondition(doc, second.id)

      const plan = readFlowPlan(doc)
      expect(plan.conditions.map((c) => c.label)).toEqual(["Third"])
      expect(plan.actions[0].config).toEqual({ to: "sales" })

      removeStageAction(doc, action.id)
      expect(readFlowPlan(doc).actions).toEqual([])
    })
  })
})
