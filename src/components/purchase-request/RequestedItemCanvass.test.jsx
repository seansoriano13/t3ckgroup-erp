/**
 * The Canvass action on a Requested Item (#280) on screen, against the fake database: the
 * purchasing side gets a "Canvass" action on an item with none, everyone who reads the request
 * sees the number and signed state where one exists, and an item that names a Component shows
 * that Component's Canvass. The panel's own contents are covered by the CanvassPanel tests.
 */
import { openRowNamed } from "@/test/openRequestedItem"
import { beforeEach, describe, expect, it } from "vitest"
import { within } from "@testing-library/react"
import { renderWithProviders } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { MemoryRouter } from "react-router"
import RequestedItems from "./RequestedItems"

let salesperson, buyer, request

const rowNamed = openRowNamed

const seedComponent = () => {
  const matrix = db.seed("costing_matrices", { opportunity_id: request.opportunity_id })
  const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1 })
  return db.seed("costing_components", { tender_line_id: line.id, name: "Hose", position: 1 })
}

const seedItem = (fields = {}) =>
  db.seed("purchase_request_items", {
    request_id: request.id,
    source: "new",
    name: "Printer paper",
    unit: "ream",
    quantity: 5,
    requested_by: salesperson.id,
    ...fields,
  })

beforeEach(() => {
  salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  buyer = makeEmployee({ name: "Ben Cruz", department: "OPERATIONS", has_purchasing_flow: true })
  const opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
  request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id, buyer_id: buyer.id })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
})

describe("purchasing", () => {
  beforeEach(() => stubPurchaseRequestItemRpcs({ actorId: buyer.id, purchasing: true }))

  it("offers a Canvass on an item that has none", async () => {
    seedItem()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)
    const row = await rowNamed("Printer paper")
    expect(await within(row).findByRole("link", { name: "Canvass Printer paper" })).toBeInTheDocument()
  })

  it("sends the purchaser to the Canvasses page for the item", async () => {
    const item = seedItem()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)
    const row = await rowNamed("Printer paper")
    const link = await within(row).findByRole("link", { name: "Canvass Printer paper" })
    expect(link).toHaveAttribute("href", `/purchasing/canvasses?item=${item.id}`)
  })

  it("sends an item on a Component to the Component's Canvass", async () => {
    const component = seedComponent()
    const item = seedItem({ component_id: component.id })
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)
    const row = await rowNamed("Printer paper")
    const link = await within(row).findByRole("link", { name: "Canvass Printer paper" })
    expect(link).toHaveAttribute("href", `/purchasing/canvasses?component=${item.component_id}`)
  })

  it("offers no Canvass on a cancelled item", async () => {
    seedItem({ status: "cancelled" })
    seedItem({ name: "Toner" })
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)
    const toner = await rowNamed("Toner")
    expect(await within(toner).findByRole("link", { name: "Canvass Toner" })).toBeInTheDocument()
    const row = await rowNamed("Printer paper")
    expect(within(row).queryByRole("link", { name: /Canvass/ })).not.toBeInTheDocument()
  })

  it("shows the number and signed state of an item's Canvass", async () => {
    const item = seedItem()
    db.seed("sor_canvasses", { requested_item_id: item.id, number: "CNV_0001", signed_off_at: "2026-10-19T08:00:00Z" })
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)
    const row = await rowNamed("Printer paper")
    expect(await within(row).findByRole("link", { name: "Open Canvass CNV_0001 for Printer paper" })).toBeInTheDocument()
    expect(within(row).getByTestId("canvass-signed-state")).toHaveTextContent("Signed off")
  })
})

describe("sales side", () => {
  beforeEach(() => stubPurchaseRequestItemRpcs({ actorId: salesperson.id, side: "sales" }))

  it("has no action to start a Canvass, but sees one that exists", async () => {
    seedItem({ name: "Toner" })
    const canvassed = seedItem({ name: "Printer paper" })
    db.seed("sor_canvasses", { requested_item_id: canvassed.id, number: "CNV_0001" })
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    const paper = await rowNamed("Printer paper")
    expect(await within(paper).findByRole("link", { name: /Open Canvass CNV_0001/ })).toBeInTheDocument()
    expect(within(paper).getByTestId("canvass-signed-state")).toHaveTextContent("Not signed")
    const toner = await rowNamed("Toner")
    expect(within(toner).queryByTestId("requested-item-canvass")).not.toBeInTheDocument()
  })
})
