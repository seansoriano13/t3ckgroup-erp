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
 * Request Packing List (#464) through a real Stage move, against the fake database: the move runs the
 * action's `sor_run_stage_actions` branch (re-implemented on the store in actionRunRpc.js) and the
 * Optional Action path calls `sor_request_packing_list` after a Decider's Create. That the real plpgsql
 * does the same, and who may call it, is the policy tier's (101-request-packing-list).
 */
describe("Request Packing List", () => {
  let owner, packer, other, lead, packing, saleType

  beforeEach(() => {
    seedPipeline()
    stubActionRunRpcs()
    owner = makeEmployee({ name: "Ben Cruz", department: "SALES" })
    packer = makeEmployee({ name: "Pia Reyes", department: "OPERATIONS" })
    other = makeEmployee({ name: "Omar Diaz", department: "OPERATIONS" })
    saleType = makeSaleType({ name: "Government" })
    const flow = makeSalesFlow({ sale_type_id: saleType.id })
    lead = makeFlowStage({ flow_id: flow.id, name: "Lead", sort_order: 0 })
    packing = makeFlowStage({ flow_id: flow.id, name: "Project Delivery", sort_order: 1 })
    makeFlowEdge(lead, packing)
    db.seed("ipas_signer_lists", { list_key: "transmittal_warehouse", employee_id: packer.id })
  })

  const dealOnLead = () => {
    const snapshot = makeFlowSnapshot({ flow_id: lead.flow_id })
    return makeOpportunity({
      registered_by: owner.id,
      deal_owner_id: owner.id,
      sales_reference: "S00464",
      sale_type_id: saleType.id,
      flow_stage_id: lead.id,
      flow_snapshot_id: snapshot.id,
    })
  }

  const listsOf = (deal) => db.internal.rowsOf("packing_lists").filter((p) => p.opportunity_id === deal.id)
  const toldOf = (deal) =>
    db.internal
      .rowsOf("notifications")
      .filter((n) => n.type === "PACKING_LIST_REQUESTED" && listsOf(deal).some((p) => p.id === n.reference_id))
      .map((n) => n.recipient_id)
      .sort()
  const runOf = (deal, action) => db.internal.rowsOf("sor_action_runs").find((r) => r.opportunity_id === deal.id && r.action_id === action.id)

  it("creates one draft Packing List and tells the Warehouse list", async () => {
    const action = makeStageAction({ stage_id: packing.id, kind: "request_packing_list", config: {} })
    const deal = dealOnLead()

    const moved = await opportunityService.updateStatus(deal.id, packing.id, owner.id)
    expect(moved.failedStageActions).toEqual([])

    const [list] = listsOf(deal)
    expect(listsOf(deal)).toHaveLength(1)
    expect(list.state).toBe("draft")
    expect(toldOf(deal)).toEqual([packer.id])
    expect(runOf(deal, action)).toMatchObject({ outcome: "created", packing_list_id: list.id })

    const notes = db.internal.rowsOf("sales_opportunity_logs").filter((l) => l.metadata?.event === "STAGE_ACTION_PACKING_LIST_REQUESTED")
    expect(notes).toHaveLength(1)
    expect(notes[0].metadata).toMatchObject({ actionId: action.id, packingListId: list.id })
  })

  it("tells the config's people instead of the Warehouse list when it names some", async () => {
    makeStageAction({
      stage_id: packing.id,
      kind: "request_packing_list",
      config: { notify: [{ type: "employee", id: other.id }] },
    })
    const deal = dealOnLead()

    await opportunityService.updateStatus(deal.id, packing.id, owner.id)

    expect(listsOf(deal)).toHaveLength(1)
    expect(toldOf(deal)).toEqual([other.id])
  })

  it("creates nothing and tells nobody when the SOR already has an open Packing List", async () => {
    const action = makeStageAction({ stage_id: packing.id, kind: "request_packing_list", config: {} })
    const deal = dealOnLead()
    db.seed("packing_lists", { number: "PKL_001", opportunity_id: deal.id, state: "draft", created_by: owner.id })

    const moved = await opportunityService.updateStatus(deal.id, packing.id, owner.id)
    expect(moved.failedStageActions).toEqual([])

    expect(listsOf(deal)).toHaveLength(1)
    expect(toldOf(deal)).toEqual([])
    expect(runOf(deal, action)).toMatchObject({ outcome: "created" })
    expect(runOf(deal, action).packing_list_id ?? null).toBeNull()
  })

  it("a packed Packing List does not count as open, so a new draft is made", async () => {
    makeStageAction({ stage_id: packing.id, kind: "request_packing_list", config: {} })
    const deal = dealOnLead()
    db.seed("packing_lists", { number: "PKL_001", opportunity_id: deal.id, state: "packed", created_by: owner.id })

    await opportunityService.updateStatus(deal.id, packing.id, owner.id)

    expect(listsOf(deal).map((p) => p.state).sort()).toEqual(["draft", "packed"])
    expect(toldOf(deal)).toEqual([packer.id])
  })

  it("waits for a Decider when it is an Optional Action, and creates the draft on Create", async () => {
    const action = makeStageAction({
      stage_id: packing.id,
      kind: "request_packing_list",
      config: { confirmMode: "confirm" },
    })
    const deal = dealOnLead()

    await opportunityService.updateStatus(deal.id, packing.id, owner.id)
    expect(listsOf(deal)).toHaveLength(0)

    const pending = await opportunityService.getPendingActionsForActor(deal.id, owner.id)
    expect(pending).toHaveLength(1)
    expect(pending[0].target).toEqual({ kind: "packing_list" })

    await opportunityService.decideAction(pending[0].runId, "create", owner.id)

    const [list] = listsOf(deal)
    expect(list.state).toBe("draft")
    expect(runOf(deal, action)).toMatchObject({ outcome: "created", packing_list_id: list.id })
  })

  it("creates nothing when the Decider skips", async () => {
    makeStageAction({ stage_id: packing.id, kind: "request_packing_list", config: { confirmMode: "confirm" } })
    const deal = dealOnLead()

    await opportunityService.updateStatus(deal.id, packing.id, owner.id)
    const [pending] = await opportunityService.getPendingActionsForActor(deal.id, owner.id)
    await opportunityService.decideAction(pending.runId, "skip", owner.id)

    expect(listsOf(deal)).toHaveLength(0)
  })
})
