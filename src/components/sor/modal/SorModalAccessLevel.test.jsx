/**
 * ADR 0021 / #297 — wiring `sor_access_level` into the SOR modal: a locked
 * viewer sees the locked summary and their own "Your visits" list and
 * nothing else, and a Restricted Stage disables Move for a full-access
 * viewer even though their access level itself stays 'full'.
 */
import { describe, it, expect, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"

import { renderWithProviders } from "../../../test/support"
import { makeEmployee, makeOpportunity, makeSaleType, makeFlowStage } from "../../../test/factories"
import { db } from "../../../test/db/store"
import OpportunityDetailsModal from "../OpportunityDetailsModal"
import { stubRpc } from "../../../test/msw/server"
import { waitForNetworkIdle } from "../../../test/network"

let authUser
vi.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

window.matchMedia = (query) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })

describe("SorModal — access level", () => {
  it("shows only the locked summary and Your visits for a locked viewer", async () => {
    const viewer = makeEmployee()
    authUser = { id: viewer.id }

    const saleType = makeSaleType({ name: "Flow for locked view" })
    const stage = makeFlowStage({ name: "Evaluation" })
    const deal = makeOpportunity({ status: "LEAD", sale_type_id: saleType.id, flow_stage_id: stage.id })
    const visit = db.internal.rowsOf("sor_stage_visits").find((v) => v.opportunity_id === deal.id)

    stubRpc("sor_access_level", () => "locked")
    stubRpc("sor_locked_summary", () => [
      {
        sales_reference: deal.sales_reference,
        project_title: deal.project_title,
        current_stage_name: stage.name,
        is_restricted: false,
      },
    ])
    stubRpc("sor_visible_visit_ids", () => [visit.id])

    renderWithProviders(
      <OpportunityDetailsModal
        isOpen
        onClose={() => {}}
        opportunity={null}
        opportunityId={deal.id}
        accessLevel="locked"
      />,
    )

    await screen.findByText(deal.project_title)
    await waitForNetworkIdle()

    expect(screen.getByText("Your visits")).toBeInTheDocument()
    // A preview, not a working surface: a slide-over with no way to the full record.
    expect(screen.getByText("Your visits").closest('[data-slot="drawer-content"]')).not.toBeNull()
    expect(screen.queryByRole("button", { name: "View Full Details" })).not.toBeInTheDocument()
    expect(screen.getAllByText(stage.name).length).toBeGreaterThan(0)
    // Nothing else — no tabs, no chat, no edit affordance.
    expect(screen.queryByRole("tab", { name: "Now" })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText("Add a note — type @ to mention someone")).not.toBeInTheDocument()
  })

  it("tells someone with no access, and names the Deal Owner to ask (#474)", async () => {
    const viewer = makeEmployee()
    authUser = { id: viewer.id }
    const deal = makeOpportunity({ status: "LEAD" })

    stubRpc("sor_access_contact", () => [{ deal_owner_name: "Dana Owner" }])

    renderWithProviders(
      <OpportunityDetailsModal isOpen onClose={() => {}} opportunity={null} opportunityId={deal.id} accessLevel="none" />,
    )

    await screen.findByText("Dana Owner")
    expect(screen.getByText("You're not on this SOR.")).toBeInTheDocument()
    // Nothing about the deal itself.
    expect(screen.queryByText(deal.project_title)).not.toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: "Now" })).not.toBeInTheDocument()
  })

  it("tells a mentioned viewer which Stage they see, who opened it, and when it ends (#475)", async () => {
    const viewer = makeEmployee()
    const sender = makeEmployee({ name: "Sean Sender" })
    authUser = { id: viewer.id }
    const saleType = makeSaleType({ name: "Flow for mention banner" })
    const stage = makeFlowStage({ name: "Costing" })
    const deal = makeOpportunity({ status: "LEAD", sale_type_id: saleType.id, flow_stage_id: stage.id })
    const visit = db.internal.rowsOf("sor_stage_visits").find((v) => v.opportunity_id === deal.id)
    db.seed("sor_mention_viewers", [
      { opportunity_id: deal.id, employee_id: viewer.id, granted_by: sender.id, stage_visit_id: visit.id },
    ])

    stubRpc("sor_access_level", () => "participant")
    stubRpc("sor_participant_record", () => [deal])
    stubRpc("sor_visible_visit_ids", () => [visit.id])

    renderWithProviders(
      <OpportunityDetailsModal isOpen onClose={() => {}} opportunity={deal} opportunityId={deal.id} accessLevel="participant" />,
    )

    const banner = await screen.findByText(/because/)
    expect(banner.closest("li").textContent).toContain("You're viewing Costing because Sean Sender mentioned you")
    expect(banner.closest("li").textContent).toContain("this ends when the Stage moves")
  })

  it("says an SOR that does not exist cannot be found (#474)", async () => {
    authUser = { id: makeEmployee().id }
    stubRpc("sor_access_contact", () => [])

    renderWithProviders(
      <OpportunityDetailsModal isOpen onClose={() => {}} opportunity={null} opportunityId="missing-sor" accessLevel="none" />,
    )

    await screen.findByText("This SOR doesn't exist or has been deleted.")
  })

  it("disables Move and shows the restricted banner for a full-access viewer shut out of the current stage", async () => {
    const owner = makeEmployee()
    authUser = { id: owner.id, isSuperAdmin: true }

    const saleType = makeSaleType({ name: "Flow for restricted move" })
    const stage = makeFlowStage({ name: "Restricted Stage" })
    const deal = makeOpportunity({
      status: "LEAD",
      sale_type_id: saleType.id,
      flow_stage_id: stage.id,
      deal_owner_id: owner.id,
    })

    stubRpc("sor_locked_summary", () => [
      {
        sales_reference: deal.sales_reference,
        project_title: deal.project_title,
        current_stage_name: stage.name,
        is_restricted: true,
      },
    ])

    renderWithProviders(<OpportunityDetailsModal isOpen onClose={() => {}} opportunity={deal} />)

    await screen.findByRole("button", { name: /^This stage/ })
    await waitForNetworkIdle()

    await waitFor(() => expect(screen.getAllByText(/This stage is restricted/).length).toBeGreaterThan(0))
  })

  it.each([
    [true, true],
    [false, false],
  ])("full access with server can-edit=%s shows the Edit control=%s", async (serverSays, shown) => {
    const viewer = makeEmployee()
    authUser = { id: viewer.id }
    const saleType = makeSaleType({ name: `Flow can-edit ${serverSays}` })
    const stage = makeFlowStage({ name: "Evaluation" })
    const deal = makeOpportunity({ status: "LEAD", sale_type_id: saleType.id, flow_stage_id: stage.id })

    stubRpc("sor_can_edit_opportunity", () => serverSays)

    renderWithProviders(
      <OpportunityDetailsModal isOpen onClose={() => {}} opportunity={deal} accessLevel="full" />,
    )

    await screen.findByText(deal.project_title)
    await waitForNetworkIdle()

    await waitFor(() => {
      const btn = screen.queryByRole("button", { name: "Edit opportunity" })
      expect(!!btn).toBe(shown)
    })
  })
})
