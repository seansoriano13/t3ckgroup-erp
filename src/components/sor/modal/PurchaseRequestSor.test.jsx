/**
 * #310 — the SOR reads its Purchase Request: the card (items, open count,
 * Buyer; opens the request) on the PMS tab (moved there from the Summary and
 * This stage by #268), each Product List line's Requested Item status, and
 * nothing at all for an SOR with no request. Real services on the fake
 * database; the overview RPC (plpgsql) is stubbed.
 */
import { describe, it, expect, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"

import { renderWithProviders } from "../../../test/support"
import { stubEdgeFunction, stubRpc } from "../../../test/msw/server"
import { makeEmployee, makeOpportunity, makeOpportunityItem } from "../../../test/factories"
import { stubCostingMatrixRpcs } from "../../../test/stubs/costingMatrixRpc"
import OpportunityDetailsModal from "../OpportunityDetailsModal"

let authUser
vi.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

const row = (items) => [
  { request_id: "req-1", buyer_id: "emp-b", buyer_name: "Bea Buyer", buyer_avatar_path: null, opened_visit_id: null, created_at: "2026-01-01T00:00:00Z", items },
]
const pr = (over) => ({ id: "x", name: "Item", odoo_product_id: null, quantity: 1, unit: null, status: "not_checked", source: "sor_line", created_at: "2026-01-02T00:00:00Z", ...over })

function open(deal) {
  const owner = makeEmployee()
  authUser = { id: owner.id, isSuperAdmin: true }
  stubEdgeFunction("odoo-sor-lookup", { success: true, found: true, order: { id: 1, name: "S1", state: "sale" }, customer: {}, items: [] })
  // The PMS tab shows to anyone with a Costing Matrix read tier on the SOR.
  stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] })
  renderWithProviders(
    <MemoryRouter>
      <OpportunityDetailsModal isOpen onClose={() => {}} opportunity={deal} />
    </MemoryRouter>,
  )
}

describe("Purchase Request on the SOR (#310)", () => {
  it("the PMS card shows item count, open count and Buyer, and opens the request", async () => {
    stubRpc("sor_purchase_request_overview", row([pr({ id: "1" }), pr({ id: "2", status: "purchased" }), pr({ id: "3", status: "received" })]))
    const opened = vi.fn()
    window.addEventListener("OPEN_ENTITY_DETAILS", (e) => opened(e.detail))
    open(makeOpportunity({ status: "QUALIFIED", sales_reference: "S06070" }))

    fireEvent.click(await screen.findByRole("button", { name: /^PMS/ }))
    expect(await screen.findByText("3 items")).toBeInTheDocument()
    expect(screen.getByText(/2 open/)).toBeInTheDocument()
    expect(screen.getByText("Buyer: Bea Buyer")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open request" }))
    expect(opened).toHaveBeenCalledWith({ id: "req-1", type: "PURCHASE_REQUEST" })
  })

  it("shows the card on neither the Summary nor This stage any more", async () => {
    stubRpc("sor_purchase_request_overview", row([pr({ id: "1" })]))
    open(makeOpportunity({ status: "QUALIFIED", sales_reference: "S06070" }))

    await screen.findByRole("button", { name: /^PMS/ })
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByText("Buyer: Bea Buyer")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /^This stage/ }))
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByText("Buyer: Bea Buyer")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open request" })).not.toBeInTheDocument()
  })

  it("Items tab shows the status of a line that has a Requested Item, matched by product", async () => {
    stubRpc("sor_purchase_request_overview", row([pr({ id: "1", odoo_product_id: 55, name: "Old name", status: "to_purchase" })]))
    const deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S06070" })
    makeOpportunityItem(deal.id, { product_name: "Fire Hose", odoo_product_id: 55, sort_order: 0 })
    makeOpportunityItem(deal.id, { product_name: "Nozzle", odoo_product_id: 56, sort_order: 1 })
    open(deal)
    fireEvent.click(await screen.findByRole("button", { name: /^Products/ }))
    await screen.findByText("Nozzle")

    await waitFor(() => expect(screen.getAllByTitle("Requested Item status")).toHaveLength(1))
    expect(screen.getByTitle("Requested Item status")).toHaveTextContent("To purchase")
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
