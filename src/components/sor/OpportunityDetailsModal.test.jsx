/**
 * Issue #53 — opening an SOR that carries a Sales Reference triggers a
 * background fetch against Odoo and, on success, writes the returned product
 * lines straight to the record. It is the only path in the app that mutates
 * an opportunity as a side effect of *viewing* it, and until now it had no
 * coverage at all.
 *
 * Per docs/testing.md this exercises the fake Supabase through the real
 * opportunityService rather than mocking it — only the Odoo edge function
 * itself, a genuine external boundary, is stubbed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"

import { renderWithProviders } from "../../test/support"
import { stubEdgeFunction } from "../../test/msw/server"
import { waitForNetworkIdle } from "../../test/network"
import { makeEmployee, makeOpportunity, makeOpportunityItem } from "../../test/factories"
import { opportunityService } from "../../services/opportunityService"
import OpportunityDetailsModal from "./OpportunityDetailsModal"

let authUser
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

function renderModal(opportunity) {
  const owner = makeEmployee()
  authUser = { id: owner.id, isSuperAdmin: true }
  renderWithProviders(
    <OpportunityDetailsModal isOpen onClose={() => {}} opportunity={opportunity} />,
  )
  return owner
}

const found = (items, extra = {}) => ({
  success: true,
  found: true,
  order: { id: 6070, name: "S06070", state: "sale" },
  customer: { company: "Makati City Government", contact: "" },
  items,
  ...extra,
})

describe("OpportunityDetailsModal — Odoo auto-sync on open (#53)", () => {
  beforeEach(() => {
    stubEdgeFunction("odoo-sor-lookup", found([]))
  })

  it("does not touch the stored Product List when Odoo returns success with no lines", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({
      registered_by: owner.id,
      sales_reference: "S06070",
    })
    makeOpportunityItem(opportunity.id, { product_name: "Existing Pumper" })
    stubEdgeFunction(
      "odoo-sor-lookup",
      found([], { message: "S06070 was found in Odoo but has no product lines yet." }),
    )

    renderModal(opportunity)
    await screen.findByText("Existing Pumper")
    await waitForNetworkIdle()

    const items = await opportunityService.getItems(opportunity.id)
    expect(items.map((i) => i.product_name)).toEqual(["Existing Pumper"])
  })

  it("does not touch the stored Product List when the lookup fails or matches nothing", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({
      registered_by: owner.id,
      sales_reference: "S06070",
    })
    makeOpportunityItem(opportunity.id, { product_name: "Existing Pumper" })
    stubEdgeFunction("odoo-sor-lookup", {
      success: false,
      found: false,
      message: 'No Odoo quotation found matching "S06070".',
    })

    renderModal(opportunity)
    await screen.findByText("Existing Pumper")
    await waitForNetworkIdle()

    const items = await opportunityService.getItems(opportunity.id)
    expect(items.map((i) => i.product_name)).toEqual(["Existing Pumper"])
  })

  it("replaces the stored Product List when Odoo actually returns lines", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({
      registered_by: owner.id,
      sales_reference: "S06070",
    })
    makeOpportunityItem(opportunity.id, { product_name: "Stale Pumper" })
    stubEdgeFunction(
      "odoo-sor-lookup",
      found([{ product_name: "Fresh Ambulance", quantity: 1, unit: "unit", unit_price: 1500 }]),
    )

    renderModal(opportunity)

    await waitFor(async () => {
      const items = await opportunityService.getItems(opportunity.id)
      expect(items.map((i) => i.product_name)).toEqual(["Fresh Ambulance"])
    })
  })

  it("does not run at all for an SOR without a Sales Reference", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({ registered_by: owner.id, sales_reference: null })
    makeOpportunityItem(opportunity.id, { product_name: "Existing Pumper" })

    renderModal(opportunity)
    await screen.findByText("Existing Pumper")
    await waitForNetworkIdle()

    const items = await opportunityService.getItems(opportunity.id)
    expect(items.map((i) => i.product_name)).toEqual(["Existing Pumper"])
  })

  it("syncs a given Sales Reference at most once", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({
      registered_by: owner.id,
      sales_reference: "S06070",
    })
    let calls = 0
    stubEdgeFunction("odoo-sor-lookup", () => {
      calls += 1
      return found([{ product_name: "Fresh Ambulance", quantity: 1, unit: "unit", unit_price: 1500 }])
    })

    renderModal(opportunity)

    await waitFor(async () => {
      const items = await opportunityService.getItems(opportunity.id)
      expect(items.map((i) => i.product_name)).toEqual(["Fresh Ambulance"])
    })
    await waitForNetworkIdle()

    expect(calls).toBe(1)
  })
})

describe("OpportunityDetailsModal — manual Product List fetch (#53)", () => {
  it("refuses to replace stored items with an empty Odoo response", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({
      registered_by: owner.id,
      sales_reference: "S06070",
    })
    makeOpportunityItem(opportunity.id, { product_name: "Existing Pumper" })
    // The auto-sync's own request must not consume the one stub the manual
    // fetch needs, so it is given the same empty response too.
    stubEdgeFunction(
      "odoo-sor-lookup",
      found([], { message: "S06070 was found in Odoo but has no product lines yet." }),
    )

    renderModal(opportunity)
    await screen.findByText("Existing Pumper")
    await waitForNetworkIdle()

    const editButtons = screen.getAllByRole("button", { name: /^edit$/i })
    fireEvent.click(editButtons[0])

    const fetchButton = await screen.findByRole("button", { name: /fetch items/i })
    fireEvent.click(fetchButton)

    await waitForNetworkIdle()

    const items = await opportunityService.getItems(opportunity.id)
    expect(items.map((i) => i.product_name)).toEqual(["Existing Pumper"])
  })
})
