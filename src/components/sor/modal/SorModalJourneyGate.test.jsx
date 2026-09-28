/**
 * ADR 0021 / #297 — a Participant's Journey tab is gated by the owning Sales
 * Flow's `journey_viewers` setting (`sor_can_view_journey`), not shown
 * unconditionally the way it is at full access.
 */
import { describe, it, expect, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"

import { renderWithProviders } from "../../../test/support"
import { makeEmployee, makeOpportunity, makeSaleType, makeFlowStage } from "../../../test/factories"
import OpportunityDetailsModal from "../OpportunityDetailsModal"
import { stubRpc } from "../../../test/msw/server"
import { waitForNetworkIdle } from "../../../test/network"

let authUser
vi.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

window.matchMedia = (query) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })

function makeParticipantDeal() {
  const viewer = makeEmployee()
  authUser = { id: viewer.id }
  const saleType = makeSaleType({ name: "Flow for journey gate" })
  const stage = makeFlowStage({ name: "Evaluation" })
  const deal = makeOpportunity({ status: "LEAD", sale_type_id: saleType.id, flow_stage_id: stage.id })
  stubRpc("sor_locked_summary", () => [
    { sales_reference: deal.sales_reference, project_title: deal.project_title, current_stage_name: stage.name, is_restricted: false },
  ])
  return deal
}

describe("SorModal — Journey tab gated by journey_viewers (participant access)", () => {
  it("hides the Journey tab when sor_can_view_journey returns false", async () => {
    const deal = makeParticipantDeal()
    stubRpc("sor_can_view_journey", () => false)

    renderWithProviders(
      <OpportunityDetailsModal isOpen onClose={() => {}} opportunity={deal} accessLevel="participant" />,
    )

    await screen.findByText(deal.project_title)
    await waitForNetworkIdle()

    expect(screen.getByRole("tab", { name: "Now" })).toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: "History" })).not.toBeInTheDocument()
  })

  it("shows the Journey tab when sor_can_view_journey returns true", async () => {
    const deal = makeParticipantDeal()
    stubRpc("sor_can_view_journey", () => true)

    renderWithProviders(
      <OpportunityDetailsModal isOpen onClose={() => {}} opportunity={deal} accessLevel="participant" />,
    )

    await screen.findByText(deal.project_title)
    await waitForNetworkIdle()

    await waitFor(() => expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument())
  })
})
