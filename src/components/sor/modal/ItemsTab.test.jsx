/**
 * #301 — the Items tab: client-side search, the two empty states and their
 * different next steps, and a long Product List scrolling under a header
 * that stays put. Real opportunityService on the fake database; only the
 * Odoo edge function is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"

import { renderWithProviders } from "../../../test/support"
import { stubEdgeFunction } from "../../../test/msw/server"
import { makeEmployee, makeOpportunity, makeOpportunityItem } from "../../../test/factories"
import { opportunityService } from "../../../services/opportunityService"
import OpportunityDetailsModal from "../OpportunityDetailsModal"

let authUser
vi.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

const lookup = (items) => ({
  success: true,
  found: true,
  order: { id: 6070, name: "S06070", state: "sale" },
  customer: { company: "Makati City Government", contact: "" },
  items,
})

async function openItems(opportunity) {
  const owner = makeEmployee()
  authUser = { id: owner.id, isSuperAdmin: true }
  renderWithProviders(<OpportunityDetailsModal isOpen onClose={() => {}} opportunity={opportunity} />)
  fireEvent.click(await screen.findByRole("button", { name: /^Products/ }))
}

describe("ItemsTab (#301)", () => {
  beforeEach(() => {
    // Opening an SOR with a Sales Reference auto-syncs once; an empty
    // response leaves the stored list alone, so each test's own rows stand.
    stubEdgeFunction("odoo-sor-lookup", lookup([]))
  })

  it("filters the Product List as you type, without a round trip", async () => {
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S06070" })
    makeOpportunityItem(deal.id, { product_name: "Fire Hose 2in", sort_order: 0 })
    makeOpportunityItem(deal.id, { product_name: "Fire Hose 3in", sort_order: 1 })
    makeOpportunityItem(deal.id, { product_name: "Nozzle", sort_order: 2 })
    await openItems(deal)
    await screen.findByText("Nozzle")

    fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "hose" } })

    expect(screen.getByText("Fire Hose 2in")).toBeInTheDocument()
    expect(screen.getByText("Fire Hose 3in")).toBeInTheDocument()
    expect(screen.queryByText("Nozzle")).not.toBeInTheDocument()
    expect(screen.getByText("2 of 3")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "ladder" } })
    expect(screen.getByText("No product matches that search.")).toBeInTheDocument()
  })

  it("offers Fetch from Odoo when there is a Sales Reference but no items, and it fills the list", async () => {
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S06070" })
    await openItems(deal)

    const fetchButton = await screen.findByRole("button", { name: "Fetch from Odoo" })
    stubEdgeFunction(
      "odoo-sor-lookup",
      lookup([{ product_name: "Pumper Truck", unit: "unit", quantity: 1, unit_price: 5000000 }]),
    )
    fireEvent.click(fetchButton)

    expect(await screen.findByText("Pumper Truck")).toBeInTheDocument()
    await waitFor(async () => {
      const items = await opportunityService.getItems(deal.id)
      expect(items.map((i) => i.product_name)).toEqual(["Pumper Truck"])
    })
  })

  it("asks for a Sales Reference first when there is none, with nothing to fetch", async () => {
    const deal = makeOpportunity({ status: "LEAD", sales_reference: null })
    await openItems(deal)

    expect(await screen.findByText("Add a Sales Reference first")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Fetch from Odoo" })).not.toBeInTheDocument()
  })

  it("scrolls a 150-line list inside its own container, under a header that stays outside it", async () => {
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S06070" })
    for (let i = 0; i < 150; i += 1) {
      makeOpportunityItem(deal.id, { product_name: `Line ${i + 1}`, sort_order: i })
    }
    await openItems(deal)

    const lastRow = await screen.findByText("Line 150")
    const scroller = lastRow.closest(".overflow-y-auto")
    expect(within(scroller).getByText("Line 1")).toBeInTheDocument()
    expect(scroller).not.toContainElement(screen.getByLabelText("Search products"))
    expect(scroller).not.toContainElement(screen.getByText("Product & Unit"))
    expect(screen.getByText("150 items")).toBeInTheDocument()
  })
})
