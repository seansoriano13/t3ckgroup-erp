/**
 * Issue #202 — stock rides along with every Odoo fetch: the auto-sync on
 * open, and the manual "Fetch from Odoo" button once its Save runs. Each
 * line keeps its Odoo product id, and the fetched stock is stored as a
 * snapshot with the time it was read rather than presented as live. Refresh
 * re-reads stock without touching the lines, and a failed refresh keeps the
 * last figures and their timestamp.
 *
 * Follows the same approach as OpportunityDetailsModal.test.jsx: the real
 * opportunityService against the fake Supabase, with only the Odoo edge
 * functions stubbed.
 */

import { describe, it, expect, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"

import { renderWithProviders } from "../../test/support"
import { stubEdgeFunction, stubRpc } from "../../test/msw/server"
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

  it("keeps the previous snapshot when the lookup's stock read failed (stock: null)", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({ registered_by: owner.id, sales_reference: "S06070" })
    await opportunityService.saveStockSnapshot(opportunity.id, STOCK, owner.id)
    stubEdgeFunction(
      "odoo-sor-lookup",
      found([{ odoo_product_id: 42, product_name: "Fresh Ambulance", quantity: 10, unit: "unit", unit_price: 1500 }], null),
    )

    renderModal(opportunity)

    await waitFor(async () => {
      const items = await opportunityService.getItems(opportunity.id)
      expect(items.map((i) => i.odoo_product_id)).toEqual([42])
    })

    const snapshot = await opportunityService.getStockSnapshot(opportunity.id)
    expect(snapshot.data).toEqual(STOCK)
  })

  it("keeps the last figures and their timestamp when Refresh fails", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({ registered_by: owner.id, sales_reference: "S06070" })
    makeOpportunityItem(opportunity.id, {
      product_name: "Fresh Ambulance",
      quantity: 10,
      odoo_product_id: 42,
    })
    await opportunityService.saveStockSnapshot(opportunity.id, STOCK, owner.id)
    const before = await opportunityService.getStockSnapshot(opportunity.id)

    stubEdgeFunction("odoo-sor-lookup", found([], { message: "no lines" }))
    stubEdgeFunction("odoo-product-stock", {
      success: false,
      message: "Odoo did not answer.",
    })

    renderModal(opportunity)
    fireEvent.click(await screen.findByRole("button", { name: /^Products/ }))
    await screen.findByText("Fresh Ambulance")
    await waitForNetworkIdle()

    const refreshButton = await screen.findByRole("button", { name: /refresh/i })
    fireEvent.click(refreshButton)
    await waitForNetworkIdle()

    const after = await opportunityService.getStockSnapshot(opportunity.id)
    expect(after.data).toEqual(before.data)
    expect(after.fetched_at).toEqual(before.fetched_at)
  })
})

describe("OpportunityDetailsModal — Product List stock badges (#202)", () => {
  it("renders each badge kind, the freshness line, and the warehouse breakdown on expand", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({ registered_by: owner.id, sales_reference: null })
    makeOpportunityItem(opportunity.id, { product_name: "Ample Item", quantity: 5, odoo_product_id: 1 })
    makeOpportunityItem(opportunity.id, { product_name: "Short Item", quantity: 10, odoo_product_id: 2 })
    makeOpportunityItem(opportunity.id, { product_name: "Gone Item", quantity: 1, odoo_product_id: 3 })
    makeOpportunityItem(opportunity.id, { product_name: "Service Item", quantity: 1, odoo_product_id: 4 })
    makeOpportunityItem(opportunity.id, { product_name: "Typed Item", quantity: 1, odoo_product_id: null })
    makeOpportunityItem(opportunity.id, { product_name: "Unread Item", quantity: 1, odoo_product_id: 5 })

    const snapshot = {
      warehouses: [{ id: 1, name: "Main Warehouse" }],
      products: {
        1: { type: "product", free: 5, onHand: 5, forecast: 5, byWarehouse: { 1: { free: 5, onHand: 5, forecast: 5 } } },
        2: { type: "product", free: 4, onHand: 4, forecast: 4, byWarehouse: { 1: { free: 4, onHand: 4, forecast: 4 } } },
        3: { type: "product", free: 0, onHand: 0, forecast: 0, byWarehouse: { 1: { free: 0, onHand: 0, forecast: 0 } } },
        4: { type: "service", free: 0, onHand: 0, forecast: 0, byWarehouse: {} },
      },
    }
    await opportunityService.saveStockSnapshot(opportunity.id, snapshot, owner.id)

    renderModal(opportunity)
    fireEvent.click(await screen.findByRole("button", { name: /^Products/ }))
    await screen.findByText("Ample Item")

    expect(screen.getByText("Available")).toBeInTheDocument()
    expect(screen.getByText("Partial · 4 of 10")).toBeInTheDocument()
    expect(screen.getByText("Out of stock")).toBeInTheDocument()
    expect(screen.getByText("Not tracked")).toBeInTheDocument()
    expect(screen.getByText("Not linked to Odoo")).toBeInTheDocument()
    expect(screen.getByText("Not checked")).toBeInTheDocument()
    expect(screen.getByText(/Stock as of/)).toBeInTheDocument()

    fireEvent.click(screen.getByText("Available"))
    expect(await screen.findByText("Main Warehouse")).toBeInTheDocument()
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
