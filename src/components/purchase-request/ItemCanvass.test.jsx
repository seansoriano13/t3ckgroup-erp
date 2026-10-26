/**
 * The Canvass button on a product line (#682): Purchasing only, off with its reason on a
 * Cancelled, bought or already-canvassing line, and the "Canvass {number} · {n} of 3 offers" line
 * once a Canvass runs. Against the fake database; who may is the policy tier's (180).
 */
import { beforeEach, describe, expect, it } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { openRowNamed } from "@/test/openRequestedItem"
import { renderWithProviders } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { seedCanvass, stubCanvassMoneyRpc } from "@/test/stubs/canvassRpc"
import RequestedItems from "./RequestedItems"

let salesperson, buyer, request

const seedItem = (fields = {}) =>
  db.seed("purchase_request_items", {
    request_id: request.id,
    source: "new",
    name: "Full Body Harness",
    unit: "pc",
    quantity: 10,
    requested_by: salesperson.id,
    ...fields,
  })

const show = () => renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

beforeEach(() => {
  stubCanvassMoneyRpc({ money: true })
  salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  buyer = makeEmployee({ name: "Ben Cruz", department: "OPERATIONS", has_purchasing_flow: true })
  const opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
  request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id, buyer_id: buyer.id })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
})

describe("for Purchasing", () => {
  beforeEach(() => stubPurchaseRequestItemRpcs({ actorId: buyer.id, purchasing: true }))

  it.each(["not_checked", "available", "to_purchase"])("shows an enabled Canvass button on a %s line", async (status) => {
    seedItem({ status })
    show()
    const row = await openRowNamed("Full Body Harness")
    const button = await within(row).findByRole("button", { name: "Canvass Full Body Harness" })
    expect(button).toBeEnabled()
  })

  it.each([
    ["cancelled", "This line is cancelled."],
    ["purchased", "This line is already bought."],
    ["received", "This line is already bought."],
    ["still_canvassing", "A Canvass is already running."],
  ])("turns the button off on a %s line and says why", async (status, reason) => {
    seedItem({ status })
    show()
    const row = await openRowNamed("Full Body Harness")
    const button = await within(row).findByRole("button", { name: "Canvass Full Body Harness" })
    expect(button).toBeDisabled()
    expect(within(row).getByText(reason)).toBeInTheDocument()
  })

  it("shows the Canvass number and offer count once one runs", async () => {
    const item = seedItem({ status: "still_canvassing" })
    const canvass = await seedCanvass({ requestedItemId: item.id }, buyer.id)
    db.seed("sor_canvass_offers", { canvass_id: canvass.id, supplier_name: "Redleaf Inc." })
    db.seed("sor_canvass_offers", { canvass_id: canvass.id, supplier_name: "Ferno" })
    show()
    const row = await openRowNamed("Full Body Harness")
    await waitFor(() => expect(within(row).getByText(`Canvass ${canvass.number} · 2 of 3 offers`)).toBeInTheDocument())
    expect(within(row).getByRole("button", { name: `Open Canvass ${canvass.number} for Full Body Harness` })).toBeEnabled()
  })
})

describe("for Sales", () => {
  beforeEach(() => stubPurchaseRequestItemRpcs({ actorId: salesperson.id }))

  it("shows no Canvass button", async () => {
    seedItem({ status: "to_purchase" })
    show()
    const row = await openRowNamed("Full Body Harness")
    expect(screen.queryByRole("button", { name: /Canvass/ })).not.toBeInTheDocument()
    expect(within(row).queryByTestId("item-canvass")).not.toBeInTheDocument()
  })
})
