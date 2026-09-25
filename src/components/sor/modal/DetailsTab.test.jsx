/**
 * #302 — the Details tab holds the SOR's reference material: its fields, the
 * Deal Team, Estimated Value with the quotation actions, and the commission
 * footer, with Inclusions and Purchasing at the bottom until #209. None of
 * it may still be sitting in Now. Real opportunityService on the fake
 * database; only Odoo is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, screen } from "@testing-library/react"

import { renderWithProviders } from "../../../test/support"
import { stubEdgeFunction, stubRpc } from "../../../test/msw/server"
import { db } from "../../../test/db/store"
import { makeEmployee, makeOpportunity } from "../../../test/factories"
import OpportunityDetailsModal from "../OpportunityDetailsModal"

let authUser
vi.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

const isBefore = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

function renderModal(opportunity) {
  renderWithProviders(<OpportunityDetailsModal isOpen onClose={() => {}} opportunity={opportunity} />)
}

describe("DetailsTab (#302)", () => {
  let owner, director

  beforeEach(() => {
    stubRpc("sor_can_edit_opportunity", () => true)
    stubEdgeFunction("odoo-sor-lookup", { success: true, found: true, order: { name: "S06070" }, items: [] })
    owner = makeEmployee({ name: "Ben Cruz" })
    director = makeEmployee({ name: "Ana Reyes" })
    authUser = { id: owner.id, isSuperAdmin: true }
  })

  // The modal is handed an SOR with its people already joined, the way
  // getOpportunityById returns it; the seeded row itself has only the ids.
  const deal = (overrides = {}) => ({
    ...makeOpportunity({
      status: "QUALIFIED",
      sales_reference: "S06070",
      contact_person: "Juan Dela Cruz",
      expected_value: 1250000,
      deal_owner_id: owner.id,
      sales_director_id: director.id,
      ...overrides,
    }),
    deal_owner: owner,
    sales_director: director,
  })

  it("renders the SOR's fields, Deal Team, Estimated Value, quotation actions and commission — and Now does not", async () => {
    const sor = deal()
    renderModal(sor)
    await screen.findByText("What blocks this stage")

    for (const moved of ["Deal Details", "Team & Assignees", "Estimated Value", "Preview Quote", "Commission Estimate & Sales Attribution"]) {
      expect(screen.queryByText(moved)).not.toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole("tab", { name: "Details" }))

    expect(await screen.findByText("Deal Details")).toBeInTheDocument()
    expect(screen.getByText("Juan Dela Cruz")).toBeInTheDocument()
    expect(screen.getByText("Team & Assignees")).toBeInTheDocument()
    expect(screen.getByText("Ben Cruz")).toBeInTheDocument()
    expect(screen.getByText("Ana Reyes")).toBeInTheDocument()
    expect(screen.getByText("Estimated Value")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Preview Quote/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Download Full PDF/ })).toBeInTheDocument()
    expect(screen.getByText("Commission Estimate & Sales Attribution")).toBeInTheDocument()
  })

  it("puts Inclusions and Purchasing at the bottom, under the fields grid", async () => {
    const sor = deal()
    db.seed("sor_inclusions", { opportunity_id: sor.id, description: "Aerial ladder, 30m" })
    db.seed("sor_procurement_requests", { opportunity_id: sor.id, requested_name: "Boom Lift 12m", requested_by: owner.id })
    renderModal(sor)
    await screen.findByText("What blocks this stage")

    expect(screen.queryByText("Aerial ladder, 30m")).not.toBeInTheDocument()
    expect(screen.queryByText("Procurement Requests")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("tab", { name: "Details" }))

    const grid = await screen.findByText("Deal Details")
    const inclusions = await screen.findByText("Inclusions")
    const purchasing = await screen.findByText("Procurement Requests")
    expect(isBefore(grid, inclusions)).toBe(true)
    expect(isBefore(inclusions, purchasing)).toBe(true)
  })

  it("stays mounted when left and reopened, so a half-typed edit survives", async () => {
    const sor = deal()
    renderModal(sor)
    await screen.findByText("What blocks this stage")

    fireEvent.click(screen.getByRole("tab", { name: "Details" }))
    await screen.findByText("Deal Details")
    fireEvent.click(screen.getByTitle("Edit"))
    const contact = await screen.findByPlaceholderText("e.g. Juan Dela Cruz")
    fireEvent.change(contact, { target: { value: "Maria Santos" } })

    fireEvent.click(screen.getByRole("tab", { name: "Now" }))
    fireEvent.click(screen.getByRole("tab", { name: "Details" }))

    expect(screen.getByPlaceholderText("e.g. Juan Dela Cruz")).toHaveValue("Maria Santos")
  })
})
