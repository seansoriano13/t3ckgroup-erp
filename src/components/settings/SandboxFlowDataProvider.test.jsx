import { useEffect } from "react"
import { act, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { renderWithProviders } from "@/test/support"
import { db } from "@/test/db/store"
import { makeSuperAdmin } from "@/test/factories"
import { SandboxFlowDataProvider } from "./SandboxFlowDataProvider"
import { useFlowData } from "./FlowDataContext"

/**
 * The provider is the adapter between what `FlowCanvas` calls and what a Flow
 * Plan's document holds. What matters here is that the canvas cannot tell the
 * difference: the same call signatures, the same row shapes coming back — and
 * a plan id as the presence scope, which is what puts live cursors on plans
 * rather than on the operational canvas (#117).
 */
describe("SandboxFlowDataProvider", () => {
  const seedPlan = () =>
    db.seed("flow_plans", { name: "Q4 rework", created_by: makeSuperAdmin().id })

  /**
   * Every write here changes the document, which bumps the provider's revision
   * — a React state update, so it has to happen inside `act`.
   */
  async function write(run) {
    let result
    await act(async () => {
      result = await run()
    })
    return result
  }

  /** Renders the provider and hands the context back once it has loaded. */
  async function mountPlan() {
    const plan = seedPlan()
    const captured = { current: null }

    function Consumer() {
      const flowData = useFlowData()
      useEffect(() => {
        captured.current = flowData
      }, [flowData])
      return null
    }

    renderWithProviders(
      <SandboxFlowDataProvider planId={plan.id}>
        <Consumer />
      </SandboxFlowDataProvider>,
    )

    await waitFor(() => expect(captured.current).not.toBeNull())
    return { plan, context: captured.current }
  }

  it("scopes presence to the plan being viewed", async () => {
    const { plan, context } = await mountPlan()

    expect(context.presenceScope).toBe(plan.id)
  })

  it("serves a stage the canvas added back to the canvas", async () => {
    const { context } = await mountPlan()

    await write(() => context.salesFlow.addStage("flow-1", "Qualified", "author", 40, 80))

    const { stages } = await context.salesFlow.getFlow("sandbox")
    expect(stages).toEqual([
      expect.objectContaining({ name: "Qualified", pos_x: 40, pos_y: 80 }),
    ])
  })

  it("stores a condition under the column names every reader expects", async () => {
    // The service takes `stageId`/`isRequired`; the components that render a
    // condition read `stage_id`/`is_required`. A plan is read by exactly those
    // components, so the payload has to be translated, not passed through.
    const { context } = await mountPlan()
    const stage = await write(() => context.salesFlow.addStage("flow-1", "Qualified", "author", 0, 0))

    await write(() =>
      context.stageCondition.add({
        stageId: stage.id,
        kind: "field",
        label: "  Budget confirmed  ",
        isRequired: true,
        config: { column: "amount" },
      }),
    )

    const conditions = await context.stageCondition.getForStage(stage.id)
    expect(conditions).toEqual([
      expect.objectContaining({
        stage_id: stage.id,
        kind: "field",
        label: "Budget confirmed",
        is_required: true,
        config: { column: "amount" },
      }),
    ])
  })

  it("stores an action under the column names every reader expects", async () => {
    const { context } = await mountPlan()
    const stage = await write(() => context.salesFlow.addStage("flow-1", "Qualified", "author", 0, 0))

    const action = await write(() => context.stageAction.add({ stageId: stage.id, kind: "NOTIFY" }))
    await write(() => context.stageAction.update(action.id, { to: "sales" }))

    expect(await context.stageAction.getForStage(stage.id)).toEqual([
      expect.objectContaining({ stage_id: stage.id, kind: "NOTIFY", config: { to: "sales" } }),
    ])
  })

  it("takes a stage's edges, conditions and actions with it when the stage is deleted", async () => {
    const { context } = await mountPlan()
    const from = await write(() => context.salesFlow.addStage("flow-1", "Lead", "author", 0, 0))
    const to = await write(() => context.salesFlow.addStage("flow-1", "Won", "author", 200, 0))
    await write(() => context.salesFlow.addEdge("flow-1", from.id, to.id))
    await write(() => context.stageCondition.add({ stageId: from.id, kind: "field", label: "Budget" }))

    await write(() => context.salesFlow.deleteStage(from.id))

    const { stages, edges } = await context.salesFlow.getFlow("sandbox")
    expect(stages.map((s) => s.id)).toEqual([to.id])
    expect(edges).toEqual([])
    expect(await context.stageCondition.getForStage(from.id)).toEqual([])
  })

  it("groups conditions by stage the way the canvas reads them in one batch", async () => {
    const { context } = await mountPlan()
    const first = await write(() => context.salesFlow.addStage("flow-1", "Lead", "author", 0, 0))
    const second = await write(() => context.salesFlow.addStage("flow-1", "Won", "author", 200, 0))
    await write(() => context.stageCondition.add({ stageId: first.id, kind: "field", label: "Budget" }))

    const grouped = await context.stageCondition.getForStages([first.id, second.id])

    expect(grouped[first.id]).toHaveLength(1)
    expect(grouped[second.id]).toEqual([])
  })

  it("opens a plan that was saved before the document existed", async () => {
    // The first cut of the sandbox wrote JSON into the same column. Those rows
    // still have to open.
    const legacy = {
      flow: { id: "flow-1", sale_type_id: "sandbox", won_stage_id: null, state: "draft" },
      stages: [{ id: "stage-1", name: "Lead", pos_x: 0, pos_y: 0 }],
      edges: [],
      conditions: [],
      actions: [],
    }
    const hex = [...new TextEncoder().encode(JSON.stringify(legacy))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    const plan = db.seed("flow_plans", {
      name: "Legacy plan",
      created_by: makeSuperAdmin().id,
      yjs_state: `\\x${hex}`,
    })

    const captured = { current: null }
    function Consumer() {
      const flowData = useFlowData()
      useEffect(() => {
        captured.current = flowData
      }, [flowData])
      return null
    }

    renderWithProviders(
      <SandboxFlowDataProvider planId={plan.id}>
        <Consumer />
      </SandboxFlowDataProvider>,
    )
    await waitFor(() => expect(captured.current).not.toBeNull())

    const { stages } = await captured.current.salesFlow.getFlow("sandbox")
    expect(stages.map((s) => s.name)).toEqual(["Lead"])
  })
})
