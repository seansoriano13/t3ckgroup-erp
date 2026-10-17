import { beforeEach, describe, expect, it } from "vitest"
import { opportunityService } from "./opportunityService"
import { db } from "@/test/db/store"
import {
  makeEmployee,
  makeFlowEdge,
  makeFlowSnapshot,
  makeFlowStage,
  makeOpportunity,
  makeSaleType,
  makeSalesFlow,
  makeStageAction,
  seedPipeline,
} from "@/test/factories"
import { stubActionRunRpcs } from "@/test/stubs/actionRunRpc"

/**
 * Open Costing Matrix (#462) through a real Stage move, against the fake database: the move runs the
 * action's `sor_run_stage_actions` branch (re-implemented on the store in actionRunRpc.js) and the
 * Optional Action path calls `sor_open_costing_matrix` after a Decider's Create. That the real
 * plpgsql does the same, and who may call it, is the policy tier's (84-open-costing-matrix-action).
 */
describe("Open Costing Matrix", () => {
  let owner, buyer, member, assigner, lead, qualified, snapshot, saleType, preset

  beforeEach(() => {
    seedPipeline()
    stubActionRunRpcs()
    owner = makeEmployee({ name: "Ben Cruz", department: "SALES" })
    buyer = makeEmployee({ name: "Rey Santos", department: "OPERATIONS", has_purchasing_flow: true })
    member = makeEmployee({ name: "Mia Lopez", department: "SALES" })
    assigner = makeEmployee({ name: "Raquel Dela Cruz", department: "OPERATIONS" })
    saleType = makeSaleType({ name: "Government" })
    const flow = makeSalesFlow({ sale_type_id: saleType.id })
    lead = makeFlowStage({ flow_id: flow.id, name: "Lead", sort_order: 0 })
    qualified = makeFlowStage({ flow_id: flow.id, name: "SO Evaluation", sort_order: 1 })
    makeFlowEdge(lead, qualified)
    preset = db.seed("costing_markup_presets", { label: "Government", factor: 1.35, sort: 0, active: true })
  })

  const dealOnLead = () => {
    snapshot = makeFlowSnapshot({ flow_id: lead.flow_id })
    return makeOpportunity({
      registered_by: owner.id,
      deal_owner_id: owner.id,
      sales_reference: "S00462",
      sale_type_id: saleType.id,
      flow_stage_id: lead.id,
      flow_snapshot_id: snapshot.id,
    })
  }

  const matricesOf = (deal) => db.internal.rowsOf("costing_matrices").filter((m) => m.opportunity_id === deal.id)
  const windowsOf = (deal) => db.internal.rowsOf("sor_stage_participants").filter((p) => p.opportunity_id === deal.id && p.source === "costing_matrix")
  const runOf = (deal, action) => db.internal.rowsOf("sor_action_runs").find((r) => r.opportunity_id === deal.id && r.action_id === action.id)

  it("opens the SOR's matrix on entering the Stage, with the configured Incharges, markup and members", async () => {
    const action = makeStageAction({
      stage_id: qualified.id,
      kind: "open_costing_matrix",
      config: {
        purchasingIncharge: { type: "employee", id: buyer.id },
        markupPresetId: preset.id,
        extras: [{ type: "employee", id: member.id }],
        access: { until: "terminal" },
      },
    })
    const deal = dealOnLead()

    const moved = await opportunityService.updateStatus(deal.id, qualified.id, owner.id)
    expect(moved.failedStageActions).toEqual([])

    const [matrix] = matricesOf(deal)
    expect(matricesOf(deal)).toHaveLength(1)
    expect(matrix.sales_incharge_id).toBe(owner.id)
    expect(matrix.purchasing_incharge_id).toBe(buyer.id)
    const money = db.internal.rowsOf("costing_matrix_money").find((m) => m.matrix_id === matrix.id)
    expect(Number(money.default_factor)).toBe(1.35)
    expect(money.default_preset_id).toBe(preset.id)

    const [window] = windowsOf(deal)
    expect(window).toMatchObject({ employee_id: member.id, source_id: matrix.id, until_rule: "terminal" })

    const run = runOf(deal, action)
    expect(run).toMatchObject({ outcome: "created", costing_matrix_id: matrix.id })

    const notes = db.internal.rowsOf("sales_opportunity_logs").filter((l) => l.metadata?.event === "STAGE_ACTION_COSTING_MATRIX_OPENED")
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ opportunity_id: deal.id })
    expect(notes[0].metadata).toMatchObject({ actionId: action.id, matrixId: matrix.id })
  })

  it("opens with no Purchasing Incharge and tells the people who assign it", async () => {
    makeStageAction({
      stage_id: qualified.id,
      kind: "open_costing_matrix",
      config: { assigners: [{ type: "employee", id: assigner.id }] },
    })
    const deal = dealOnLead()

    await opportunityService.updateStatus(deal.id, qualified.id, owner.id)

    const [matrix] = matricesOf(deal)
    expect(matrix.purchasing_incharge_id).toBeNull()
    const told = db.internal
      .rowsOf("notifications")
      .filter((n) => n.type === "OPPORTUNITY_COSTING_INCHARGE_NEEDED" && n.reference_id === deal.id)
    expect(told.map((n) => n.recipient_id)).toEqual([assigner.id])
  })

  it("a second action on the same SOR creates none, fills only what is empty and adds only missing members", async () => {
    makeStageAction({
      stage_id: qualified.id,
      kind: "open_costing_matrix",
      config: { extras: [{ type: "employee", id: member.id }] },
    })
    const later = makeFlowStage({ flow_id: lead.flow_id, name: "PMS Sourcing", sort_order: 2 })
    makeFlowEdge(qualified, later)
    const second = makeStageAction({
      stage_id: later.id,
      kind: "open_costing_matrix",
      config: {
        salesIncharge: { type: "employee", id: member.id },
        purchasingIncharge: { type: "employee", id: buyer.id },
        markupPresetId: preset.id,
        extras: [
          { type: "employee", id: member.id },
          { type: "employee", id: assigner.id },
        ],
      },
    })
    const deal = dealOnLead()

    await opportunityService.updateStatus(deal.id, qualified.id, owner.id)
    const [first] = matricesOf(deal)
    const memberWindow = windowsOf(deal)[0]

    await opportunityService.updateStatus(deal.id, later.id, owner.id)

    const matrices = matricesOf(deal)
    expect(matrices).toHaveLength(1)
    expect(matrices[0].id).toBe(first.id)
    expect(matrices[0].sales_incharge_id).toBe(owner.id)
    expect(matrices[0].purchasing_incharge_id).toBe(buyer.id)
    const money = db.internal.rowsOf("costing_matrix_money").find((m) => m.matrix_id === first.id)
    expect(Number(money.default_factor)).toBe(1.35)

    // The first Stage's window closed with it. The second Stage calls the member in again with a window of its
    // own and the assigner in for the first time; the closed window is left as it was.
    const open = windowsOf(deal).filter((w) => !w.closed_at)
    expect(open.map((w) => w.employee_id).sort()).toEqual([assigner.id, member.id].sort())
    expect(windowsOf(deal)).toHaveLength(3)
    expect(windowsOf(deal).find((w) => w.id === memberWindow.id)).toMatchObject({ closed_at: expect.any(String) })
    expect(runOf(deal, second)).toMatchObject({ outcome: "created", costing_matrix_id: first.id })
  })

  it("waits for a Decider when it is an Optional Action, and opens on Create", async () => {
    const action = makeStageAction({
      stage_id: qualified.id,
      kind: "open_costing_matrix",
      config: { confirmMode: "confirm", purchasingIncharge: { type: "employee", id: buyer.id } },
    })
    const deal = dealOnLead()

    await opportunityService.updateStatus(deal.id, qualified.id, owner.id)
    expect(matricesOf(deal)).toHaveLength(0)

    const pending = await opportunityService.getPendingActionsForActor(deal.id, owner.id)
    expect(pending).toHaveLength(1)
    expect(pending[0].target).toEqual({ kind: "costing_matrix" })

    await opportunityService.decideAction(pending[0].runId, "create", owner.id)

    const [matrix] = matricesOf(deal)
    expect(matrix.purchasing_incharge_id).toBe(buyer.id)
    expect(runOf(deal, action)).toMatchObject({ outcome: "created", costing_matrix_id: matrix.id })
  })

  it("creates nothing when the Decider skips", async () => {
    makeStageAction({ stage_id: qualified.id, kind: "open_costing_matrix", config: { confirmMode: "confirm" } })
    const deal = dealOnLead()

    await opportunityService.updateStatus(deal.id, qualified.id, owner.id)
    const [pending] = await opportunityService.getPendingActionsForActor(deal.id, owner.id)
    await opportunityService.decideAction(pending.runId, "skip", owner.id)

    expect(matricesOf(deal)).toHaveLength(0)
  })

  it("an SOR whose flow never runs the action has no matrix", async () => {
    makeStageAction({ stage_id: qualified.id, kind: "create_individual_task", config: { title: "Check" } })
    const deal = dealOnLead()

    await opportunityService.updateStatus(deal.id, qualified.id, owner.id)

    expect(matricesOf(deal)).toHaveLength(0)
    expect(db.internal.rowsOf("costing_matrix_money")).toHaveLength(0)
  })
})
