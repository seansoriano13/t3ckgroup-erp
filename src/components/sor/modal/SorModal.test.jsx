/**
 * #298 — the modal shell: opens on the Summary, no refetch on revisiting a
 * view, previous/next navigation, and the notes drawer.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"

import { renderWithProviders } from "../../../test/support"
import { makeEmployee, makeOpportunity, makeOpportunityItem } from "../../../test/factories"
import OpportunityDetailsModal from "../OpportunityDetailsModal"
import { opportunityService } from "../../../services/opportunityService"
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

const view = (name) => screen.findByRole("button", { name: new RegExp(`^${name}`) })
const ready = () => view("This stage")

describe("SorModal — summary shell", () => {
  it("opens on the Summary, with the This stage view not rendered yet", async () => {
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S01234" })
    renderModal(deal)

    await ready()
    expect(screen.queryByText("What blocks this stage")).not.toBeInTheDocument()

    fireEvent.click(await ready())
    expect(await screen.findByText("What blocks this stage")).toBeInTheDocument()
  })
})

// Each view's own read, spied rather than mocked so the real service still
// answers: once the view has opened, leaving for the Summary and coming back
// makes no further read.
describe("SorModal — each view reads once", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function expectNoRefetchOnRevisit(name, spy, shown) {
    const deal = makeOpportunity({ status: "LEAD", sales_reference: null })
    makeOpportunityItem(deal.id, { product_name: "Rack Unit" })
    renderModal(deal)
    await ready()

    fireEvent.click(await view(name))
    expect(await screen.findByText(shown)).toBeInTheDocument()
    await waitForNetworkIdle()
    const reads = spy.mock.calls.length
    expect(reads).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole("button", { name: "Summary" }))
    fireEvent.click(await view(name))
    expect(await screen.findByText(shown)).toBeInTheDocument()
    await waitForNetworkIdle()
    expect(spy).toHaveBeenCalledTimes(reads)
  }

  it("Products", async () => {
    await expectNoRefetchOnRevisit("Products", vi.spyOn(opportunityService, "getItems"), "Rack Unit")
  })

  // The edit form carries the whole Product List into Save, so a list that
  // was never fetched must not be saved over the stored one as empty.
  it("keeps the stored Product List through an Edit and Save made before Products was ever opened", async () => {
    stubRpc("sor_can_edit_opportunity", () => true)
    const deal = makeOpportunity({ status: "LEAD", sales_reference: null })
    makeOpportunityItem(deal.id, { product_name: "Rack Unit" })
    renderModal(deal)
    await ready()

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
    await ready()
    expect(screen.queryByTitle("Previous")).not.toBeInTheDocument()
    expect(screen.queryByTitle("Next")).not.toBeInTheDocument()
  })

  it("→ navigates to the next sibling id via onNavigate", async () => {
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S01234" })
    const onNavigate = vi.fn()
    renderModal(deal, { siblingIds: [deal.id, "next-id"], onNavigate })
    await ready()

    fireEvent.click(screen.getByTitle("Next"))
    expect(onNavigate).toHaveBeenCalledWith("next-id")
  })

  it("disables Previous at the start of the list", async () => {
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S01234" })
    renderModal(deal, { siblingIds: [deal.id, "next-id"], onNavigate: vi.fn() })
    await ready()
    expect(screen.getByTitle("Previous")).toBeDisabled()
  })
})

describe("SorModal — notes", () => {
  it("opens the notes drawer from the crumb bar", async () => {
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S01234" })
    renderModal(deal)
    await ready()

    expect(screen.queryByText("Activity & Log Notes")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /^Notes/ }))
    expect(await screen.findByText("Activity & Log Notes")).toBeInTheDocument()
  })
})
