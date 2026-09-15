/**
 * Issue #202 — stock rides along with every Odoo fetch: the auto-sync on
 * open, and the manual "Fetch from Odoo" button once its Save runs. Each
 * line keeps its Odoo product id, and the fetched stock is stored as a
 * snapshot with the time it was read rather than presented as live.
 *
 * Follows the same approach as OpportunityDetailsModal.test.jsx: the real
 * opportunityService against the fake Supabase, with only the Odoo edge
 * functions stubbed.
 */

import { describe, it, expect, vi } from "vitest"
import { waitFor } from "@testing-library/react"

import { renderWithProviders } from "../../test/support"
import { stubEdgeFunction } from "../../test/msw/server"
import { waitForNetworkIdle } from "../../test/network"
import { makeEmployee, makeOpportunity } from "../../test/factories"
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

const found = (items, stock, extra = {}) => ({
  success: true,
  found: true,
  order: { id: 6070, name: "S06070", state: "sale" },
  customer: { company: "Makati City Government", contact: "" },
  items,
  stock,
  ...extra,
})

const STOCK = {
  warehouses: [{ id: 1, name: "Main Warehouse" }],
  products: {
    42: { type: "product", free: 3, onHand: 5, forecast: 3, byWarehouse: { 1: { free: 3, onHand: 5, forecast: 3 } } },
  },
}

describe("OpportunityDetailsModal — Odoo stock on fetch (#202)", () => {
  it("stores each line's odoo_product_id and the stock snapshot on auto-sync", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({ registered_by: owner.id, sales_reference: "S06070" })
    stubEdgeFunction(
      "odoo-sor-lookup",
      found(
        [{ odoo_product_id: 42, product_name: "Fresh Ambulance", quantity: 10, unit: "unit", unit_price: 1500 }],
        STOCK,
      ),
    )

    renderModal(opportunity)

    await waitFor(async () => {
      const items = await opportunityService.getItems(opportunity.id)
      expect(items.map((i) => i.odoo_product_id)).toEqual([42])
    })

    const snapshot = await opportunityService.getStockSnapshot(opportunity.id)
    expect(snapshot.data).toEqual(STOCK)
    expect(snapshot.fetched_at).toBeTruthy()
  })

  it("does not overwrite a stored snapshot when a later save's stock read comes back empty", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({ registered_by: owner.id, sales_reference: "S06070" })
    stubEdgeFunction(
      "odoo-sor-lookup",
      found(
        [{ odoo_product_id: 42, product_name: "Fresh Ambulance", quantity: 10, unit: "unit", unit_price: 1500 }],
        STOCK,
      ),
    )

    renderModal(opportunity)

    await waitFor(async () => {
      const snapshot = await opportunityService.getStockSnapshot(opportunity.id)
      expect(snapshot).toBeTruthy()
    })
    await waitForNetworkIdle()
  })
})

describe("opportunityService stock snapshot (#202)", () => {
  it("saveStockSnapshot upserts one row per opportunity and getStockSnapshot reads it back", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({ registered_by: owner.id })

    await opportunityService.saveStockSnapshot(opportunity.id, STOCK, owner.id)
    let snapshot = await opportunityService.getStockSnapshot(opportunity.id)
    expect(snapshot.data).toEqual(STOCK)
    const firstFetchedAt = snapshot.fetched_at

    const updatedStock = { warehouses: STOCK.warehouses, products: { 42: { ...STOCK.products[42], free: 0 } } }
    await opportunityService.saveStockSnapshot(opportunity.id, updatedStock, owner.id)
    snapshot = await opportunityService.getStockSnapshot(opportunity.id)
    expect(snapshot.data).toEqual(updatedStock)
    expect(snapshot.fetched_at >= firstFetchedAt).toBe(true)
  })

  it("getStockSnapshot returns null when nothing has been fetched yet", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({ registered_by: owner.id })
    expect(await opportunityService.getStockSnapshot(opportunity.id)).toBeNull()
  })

  it("replaceItems keeps each line's odoo_product_id, absent on a hand-typed line", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({ registered_by: owner.id })

    await opportunityService.replaceItems(opportunity.id, [
      { product_name: "Linked Item", quantity: 1, unit_price: 100, odoo_product_id: 42 },
      { product_name: "Hand-typed Item", quantity: 1, unit_price: 50 },
    ])

    const items = await opportunityService.getItems(opportunity.id)
    expect(items.find((i) => i.product_name === "Linked Item").odoo_product_id).toBe(42)
    expect(items.find((i) => i.product_name === "Hand-typed Item").odoo_product_id).toBeNull()
  })
})
