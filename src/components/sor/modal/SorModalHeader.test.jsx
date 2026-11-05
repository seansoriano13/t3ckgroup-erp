/**
 * #407 — the header's "Clear to move" badge and "Can't move on yet" message
 * must account for Stage Fields, not just Stage Conditions. Before this fix
 * both were computed from the checklist alone, so a Stage whose conditions
 * were all satisfied but whose required Stage Field was empty read as fully
 * clear right up until the move itself was refused server-side.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { useQuery } from "@tanstack/react-query"

import { renderWithProviders } from "../../../test/support"
import { stubEdgeFunction } from "../../../test/msw/server"
import {
  makeEmployee,
  makeFlowEdge,
  makeFlowSnapshot,
  makeFlowStage,
  makeSaleType,
  makeSalesFlow,
  makeStageCondition,
  makeStageField,
  seedPipeline,
} from "../../../test/factories"
import { opportunityService } from "../../../services/opportunityService"
import OpportunityDetailsModal from "../OpportunityDetailsModal"
import { StatusLine } from "./summary/DigestSummary"

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

function StaticModal({ opportunity }) {
  return <OpportunityDetailsModal isOpen onClose={() => {}} opportunity={opportunity} />
}

describe("SorModalHeader — Clear to move accounts for Stage Fields (#407)", () => {
  let owner, saleType, stage1, stage2, deal

  beforeEach(async () => {
    stubEdgeFunction("odoo-sor-lookup", { success: true, found: false, items: [] })
    seedPipeline()
    owner = makeEmployee({ name: "Ben Cruz" })
    authUser = { id: owner.id, isSuperAdmin: true }
    saleType = makeSaleType({ name: "Flow" })
    const flow = makeSalesFlow({ sale_type_id: saleType.id })
    stage1 = makeFlowStage({ flow_id: flow.id, name: "Lead", sort_order: 0 })
    stage2 = makeFlowStage({ flow_id: flow.id, name: "Awarded", sort_order: 1 })
    const stage3 = makeFlowStage({ flow_id: flow.id, name: "Delivered", sort_order: 2 })
    makeFlowEdge(stage1, stage2)
    makeFlowEdge(stage2, stage3)

    // Two satisfied conditions and one required, empty Stage Field on
    // stage2 — the repro from issue #407 (S94002 on S2).
    makeStageCondition({ stage_id: stage2.id, kind: "tickbox", label: "NDA signed" })
    makeStageCondition({ stage_id: stage2.id, kind: "tickbox", label: "PO received" })
    makeStageField({ stage_id: stage2.id, label: "Expected Award Date", source: "custom", field_type: "date" })
    makeFlowSnapshot({ flow_id: flow.id })

    deal = await opportunityService.createOpportunity(
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
    deal = await opportunityService.updateStatus(deal.id, stage2.id, owner.id)

    const checklist = await opportunityService.getStageChecklist(deal.id, deal)
    for (const { condition } of checklist) {
      await opportunityService.satisfyCondition(deal.id, condition.id, owner.id)
    }
  })

  it("keeps the badge on Blocked, and names the field, while a required Stage Field is empty", async () => {
    renderWithProviders(<LiveModal id={deal.id} />)

    fireEvent.click(await screen.findByRole("button", { name: /^This stage/ }))
    await waitFor(() => expect(screen.getByText("2 of 2")).toBeInTheDocument())

    // The bug: this used to read "Clear to move" here.
    expect(screen.queryByText("Clear to move")).not.toBeInTheDocument()
    expect(screen.getByText(/Blocked/)).toBeInTheDocument()
    expect(screen.getByText(/Can't move on yet — missing:.*Expected Award Date/)).toBeInTheDocument()
  })

  it("clears both the badge and the message, with no reload, once the field is saved", async () => {
    renderWithProviders(<LiveModal id={deal.id} />)
    await screen.findByRole("button", { name: /^This stage/ })
    await waitFor(() => expect(screen.getByText(/Blocked/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /^This stage/ }))
    fireEvent.change(await screen.findByLabelText("Expected Award Date"), { target: { value: "2026-04-01" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(screen.getByText("Clear to move")).toBeInTheDocument())
    expect(screen.queryByText(/Can't move on yet/)).not.toBeInTheDocument()
  })

  // Issue #885 — the badge used to read "Clear to move" right after a move,
  // while the conditions were still on their way. It must wait.
  it("shows a checking state, never Clear to move, while the conditions are still loading", async () => {
    const pending = vi.spyOn(opportunityService, "getStageChecklist").mockReturnValue(new Promise(() => {}))
    renderWithProviders(<LiveModal id={deal.id} />)

    expect(await screen.findByText("Checking…")).toBeInTheDocument()
    expect(screen.queryByText("Clear to move")).not.toBeInTheDocument()
    expect(screen.queryByText(/Nothing blocks this stage/)).not.toBeInTheDocument()
    pending.mockRestore()
  })
})

describe("Ticket #838 — SOR header updates right after stage fields are saved", () => {
  let owner, saleType, stage1, stage2, stage3, deal, flow

  beforeEach(async () => {
    stubEdgeFunction("odoo-sor-lookup", { success: true, found: false, items: [] })
    seedPipeline()
    owner = makeEmployee({ name: "Ben Cruz" })
    authUser = { id: owner.id, isSuperAdmin: true }
    saleType = makeSaleType({ name: "Flow" })
    flow = makeSalesFlow({ sale_type_id: saleType.id })
    stage1 = makeFlowStage({ flow_id: flow.id, name: "Lead", sort_order: 0 })
    stage2 = makeFlowStage({ flow_id: flow.id, name: "Awarded", sort_order: 1 })
    stage3 = makeFlowStage({ flow_id: flow.id, name: "Delivered", sort_order: 2 })
    makeFlowEdge(stage1, stage2)
    makeFlowEdge(stage2, stage3)

    makeStageCondition({ stage_id: stage2.id, kind: "tickbox", label: "PO received" })
    makeStageField({ stage_id: stage2.id, label: "Representative", source: "sor", sor_field: "contact_person", is_required: true })
    makeFlowSnapshot({ flow_id: flow.id })

    deal = await opportunityService.createOpportunity(
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
    deal = await opportunityService.updateStatus(deal.id, stage2.id, owner.id)

    const checklist = await opportunityService.getStageChecklist(deal.id, deal)
    for (const { condition } of checklist) {
      await opportunityService.satisfyCondition(deal.id, condition.id, owner.id)
    }
  })

  it("updates header immediately after saving an SOR-source stage field and allows next-stage click with static opportunity prop", async () => {
    renderWithProviders(<StaticModal opportunity={deal} />)

    await waitFor(() => expect(screen.getByText(/Blocked: 1/)).toBeInTheDocument())
    expect(screen.getByText(/Can't move on yet — missing: Representative/)).toBeInTheDocument()

    const deliveredButton = screen.getByText("Delivered")
    fireEvent.click(deliveredButton)
    expect((await opportunityService.getOpportunityById(deal.id)).flow_stage_id).toBe(stage2.id)

    fireEvent.click(screen.getByRole("button", { name: /^This stage/ }))
    fireEvent.change(await screen.findByLabelText("Representative"), { target: { value: "Juan Dela Cruz" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(screen.getByText("Clear to move")).toBeInTheDocument())
    expect(screen.queryByText(/Can't move on yet/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText("Delivered"))
    await waitFor(async () => {
      const updated = await opportunityService.getOpportunityById(deal.id)
      expect(updated.flow_stage_id).toBe(stage3.id)
    })
  })

  it("never says Ready to move in StatusLine while checklist has an unmet gate", () => {
    const p = {
      checklist: [
        { condition: { id: "c1", label: "Inspection report", is_required: true }, status: "unsatisfied" },
      ],
      opportunity: { status: "PROJECT_DELIVERY", flow_stage_id: stage2.id },
    }
    const dg = {
      moves: {
        currentLabel: "Project Delivery",
        isTerminal: false,
        isFlow: true,
        destinations: [{ key: stage3.id, label: "Collection" }],
      },
      blocked: [],
    }

    renderWithProviders(<StatusLine p={p} dg={dg} />)
    expect(screen.queryByText(/Ready to move/)).not.toBeInTheDocument()
    expect(screen.getByText(/Can't move on until one thing is done\./)).toBeInTheDocument()
  })
})
