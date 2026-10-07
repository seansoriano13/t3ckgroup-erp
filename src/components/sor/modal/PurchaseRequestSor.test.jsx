/**
 * #310 — the SOR reads its Purchase Request: the Now card (items, open count,
 * Buyer; opens the request), each Product List line's Requested Item status,
 * and nothing at all for an SOR with no request. Real services on the fake
 * database; the overview RPC (plpgsql) is stubbed.
 */
import { describe, it, expect, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"

import { renderWithProviders } from "../../../test/support"
import { stubEdgeFunction, stubRpc } from "../../../test/msw/server"
import { makeEmployee, makeOpportunity, makeOpportunityItem } from "../../../test/factories"
import OpportunityDetailsModal from "../OpportunityDetailsModal"

let authUser
vi.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

const row = (items) => [
  { request_id: "req-1", buyer_id: "emp-b", buyer_name: "Bea Buyer", buyer_avatar_path: null, opened_visit_id: null, created_at: "2026-01-01T00:00:00Z", items },
]
const pr = (over) => ({ id: "x", name: "Item", odoo_product_id: null, quantity: 1, unit: null, status: "requested", source: "sor_line", created_at: "2026-01-02T00:00:00Z", ...over })

function open(deal) {
  const owner = makeEmployee()
  authUser = { id: owner.id, isSuperAdmin: true }
  stubEdgeFunction("odoo-sor-lookup", { success: true, found: true, order: { id: 1, name: "S1", state: "sale" }, customer: {}, items: [] })
  renderWithProviders(<OpportunityDetailsModal isOpen onClose={() => {}} opportunity={deal} />)
}

describe("Purchase Request on the SOR (#310)", () => {
  it("Now card shows item count, open count and Buyer, and opens the request", async () => {
    stubRpc("sor_purchase_request_overview", row([pr({ id: "1" }), pr({ id: "2", status: "ordered" }), pr({ id: "3", status: "received" })]))
    const opened = vi.fn()
    window.addEventListener("OPEN_ENTITY_DETAILS", (e) => opened(e.detail))
    open(makeOpportunity({ status: "QUALIFIED", sales_reference: "S06070" }))

    fireEvent.click(await screen.findByRole("button", { name: /^This stage/ }))
    expect(await screen.findByText("3 items")).toBeInTheDocument()
    expect(screen.getByText(/2 open/)).toBeInTheDocument()
    expect(screen.getByText("Buyer: Bea Buyer")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open request" }))
    expect(opened).toHaveBeenCalledWith({ id: "req-1", type: "PURCHASE_REQUEST" })
  })

  it("Items tab shows the status of a line that has a Requested Item, matched by product", async () => {
    stubRpc("sor_purchase_request_overview", row([pr({ id: "1", odoo_product_id: 55, name: "Old name", status: "to_order" })]))
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S06070" })
    makeOpportunityItem(deal.id, { product_name: "Fire Hose", odoo_product_id: 55, sort_order: 0 })
    makeOpportunityItem(deal.id, { product_name: "Nozzle", odoo_product_id: 56, sort_order: 1 })
    open(deal)
    fireEvent.click(await screen.findByRole("button", { name: /^Products/ }))
    await screen.findByText("Nozzle")

    await waitFor(() => expect(screen.getAllByTitle("Requested Item status")).toHaveLength(1))
    expect(screen.getByTitle("Requested Item status")).toHaveTextContent("To order")
  })

  it("an SOR with no Purchase Request shows none of it", async () => {
    stubRpc("sor_purchase_request_overview", [])
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S06070" })
    makeOpportunityItem(deal.id, { product_name: "Fire Hose", odoo_product_id: 55 })
    open(deal)
    await screen.findByRole("button", { name: /^Products/ })
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByText("Purchase Request")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open request" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /^Products/ }))
    await screen.findByText("Fire Hose")
    expect(screen.queryByTitle("Requested Item status")).not.toBeInTheDocument()
  })
})
