/**
 * #298 — the modal shell: default tab, per-tab lazy fetch that doesn't
 * refetch on revisit, previous/next navigation, and the narrow-window
 * chat-as-tab switch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, screen } from "@testing-library/react"

import { renderWithProviders } from "../../../test/support"
import { makeEmployee, makeOpportunity, makeOpportunityItem } from "../../../test/factories"
import OpportunityDetailsModal from "../OpportunityDetailsModal"

let authUser
vi.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

function renderModal(opportunity, extraProps = {}) {
  const owner = makeEmployee()
  authUser = { id: owner.id, isSuperAdmin: true }
  renderWithProviders(
    <OpportunityDetailsModal isOpen onClose={() => {}} opportunity={opportunity} {...extraProps} />,
  )
}

describe("SorModal — tabs", () => {
  it("opens on Now, with the other tabs' content not rendered yet", async () => {
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S01234" })
    renderModal(deal)

    expect(await screen.findByText("What blocks this stage")).toBeInTheDocument()
    // "Deal Details" is Details' own heading (#302) — absent until opened.
    expect(screen.queryByText("Deal Details")).not.toBeInTheDocument()
  })

  it("fetches a tab only once it's first opened, and not again on revisit", async () => {
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S01234" })
    makeOpportunityItem(deal.id, { product_name: "Rack Unit" })
    renderModal(deal)
    await screen.findByText("What blocks this stage")

    fireEvent.click(screen.getByRole("button", { name: "Items" }))
    expect(await screen.findByText("Rack Unit")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Now" }))
    await screen.findByText("What blocks this stage")

    fireEvent.click(screen.getByRole("button", { name: "Items" }))
    // Still there synchronously — no skeleton/refetch flash on revisit, the
    // query stayed cached under the "opened" tab's enabled flag.
    expect(screen.getByText("Rack Unit")).toBeInTheDocument()
  })
})

describe("SorModal — previous/next", () => {
  it("renders no arrows without siblingIds", async () => {
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S01234" })
    renderModal(deal)
    await screen.findByText("What blocks this stage")
    expect(screen.queryByTitle("Previous")).not.toBeInTheDocument()
    expect(screen.queryByTitle("Next")).not.toBeInTheDocument()
  })

  it("→ navigates to the next sibling id via onNavigate", async () => {
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S01234" })
    const onNavigate = vi.fn()
    renderModal(deal, { siblingIds: [deal.id, "next-id"], onNavigate })
    await screen.findByText("What blocks this stage")

    fireEvent.click(screen.getByTitle("Next"))
    expect(onNavigate).toHaveBeenCalledWith("next-id")
  })

  it("disables Previous at the start of the list", async () => {
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S01234" })
    renderModal(deal, { siblingIds: [deal.id, "next-id"], onNavigate: vi.fn() })
    await screen.findByText("What blocks this stage")
    expect(screen.getByTitle("Previous")).toBeDisabled()
  })
})

describe("SorModal — narrow layout", () => {
  let originalMatchMedia

  beforeEach(() => {
    originalMatchMedia = window.matchMedia
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it("shows the chat column beside the tabs when wide", async () => {
    window.matchMedia = (query) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S01234" })
    renderModal(deal)
    await screen.findByText("What blocks this stage")

    expect(screen.queryByRole("button", { name: "Chat" })).not.toBeInTheDocument()
    expect(screen.getByText("Activity & Log Notes")).toBeInTheDocument()
  })

  it("moves chat into a fifth tab below 1100px", async () => {
    window.matchMedia = (query) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S01234" })
    renderModal(deal)
    await screen.findByText("What blocks this stage")

    expect(screen.queryByText("Activity & Log Notes")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Chat" }))
    expect(await screen.findByText("Activity & Log Notes")).toBeInTheDocument()
  })
})
