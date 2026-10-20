/**
 * The PO number and PO line on Ordered (#312) on screen, against the fake
 * database with the item RPCs re-implemented on its store and Odoo's
 * `odoo-po-verify` stubbed. Who may and which lines are accepted is the
 * policy tier's (43-purchase-request-item-po).
 */
import { beforeEach, describe, expect, it } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { statusMenuReady } from "./statusMenuReady"
import RequestedItems from "./RequestedItems"

let salesperson, buyer, request

const rowNamed = async (name) => (await screen.findByText(name)).closest("[data-testid='requested-item']")

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

async function openOrderDialog(user) {
  const row = await rowNamed("Full Body Harness")
  await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
  await statusMenuReady()
  await user.click(screen.getByRole("button", { name: "Ordered" }))
  return { row, dialog: await screen.findByRole("dialog") }
}

beforeEach(() => {
  salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  buyer = makeEmployee({ name: "Ben Cruz", department: "OPERATIONS", has_purchasing_flow: true })
  const opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
  request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id, buyer_id: buyer.id })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
})

describe("setting Ordered", () => {
  beforeEach(() => stubPurchaseRequestItemRpcs({ actorId: buyer.id }))

  it("works with no PO number", async () => {
    seedItem({ status: "to_order" })
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    const { row, dialog } = await openOrderDialog(user)
    await user.click(within(dialog).getByRole("button", { name: "Mark Ordered" }))

    await waitFor(() => expect(within(row).getByText("Ordered")).toBeInTheDocument())
    expect(db.rows("purchase_request_items")[0]).toMatchObject({ status: "ordered", po_number: null })
    expect(within(row).queryByText("PO line not picked")).not.toBeInTheDocument()
  })

  it("checks a PO number against Odoo, stores it, and says its line isn't picked", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found" })
    seedItem({ status: "to_order" })
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    const { row, dialog } = await openOrderDialog(user)
    await user.type(within(dialog).getByLabelText("PO number (optional)"), "p01234")
    await user.click(within(dialog).getByRole("button", { name: "Check PO and mark Ordered" }))

    await waitFor(() => expect(within(row).getByText("PO P01234")).toBeInTheDocument())
    expect(within(row).getByText(/Confirmed in Odoo/)).toBeInTheDocument()
    expect(within(row).getByText("PO line not picked")).toBeInTheDocument()
    expect(db.rows("purchase_request_items")[0]).toMatchObject({ po_number: "P01234", po_verification: "VERIFIED" })
  })

  it("shows the PO as not checked when Odoo doesn't answer", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "unreachable" })
    seedItem({ status: "to_order" })
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    const { row, dialog } = await openOrderDialog(user)
    await user.type(within(dialog).getByLabelText("PO number (optional)"), "P01234")
    await user.click(within(dialog).getByRole("button", { name: "Check PO and mark Ordered" }))

    await waitFor(() => expect(within(row).getByText("PO P01234")).toBeInTheDocument())
    expect(within(row).getByText(/Not checked/)).toBeInTheDocument()
    expect(db.rows("purchase_request_items")[0]).toMatchObject({ po_number: "P01234", po_verification: "PENDING_VERIFICATION" })
  })

  it("saves nothing when Odoo says there is no such PO", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "not_found" })
    seedItem({ status: "to_order" })
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    const { dialog } = await openOrderDialog(user)
    await user.type(within(dialog).getByLabelText("PO number (optional)"), "P09999")
    await user.click(within(dialog).getByRole("button", { name: "Check PO and mark Ordered" }))

    await waitFor(() => expect(db.rows("purchase_request_items")[0]).toMatchObject({ status: "to_order", po_number: null }))
  })

  it("won't save a number that isn't an Odoo PO", async () => {
    seedItem({ status: "to_order" })
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    const { dialog } = await openOrderDialog(user)
    await user.type(within(dialog).getByLabelText("PO number (optional)"), "PO-12")
    expect(within(dialog).getByText(/"P" followed by digits/)).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Check PO and mark Ordered" })).toBeDisabled()
  })
})

describe("picking the PO line", () => {
  it("is not offered while the PO has no IPAS", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })
    seedItem({ status: "ordered", po_number: "P01234", po_verification: "VERIFIED" })
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    const row = await rowNamed("Full Body Harness")
    expect(within(row).getByText("PO line not picked")).toBeInTheDocument()
    await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
    await statusMenuReady()
    expect(screen.getByRole("button", { name: "Received" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Pick PO line/ })).not.toBeInTheDocument()
  })

  it("picks lines from the PO's IPAS copy once it exists, even after Received", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, ipasLines: { P01234: [501, 502] } })
    seedItem({ status: "received", po_number: "P01234", po_verification: "VERIFIED" })
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    const row = await rowNamed("Full Body Harness")
    await user.click(await within(row).findByRole("button", { name: "Change status of Full Body Harness" }))
    await statusMenuReady()
    await user.click(screen.getByRole("button", { name: /Pick PO line/ }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("checkbox", { name: "PO line 502" }))
    await user.click(within(dialog).getByRole("button", { name: "Pick line" }))

    await waitFor(() => expect(within(row).getByText(/PO line 502/)).toBeInTheDocument())
    expect(within(row).queryByText("PO line not picked")).not.toBeInTheDocument()
    expect(db.rows("purchase_request_items")[0].odoo_po_line_ids).toEqual([502])
  })

  it("the sales side sees the PO but can't pick", async () => {
    stubPurchaseRequestItemRpcs({ actorId: salesperson.id, ipasLines: { P01234: [501] } })
    seedItem({ status: "received", po_number: "P01234", po_verification: "VERIFIED" })
    renderWithProviders(<RequestedItems request={request} />)

    const row = await rowNamed("Full Body Harness")
    expect(within(row).getByText("PO P01234")).toBeInTheDocument()
    expect(within(row).getByText("PO line not picked")).toBeInTheDocument()
    expect(within(row).queryAllByRole("button")).toEqual([])
  })
})
