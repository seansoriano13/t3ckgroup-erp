/**
 * #299 — the Now tab against the fake database: the order of its blocks
 * (clearing the way comes first), one row per task however many members it
 * has, only the current Stage Visit's tasks, and the Stage Fields form saving
 * to that visit. Runs the real services; only Odoo is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { useQuery } from "@tanstack/react-query"

import { renderWithProviders } from "../../../test/support"
import { stubEdgeFunction } from "../../../test/msw/server"
import { db } from "../../../test/db/store"
import {
  makeEmployee,
  makeFlowSnapshot,
  makeFlowStage,
  makeGroupTask,
  makeSaleType,
  makeSalesFlow,
  makeStageCondition,
  makeStageField,
  makeStageVisit,
  makeTask,
  seedPipeline,
} from "../../../test/factories"
import { opportunityService } from "../../../services/opportunityService"
import OpportunityDetailsModal from "../OpportunityDetailsModal"

let authUser
vi.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

function LiveModal({ id }) {
  const { data } = useQuery({
    queryKey: ["globalOpportunity", id],
    queryFn: () => opportunityService.getOpportunityById(id),
  })
  if (!data) return null
  return <OpportunityDetailsModal isOpen onClose={() => {}} opportunity={data} />
}

// The modal opens on the Summary; the Now view is one click away on the crumb.
async function renderNow(id) {
  renderWithProviders(<LiveModal id={id} />)
  fireEvent.click(await screen.findByRole("button", { name: /^This stage/ }))
}

const isBefore = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe("NowTab (#299)", () => {
  let owner, lead, saleType

  beforeEach(() => {
    stubEdgeFunction("odoo-sor-lookup", { success: true, found: false, items: [] })
    seedPipeline()
    owner = makeEmployee({ name: "Ben Cruz" })
    authUser = { id: owner.id, isSuperAdmin: true }
    saleType = makeSaleType({ name: "Flow" })
    const flow = makeSalesFlow({ sale_type_id: saleType.id })
    lead = makeFlowStage({ flow_id: flow.id, name: "Lead", sort_order: 0 })
  })

  const register = () =>
    opportunityService.createOpportunity(
      {
        registration_date: "2026-03-01",
        lead_source: "LGU",
        client_name: "Quezon City Hall",
        project_title: "Fire truck supply",
        project_type: "SSP",
        sale_type_id: saleType.id,
        deal_owner_id: owner.id,
      },
      owner.id,
    )

  function groupTaskWithMembers(opportunityId, title, count) {
    const task = makeGroupTask({ opportunity_id: opportunityId, title })
    const members = Array.from({ length: count }, (_, i) => makeEmployee({ name: `Member ${i + 1}` }))
    for (const member of members) {
      db.seed("committee_task_members", {
        committee_task_id: task.id,
        employee_id: member.id,
        task_description: `Part for ${member.name}`,
        status: "PENDING",
      })
    }
    return { task, members }
  }

  it("renders blocking conditions above the Stage Fields form and the tasks", async () => {
    makeStageCondition({ stage_id: lead.id, kind: "tickbox", label: "Signed proposal" })
    makeStageField({ stage_id: lead.id, label: "Site visit notes" })
    makeFlowSnapshot({ flow_id: lead.flow_id })
    const deal = await register()
    groupTaskWithMembers(deal.id, "Prepare bid documents", 2)

    await renderNow(deal.id)

    const condition = await screen.findByText("Signed proposal")
    const field = await screen.findByText("Site visit notes")
    const task = await screen.findByRole("button", { name: "Prepare bid documents" })

    expect(isBefore(condition, field)).toBe(true)
    expect(isBefore(field, task)).toBe(true)
  })

  it("renders a group task with 10 members as one row until it is expanded", async () => {
    makeFlowSnapshot({ flow_id: lead.flow_id })
    const deal = await register()
    const { members } = groupTaskWithMembers(deal.id, "Site survey crew", 10)

    await renderNow(deal.id)

    expect(await screen.findAllByRole("button", { name: "Site survey crew" })).toHaveLength(1)
    for (const member of members) {
      expect(screen.queryByText(`Part for ${member.name}`)).not.toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole("button", { name: "Expand Site survey crew" }))

    for (const member of members) {
      expect(screen.getByText(`Part for ${member.name}`)).toBeInTheDocument()
    }
  })

  it("lists only the current Stage Visit's tasks, leaving earlier visits' and deleted ones out", async () => {
    makeFlowSnapshot({ flow_id: lead.flow_id })
    const deal = await register()
    const currentVisitId = await opportunityService.getCurrentStageVisitId(deal.id)
    const earlier = makeStageVisit({
      opportunity_id: deal.id,
      flow_stage_id: lead.id,
      sequence: 0,
      entered_at: "2026-01-01T00:00:00.000Z",
      left_at: "2026-01-02T00:00:00.000Z",
    })
    makeGroupTask({ opportunity_id: deal.id, title: "Earlier survey", stage_visit_id: earlier.id })
    makeGroupTask({ opportunity_id: deal.id, title: "Current survey", stage_visit_id: currentVisitId })
    makeTask({ opportunity_id: deal.id, project_title: "Scrapped quote", status: "DELETED", stage_visit_id: currentVisitId })

    await renderNow(deal.id)

    expect(await screen.findByRole("button", { name: "Current survey" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Earlier survey" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Scrapped quote" })).not.toBeInTheDocument()
  })

  it("renders the Stage's fields as a form, never as condition rows", async () => {
    makeStageField({ stage_id: lead.id, label: "Award amount", help: "The amount awarded.", field_type: "number" })
    makeFlowSnapshot({ flow_id: lead.flow_id })
    const deal = await register()

    await renderNow(deal.id)

    expect(await screen.findByLabelText("Award amount")).toBeInTheDocument()
    expect(screen.getByText("The amount awarded.")).toBeInTheDocument()
    expect(screen.getByText("Nothing blocks this stage.")).toBeInTheDocument()
  })

  it("saves a Stage Field's value to the current Stage Visit", async () => {
    const field = makeStageField({ stage_id: lead.id, label: "Award amount", field_type: "number" })
    makeFlowSnapshot({ flow_id: lead.flow_id })
    const deal = await register()
    const currentVisitId = await opportunityService.getCurrentStageVisitId(deal.id)

    await renderNow(deal.id)

    fireEvent.change(await screen.findByLabelText("Award amount"), { target: { value: "5000" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      const saved = db.internal.rowsOf("sor_stage_field_values")
      expect(saved).toEqual([
        expect.objectContaining({ opportunity_id: deal.id, stage_visit_id: currentVisitId, field_id: field.id, value: "5000" }),
      ])
    })
  })

  it("says nothing blocks the stage when it has no conditions", async () => {
    makeFlowSnapshot({ flow_id: lead.flow_id })
    const deal = await register()

    await renderNow(deal.id)

    expect(await screen.findByText("Nothing blocks this stage.")).toBeInTheDocument()
  })
})
