/**
 * "Is this from your purchase request?" (#688, spec #675) on screen: a new S0 line for a product
 * already bought as an Other request shows "Is this yours?"; Yes moves the P0 onto the S0 line and
 * closes the request, No clears the question. Only the database proves the merge; here the fake
 * database re-implements it, and the test asserts what a person reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { opportunityService } from "@/services/opportunityService"
import RequestedItems from "./RequestedItems"

vi.mock("browser-image-compression", () => ({ default: async (file) => file }))

let salesperson, opportunity, request

const itemRow = (name) => db.internal.rowsOf("purchase_request_items").find((i) => i.name === name)
const seedOther = (patch = {}) =>
  db.seed("purchase_request_items", {
    request_id: request.id,
    source: "new",
    name: "Harness for the client",
    quantity: 4,
    unit: "pc",
    status: "purchased",
    purpose: "client",
    po_number: "P01234",
    po_verification: "VERIFIED",
    po_state: "confirmed",
    po_ordered: 4,
    po_received: 1,
    bought_as: "Full Body Harness",
    bought_product_id: 101,
    requested_by: salesperson.id,
    ...patch,
  })

async function addToS0(odooProductId = 101) {
  await opportunityService.replaceItems(opportunity.id, [
    { product_name: "Full Body Harness", unit: "pc", quantity: 4, unit_price: 100, odoo_product_id: odooProductId, odoo_line_id: 9001 },
  ])
}

beforeEach(() => {
  salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
  request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
  stubPurchaseRequestItemRpcs({ actorId: salesperson.id })
})

describe("Is this yours?", () => {
  it("asks when a new S0 line is the same Odoo product as an Other request's P0, showing both side by side", async () => {
    seedOther()
    await addToS0()
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    await user.click(await screen.findByRole("button", { name: /Is Full Body Harness yours/ }))
    const dialog = await screen.findByRole("dialog", { name: "Is this from your purchase request?" })
    expect(within(dialog).getByRole("region", { name: "New on the S0" })).toHaveTextContent("Full Body Harness")
    expect(within(dialog).getByRole("region", { name: "Your request" })).toHaveTextContent("Harness for the client")
    expect(within(dialog).getByRole("region", { name: "Your request" })).toHaveTextContent("P01234")
  })

  it("Yes moves the P0 and status onto the S0 line and closes the request with a note", async () => {
    seedOther()
    await addToS0()
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    await user.click(await screen.findByRole("button", { name: /Is Full Body Harness yours/ }))
    await user.click(await screen.findByRole("button", { name: "Yes, same product" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(itemRow("Full Body Harness")).toMatchObject({ status: "purchased", po_number: "P01234", new_on_s0: false })
    expect(itemRow("Harness for the client")).toMatchObject({
      status: "cancelled",
      closed_note: "Closed · P01234 and its delivery moved onto Full Body Harness",
    })
    expect(db.internal.rowsOf("purchase_request_items")).toHaveLength(2)
    expect(screen.queryByText("Is this yours?")).not.toBeInTheDocument()
  })

  it("No clears the question and changes nothing else", async () => {
    seedOther()
    await addToS0()
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    await user.click(await screen.findByRole("button", { name: /Is Full Body Harness yours/ }))
    await user.click(await screen.findByRole("button", { name: "No, they are different" }))

    await waitFor(() => expect(screen.queryByText("Is this yours?")).not.toBeInTheDocument())
    expect(itemRow("Full Body Harness")).toMatchObject({ status: "not_checked", po_number: null })
    expect(itemRow("Harness for the client")).toMatchObject({ status: "purchased", po_number: "P01234" })
  })

  it("holds a finished line open until someone answers", async () => {
    seedOther({ status: "received", po_received: 4 })
    await addToS0()
    itemRow("Full Body Harness").status = "available"
    renderWithProviders(<RequestedItems request={request} />)

    const s0 = await screen.findByRole("region", { name: "From the S0" })
    expect(within(s0).getAllByTestId("requested-item")).toHaveLength(1)
    expect(within(s0).queryByText(/done/)).not.toBeInTheDocument()
  })

  it("asks nothing when the products differ or the Other request has no P0", async () => {
    seedOther({ bought_product_id: 999 })
    seedOther({ name: "Another ask", po_number: undefined, status: "to_purchase", bought_product_id: 101 })
    await addToS0()
    renderWithProviders(<RequestedItems request={request} />)

    await screen.findByRole("region", { name: "From the S0" })
    expect(screen.queryByText("Is this yours?")).not.toBeInTheDocument()
  })
})
