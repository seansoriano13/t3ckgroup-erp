/**
 * The product list's table layout (#695, after the prototype of spec #675) on screen: a header row
 * over each section, the columns of a line, and the opened line's fields and Purchasing buttons.
 */
import { openRowNamed } from "@/test/openRequestedItem"
import { beforeEach, describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { syncRequestItems } from "@/test/stubs/sorItemSync"
import { opportunityService } from "@/services/opportunityService"
import { MemoryRouter } from "react-router"
import RequestedItems from "./RequestedItems"

let salesperson, buyer, request, opportunity

/** An Other request (no S0 line). */
const seedOther = (fields = {}) =>
  db.seed("purchase_request_items", {
    request_id: request.id,
    source: "new",
    name: "Glow sticks",
    unit: "pc",
    quantity: 300,
    status: "still_canvassing",
    requested_by: salesperson.id,
    ...fields,
  })

/** The S0's one product, as the database makes it on opening the request, with `fields` set on it. */
async function seedS0(fields = {}) {
  await opportunityService.replaceItems(opportunity.id, [
    { product_name: "[M18C] Milwaukee Charger M18", unit: "pc", quantity: 2, unit_price: 6800, odoo_product_id: 101, odoo_line_id: 9001 },
  ])
  syncRequestItems(opportunity.id)
  Object.assign(db.internal.rowsOf("purchase_request_items").find((i) => i.name.includes("Milwaukee")), { status: "to_purchase", ...fields })
}

const show = (actorId) => {
  stubPurchaseRequestItemRpcs({ actorId })
  renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)
}

beforeEach(() => {
  salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  buyer = makeEmployee({ name: "Ben Cruz", department: "OPERATIONS", has_purchasing_flow: true })
  opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
  request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id, buyer_id: buyer.id })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
})

describe("the product list as a table", () => {
  it("heads each section with its columns, and the first and third differ for Other requests", async () => {
    await seedS0()
    seedOther({ purpose: "client" })
    show(buyer.id)

    const s0 = await screen.findByRole("region", { name: "From the S0" })
    const other = screen.getByRole("region", { name: "Other requests" })
    for (const heading of ["Product", "Qty", "Stock", "Status", "P0", "Delivery and notes"]) {
      expect(within(s0).getAllByText(heading)[0]).toHaveClass("uppercase")
    }
    for (const heading of ["What was asked", "Qty", "For", "Status", "P0", "Delivery and notes"]) {
      expect(within(other).getAllByText(heading)[0]).toHaveClass("uppercase")
    }
  })

  it("shows a line's name over its Odoo code, its quantity, stock, P0 and delivery note", async () => {
    await seedS0({
      status: "purchased",
      po_number: "P09683",
      po_verification: "VERIFIED",
      po_ordered: 2,
      po_received: 0,
      po_eta: "2026-10-30",
    })
    show(buyer.id)

    const row = (await screen.findAllByTestId("requested-item"))[0]
    expect(within(row).getByText("Milwaukee Charger M18")).toBeInTheDocument()
    expect(within(row).getByText("[M18C]")).toBeInTheDocument()
    expect(within(row).getByText("×2 pc")).toBeInTheDocument()
    expect(within(row).getAllByText("Not read yet").length).toBeGreaterThan(0)
    expect(within(row).getAllByText("P09683").length).toBeGreaterThan(0)
    expect(within(row).getByText("Not received yet · ETA Oct 30")).toBeInTheDocument()
  })

  it("shows an Other request as what was asked, what it is for, and who asked when", async () => {
    seedOther({
      name: "Plastic boat, 60 hp",
      purpose: "client",
      status: "purchased",
      po_number: "P09731",
      po_verification: "VERIFIED",
      bought_as: "Plastic Rescue Boat 60 hp",
      quantity: 1,
      po_ordered: 1,
      po_received: 0,
      created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    })
    show(buyer.id)

    const row = (await screen.findAllByTestId("requested-item"))[0]
    expect(within(row).getByText("Asked as: Plastic boat, 60 hp")).toBeInTheDocument()
    expect(within(row).getByText("Bought as: Plastic Rescue Boat 60 hp")).toBeInTheDocument()
    expect(within(row).getAllByText("Asked by Sales · 2 days ago").length).toBeGreaterThan(0)
    expect(within(row).getAllByText("For the client").length).toBeGreaterThan(0)
  })

  it("opens a line to its fields and, for Purchasing, the Canvass, Attach P0 and Replace buttons", async () => {
    await seedS0({ po_number: "P09718", po_state: "rfq", po_verification: "VERIFIED" })
    show(buyer.id)

    const row = await openRowNamed("Milwaukee Charger M18")
    for (const label of ["Stock", "Odoo code", "P0"]) {
      expect(within(row).getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(within(row).getByText(/RFQ only, not confirmed/)).toBeInTheDocument()
    expect(within(row).getByRole("button", { name: "Canvass [M18C] Milwaukee Charger M18" })).toBeInTheDocument()
    expect(within(row).getByRole("button", { name: "Attach P0" })).toBeEnabled()
    expect(within(row).getByRole("button", { name: "Replace" })).toBeEnabled()
  })

  it("gives Sales the line's fields but not the Purchasing buttons", async () => {
    await seedS0()
    show(salesperson.id)

    const row = await openRowNamed("Milwaukee Charger M18")
    expect(within(row).getAllByText("Odoo code").length).toBeGreaterThan(0)
    expect(within(row).queryByRole("button", { name: "Attach P0" })).not.toBeInTheDocument()
    expect(within(row).queryByRole("button", { name: "Replace" })).not.toBeInTheDocument()
  })

  it("scrolls the table sideways rather than the page", async () => {
    await seedS0()
    show(buyer.id)

    const s0 = await screen.findByRole("region", { name: "From the S0" })
    expect(within(s0).getByText("Product").closest(".overflow-x-auto")).not.toBeNull()
  })
})

describe("the No Odoo product tag (#807)", () => {
  it("shows on an open Other request with no Odoo product", async () => {
    seedOther({ status: "still_canvassing", odoo_product_id: null })
    show(buyer.id)

    const row = (await screen.findAllByTestId("requested-item"))[0]
    expect(within(row).getByText("No Odoo product")).toBeInTheDocument()
  })

  it("shows on an open S0 line whose product was typed, not picked from Odoo", async () => {
    await seedS0({ odoo_product_id: null, odoo_line_id: null })
    show(buyer.id)

    const row = await openRowNamed("Milwaukee Charger M18")
    expect(within(row).getByText("No Odoo product")).toBeInTheDocument()
  })

  it("is hidden on a line that has an Odoo product", async () => {
    await seedS0()
    show(buyer.id)

    const row = await openRowNamed("Milwaukee Charger M18")
    expect(within(row).queryByText("No Odoo product")).not.toBeInTheDocument()
  })

  it("is hidden on a Cancelled item even with no Odoo product", async () => {
    seedOther({ status: "cancelled", odoo_product_id: null })
    show(buyer.id)

    // A Cancelled line folds into "1 done", so open that first.
    const other = await screen.findByRole("region", { name: "Other requests" })
    await setupUser().click(within(other).getByRole("button", { name: "show" }))
    const row = within(other).getByTestId("requested-item")
    expect(within(row).queryByText("No Odoo product")).not.toBeInTheDocument()
  })
})
