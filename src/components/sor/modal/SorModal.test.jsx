/**
 * #298 — the modal shell: default tab, per-tab lazy fetch that doesn't
 * refetch on revisit, previous/next navigation, and the narrow-window
 * chat-as-tab switch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"

import { renderWithProviders } from "../../../test/support"
import { makeEmployee, makeOpportunity, makeOpportunityItem } from "../../../test/factories"
import OpportunityDetailsModal from "../OpportunityDetailsModal"
import { opportunityService } from "../../../services/opportunityService"
import { leadSourceService } from "../../../services/leadSourceService"
import { waitForNetworkIdle } from "../../../test/network"
import { stubRpc } from "../../../test/msw/server"

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

})

// Each lazy tab's own read, spied rather than mocked so the real service still
// answers: not called while the modal sits on Now, called once when the tab
// first opens, and not again when the reader leaves and comes back.
describe("SorModal — each tab fetches once, when first opened", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function expectFetchedOnlyOnOpen(tab, spy, shown) {
    const deal = makeOpportunity({ status: "LEAD", sales_reference: null })
    makeOpportunityItem(deal.id, { product_name: "Rack Unit" })
    renderModal(deal)
    await screen.findByText("What blocks this stage")
    await waitForNetworkIdle()
    expect(spy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("tab", { name: tab }))
    expect(await screen.findByText(shown)).toBeInTheDocument()
    await waitForNetworkIdle()
    expect(spy).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("tab", { name: "Now" }))
    fireEvent.click(screen.getByRole("tab", { name: tab }))
    // Still there synchronously, with no skeleton flash and no second read.
    expect(screen.getByText(shown)).toBeInTheDocument()
    await waitForNetworkIdle()
    expect(spy).toHaveBeenCalledTimes(1)
  }

  it("Journey", async () => {
    await expectFetchedOnlyOnOpen("History", vi.spyOn(opportunityService, "getJourney"), "No Stage Visits yet")
  })

  it("Items", async () => {
    await expectFetchedOnlyOnOpen("Items", vi.spyOn(opportunityService, "getItems"), "Rack Unit")
  })

  it("Details", async () => {
    await expectFetchedOnlyOnOpen("Details", vi.spyOn(leadSourceService, "getActiveLeadSources"), "Deal Details")
  })

  // Items loads only once its tab opens, but Edit can be pressed from Now.
  // The edit form carries the whole Product List into Save, so a list that
  // was never fetched must not be saved over the stored one as empty.
  it("keeps the stored Product List through an Edit and Save made before Items was ever opened", async () => {
    stubRpc("sor_can_edit_opportunity", () => true)
    const deal = makeOpportunity({ status: "LEAD", sales_reference: null })
    makeOpportunityItem(deal.id, { product_name: "Rack Unit" })
    renderModal(deal)
    await screen.findByText("What blocks this stage")

    fireEvent.click(await screen.findByTitle("Edit"))
    fireEvent.click(await screen.findByRole("button", { name: "Save" }))

    await waitFor(() => expect(screen.getByTitle("Edit")).toBeInTheDocument())
    await waitForNetworkIdle()
    const items = await opportunityService.getItems(deal.id)
    expect(items.map((i) => i.product_name)).toEqual(["Rack Unit"])
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

    expect(screen.queryByRole("tab", { name: "Chat" })).not.toBeInTheDocument()
    expect(screen.getByText("Activity & Log Notes")).toBeInTheDocument()
  })

  it("moves chat into a fifth tab below 1100px", async () => {
    window.matchMedia = (query) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S01234" })
    renderModal(deal)
    await screen.findByText("What blocks this stage")

    expect(screen.queryByText("Activity & Log Notes")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }))
    expect(await screen.findByText("Activity & Log Notes")).toBeInTheDocument()
  })
})
