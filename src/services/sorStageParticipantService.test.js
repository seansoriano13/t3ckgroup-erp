import { beforeEach, describe, expect, it } from "vitest"
import { sorStageParticipantService } from "./sorStageParticipantService"
import { opportunityService } from "./opportunityService"
import { notificationService } from "./notificationService"
import {
  makeEmployee,
  makeFlowEdge,
  makeFlowSnapshot,
  makeFlowStage,
  makeOpportunity,
  makeSaleType,
  makeSalesFlow,
  makeSuperAdmin,
} from "@/test/factories"
import { db } from "@/test/db/store"

/** The Stage Visit `record_stage_visit()` opens the instant a flow-built deal is created. */
function currentVisitId(opportunityId) {
  return db.internal.rowsOf("sor_stage_visits").find((v) => v.opportunity_id === opportunityId && v.left_at == null).id
}

/**
 * Issue #294 — the Stage Participant access window's lifecycle, exercised
 * against the fake PostgREST the same way opportunityService.test.js does:
 * openWindow through the service, then move the deal through
 * `opportunityService.updateStatus` so the real closing trigger
 * (`close_stage_participant_windows`, mirrored in `src/test/db/triggers.js`)
 * decides when the window ends — not a hand-rolled assertion of the rule.
 */
describe("sorStageParticipantService", () => {
  let registrar, saleType, flow, lead, qualified, won, negotiation, closing, deal

  beforeEach(() => {
    registrar = makeEmployee({ name: "Registrar" })
    saleType = makeSaleType({ name: "Flow" })
    flow = makeSalesFlow({ sale_type_id: saleType.id })
    lead = makeFlowStage({ flow_id: flow.id, name: "Lead", sort_order: 0 })
    qualified = makeFlowStage({ flow_id: flow.id, name: "Qualified", sort_order: 1 })
    won = makeFlowStage({ flow_id: flow.id, name: "Won", sort_order: 2, is_terminal: true })
    negotiation = makeFlowStage({ flow_id: flow.id, name: "Negotiation", sort_order: 3 })
    closing = makeFlowStage({ flow_id: flow.id, name: "Closing", sort_order: 4 })
    makeFlowEdge(lead, qualified)
    makeFlowEdge(qualified, won)
    makeFlowEdge(qualified, lead)
    makeFlowEdge(qualified, negotiation)
    makeFlowEdge(negotiation, closing)
    const snapshot = makeFlowSnapshot({ flow_id: flow.id })

    deal = makeOpportunity({
      registered_by: registrar.id,
      sales_reference: "S00999",
      project_title: "Project Sunrise",
      sale_type_id: saleType.id,
      flow_stage_id: lead.id,
      flow_snapshot_id: snapshot.id,
    })
  })

  it("opens a window and notifies the participant", async () => {
    const buyer = makeEmployee({ name: "Rey Santos" })
    let notified = null
    notificationService.createNotification = async (payload) => {
      notified = payload
    }

    const window = await sorStageParticipantService.openWindow(
      {
        opportunityId: deal.id,
        employeeId: buyer.id,
        source: "action",
        sourceId: "task-1",
        openedVisitId: currentVisitId(deal.id),
        access: { until: "stage_left" },
      },
      registrar.id,
    )

    expect(window.until_rule).toBe("stage_left")
    expect(window.closed_at).toBeNull()
    expect(notified.recipient_id).toBe(buyer.id)
    expect(notified.message).toContain("S00999")
    expect(notified.message).toContain("Lead")
  })

  it("re-opening the same call-in on the same visit is a no-op", async () => {
    const buyer = makeEmployee()
    const first = await sorStageParticipantService.openWindow(
      { opportunityId: deal.id, employeeId: buyer.id, source: "action", sourceId: "t1", openedVisitId: currentVisitId(deal.id), access: {} },
      registrar.id,
    )
    const second = await sorStageParticipantService.openWindow(
      { opportunityId: deal.id, employeeId: buyer.id, source: "action", sourceId: "t1", openedVisitId: currentVisitId(deal.id), access: {} },
      registrar.id,
    )

    expect(second.id).toBe(first.id)
    const all = await sorStageParticipantService.listForOpportunity(deal.id)
    expect(all).toHaveLength(1)
  })

  it("closes a stage_left window the moment the calling Stage is left", async () => {
    const buyer = makeEmployee()
    await sorStageParticipantService.openWindow(
      { opportunityId: deal.id, employeeId: buyer.id, source: "action", sourceId: "t1", openedVisitId: currentVisitId(deal.id), access: { until: "stage_left" } },
      registrar.id,
    )

    await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

    const [window] = await sorStageParticipantService.listForOpportunity(deal.id, { includeClosed: true })
    expect(window.closed_at).not.toBeNull()
    expect(window.closed_reason).toBe("rule_met")
  })

  it("a later_stage_left window survives a loop back before the chosen Stage", async () => {
    const buyer = makeEmployee()
    await sorStageParticipantService.openWindow(
      {
        opportunityId: deal.id,
        employeeId: buyer.id,
        source: "action",
        sourceId: "t1",
        openedVisitId: currentVisitId(deal.id),
        access: { until: "later_stage_left", stageId: negotiation.id },
      },
      registrar.id,
    )

    await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
    await opportunityService.updateStatus(deal.id, lead.id, registrar.id, null, null, { returnChoice: "resume" }) // loop back
    await opportunityService.updateStatus(deal.id, qualified.id, registrar.id, null, null, { returnChoice: "resume" })
    await opportunityService.updateStatus(deal.id, negotiation.id, registrar.id)

    let [open] = await sorStageParticipantService.listForOpportunity(deal.id)
    expect(open).toBeTruthy()

    await opportunityService.updateStatus(deal.id, closing.id, registrar.id) // leaves negotiation

    const [closed] = await sorStageParticipantService.listForOpportunity(deal.id, { includeClosed: true })
    expect(closed.closed_at).not.toBeNull()
    expect(closed.closed_reason).toBe("rule_met")
  })

  it("reaching a Terminal Stage closes every open window for the SOR", async () => {
    const buyerA = makeEmployee()
    const buyerB = makeEmployee()
    await sorStageParticipantService.openWindow(
      { opportunityId: deal.id, employeeId: buyerA.id, source: "action", sourceId: "t1", openedVisitId: currentVisitId(deal.id), access: { until: "terminal" } },
      registrar.id,
    )
    await sorStageParticipantService.openWindow(
      { opportunityId: deal.id, employeeId: buyerB.id, source: "assignment", sourceId: "c1", openedVisitId: currentVisitId(deal.id), access: { until: "stage_entered", stageId: won.id } },
      registrar.id,
    )

    await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
    await opportunityService.updateStatus(deal.id, won.id, registrar.id)

    const all = await sorStageParticipantService.listForOpportunity(deal.id, { includeClosed: true })
    expect(all.every((w) => w.closed_at != null)).toBe(true)
    expect(all.every((w) => w.closed_reason === "terminal")).toBe(true)
  })

  describe("removeParticipant", () => {
    it("lets the Deal Owner remove a participant", async () => {
      const owner = makeEmployee()
      deal = makeOpportunity({
        registered_by: registrar.id,
        deal_owner_id: owner.id,
        sale_type_id: saleType.id,
        flow_stage_id: lead.id,
      })
      const buyer = makeEmployee()
      const window = await sorStageParticipantService.openWindow(
        { opportunityId: deal.id, employeeId: buyer.id, source: "action", sourceId: "t1", openedVisitId: currentVisitId(deal.id), access: {} },
        registrar.id,
      )

      const closed = await sorStageParticipantService.removeParticipant(window.id, owner.id)
      expect(closed.closed_reason).toBe("removed")
      expect(closed.removed_by).toBe(owner.id)
    })

    it("lets a Super Admin remove a participant", async () => {
      const admin = makeSuperAdmin()
      const buyer = makeEmployee()
      const window = await sorStageParticipantService.openWindow(
        { opportunityId: deal.id, employeeId: buyer.id, source: "action", sourceId: "t1", openedVisitId: currentVisitId(deal.id), access: {} },
        registrar.id,
      )

      const closed = await sorStageParticipantService.removeParticipant(window.id, admin.id)
      expect(closed.closed_reason).toBe("removed")
    })

    it("refuses anyone else", async () => {
      const stranger = makeEmployee()
      const buyer = makeEmployee()
      const window = await sorStageParticipantService.openWindow(
        { opportunityId: deal.id, employeeId: buyer.id, source: "action", sourceId: "t1", openedVisitId: currentVisitId(deal.id), access: {} },
        registrar.id,
      )

      await expect(sorStageParticipantService.removeParticipant(window.id, stranger.id)).rejects.toThrow(
        /Deal Owner|Super Admin/,
      )
    })
  })
})
