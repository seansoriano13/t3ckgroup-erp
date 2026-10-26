/**
 * The PO number and PO line on Ordered (#312) on screen, against the fake
 * database with the item RPCs re-implemented on its store and Odoo's
 * `odoo-po-verify` stubbed. Who may and which lines are accepted is the
 * policy tier's (43-purchase-request-item-po).
 */
import { currentRow, openRowNamed, showDoneLines } from "@/test/openRequestedItem"
import { beforeEach, describe, expect, it } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubEdgeFunction } from "@/test/msw/server"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { statusMenuReady } from "@/test/support/statusMenuReady"
import { MemoryRouter } from "react-router"
import RequestedItems from "./RequestedItems"

let salesperson, buyer, request

const rowNamed = openRowNamed

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

async function openAttachDialog(user) {
  const row = await rowNamed("Full Body Harness")
  await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
  await statusMenuReady()
  await user.click(screen.getByRole("button", { name: /Attach P0/ }))
  return { row, dialog: await screen.findByRole("dialog") }
}

const SUGGESTIONS = {
  success: true,
  suggested: [
    { id: 1, name: "P01111", state: "purchase", supplier: "Acme", lines: [{ product_id: 7, product_name: "Full Body Harness XL", quantity: 10, received: 0 }] },
    { id: 2, name: "P01112", state: "draft", supplier: "Acme", lines: [{ product_id: 7, product_name: "Full Body Harness", quantity: 10, received: 0 }] },
  ],
  others: [{ id: 3, name: "P01113", state: "purchase", supplier: "Bolt", lines: [{ product_id: 9, product_name: "Carabiner", quantity: 4, received: 0 }] }],
}

beforeEach(() => {
  salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  buyer = makeEmployee({ name: "Ben Cruz", department: "OPERATIONS", has_purchasing_flow: true })
  const opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
  request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id, buyer_id: buyer.id })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
})

describe("Attach P0", () => {
  const asked = []
  const mount = () => renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)
  const attach = async (user, po) => {
    const { dialog } = await openAttachDialog(user)
    await user.click(await within(dialog).findByRole("button", { name: `Choose ${po}` }))
    await user.click(within(dialog).getByRole("button", { name: `Attach ${po}` }))
    return dialog
  }
  const typeAndAttach = async (user, po) => {
    const { dialog } = await openAttachDialog(user)
    await user.type(within(dialog).getByLabelText("Or type a P0 number"), po)
    await user.click(within(dialog).getByRole("button", { name: `Attach ${po.toUpperCase()}` }))
    return dialog
  }

  beforeEach(() => {
    asked.length = 0
    request = { ...request, sales_reference: "S01237" }
    stubEdgeFunction("odoo-po-suggest", (body) => {
      asked.push(body)
      return SUGGESTIONS
    })
  })

  it("lists the P0s that name the S0: the same product first, then the others", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found" })
    seedItem({ status: "to_purchase", odoo_product_id: 7 })
    mount()

    const { dialog } = await openAttachDialog(setupUser())
    expect(await within(dialog).findByRole("button", { name: "Choose P01111" })).toBeInTheDocument()
    expect(asked).toEqual([{ reference: "S01237", productId: 7 }])
    const suggested = within(dialog).getByRole("group", { name: "Suggested P0s" })
    const others = within(dialog).getByRole("group", { name: "Other P0s" })
    expect(within(suggested).getAllByTestId("p0-suggestion")).toHaveLength(2)
    expect(within(others).getByText("P01113")).toBeInTheDocument()
    expect(within(suggested).getByText(/RFQ: the line stays To purchase/)).toBeInTheDocument()
  })

  it("attaches a confirmed P0 with one confirmation: Purchased, and says what was bought", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found", p0s: { P01111: { bought_as: "Full Body Harness XL" } } })
    seedItem({ status: "to_purchase", odoo_product_id: 7 })
    mount()
    await attach(setupUser(), "P01111")

    await waitFor(() => expect(db.rows("purchase_request_items")[0].status).toBe("purchased"))
    expect(db.rows("purchase_request_items")[0]).toMatchObject({ status: "purchased", po_number: "P01111", bought_as: "Full Body Harness XL" })
    expect(screen.getByTestId("requested-item-bought-as")).toHaveTextContent("Full Body Harness XL")
    expect(screen.getByText("Asked as")).toBeInTheDocument()
  })

  it("keeps the line To purchase for an RFQ and says so", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found", p0s: { P01112: { state: "rfq" } } })
    seedItem({ status: "to_purchase", odoo_product_id: 7 })
    mount()
    await attach(setupUser(), "P01112")

    await waitFor(() => expect(within(currentRow("Full Body Harness")).getByText("RFQ P01112")).toBeInTheDocument())
    expect(db.rows("purchase_request_items")[0]).toMatchObject({ status: "to_purchase", po_state: "rfq" })
  })

  it("makes the line Received when everything has arrived", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found", p0s: { P01111: { ordered: 10, received: 10 } } })
    seedItem({ status: "to_purchase", odoo_product_id: 7 })
    mount()
    await attach(setupUser(), "P01111")

    await waitFor(() => expect(db.rows("purchase_request_items")[0]).toMatchObject({ status: "received", po_number: "P01111" }))
  })

  it("attaches a typed number once Odoo has confirmed it", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found" })
    seedItem({ status: "to_purchase" })
    mount()
    await typeAndAttach(setupUser(), "p01234")

    await waitFor(() => expect(db.rows("purchase_request_items")[0]).toMatchObject({ status: "purchased", po_number: "P01234" }))
  })

  it("saves nothing when Odoo says there is no such P0", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "not_found" })
    seedItem({ status: "to_purchase" })
    mount()
    const dialog = await typeAndAttach(setupUser(), "P09999")

    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Attach P09999" })).toBeEnabled())
    expect(db.rows("purchase_request_items")[0]).toMatchObject({ status: "to_purchase", po_number: null })
  })

  it("saves nothing when Odoo doesn't answer: a P0 is never attached unseen", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "unreachable" })
    seedItem({ status: "to_purchase" })
    mount()
    const dialog = await typeAndAttach(setupUser(), "P01234")

    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Attach P01234" })).toBeEnabled())
    expect(db.rows("purchase_request_items")[0]).toMatchObject({ status: "to_purchase", po_number: null })
  })

  it("won't send a number that isn't an Odoo P0", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })
    seedItem({ status: "to_purchase" })
    mount()
    const user = setupUser()
    const { dialog } = await openAttachDialog(user)
    await user.type(within(dialog).getByLabelText("Or type a P0 number"), "PO-12")
    expect(within(dialog).getByText(/"P" followed by digits/)).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Attach P0" })).toBeDisabled()
  })

  it("searches a Direct request by its PR number", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })
    request = db.seed("purchase_requests", { opportunity_id: null, created_by: salesperson.id, buyer_id: buyer.id, pr_number: "PR_0042" })
    db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
    seedItem({ status: "to_purchase" })
    mount()
    const { dialog } = await openAttachDialog(setupUser())
    await within(dialog).findByText("Suggested from Odoo")
    expect(asked).toEqual([{ reference: "PR_0042", productId: null }])
  })

  it("is off on a Received line", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })
    seedItem({ status: "received" })
    mount()
    await screen.findByText(/done/)
    expect(screen.queryByRole("button", { name: /Change status/ })).not.toBeInTheDocument()
  })

  it("can't choose Purchased by hand", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })
    seedItem({ status: "to_purchase" })
    mount()
    const user = setupUser()
    const row = await rowNamed("Full Body Harness")
    await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
    await statusMenuReady()
    expect(screen.queryByRole("button", { name: "Purchased" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Attach P0/ })).toBeInTheDocument()
  })
})

describe("picking the PO line", () => {
  it("is not offered while the PO has no IPAS", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id })
    seedItem({ status: "purchased", po_number: "P01234", po_verification: "VERIFIED" })
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    const row = await rowNamed("Full Body Harness")
    expect(within(currentRow("Full Body Harness")).getByText("PO line not picked")).toBeInTheDocument()
    await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
    await statusMenuReady()
    expect(screen.getByRole("button", { name: /Attach P0/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Pick PO line/ })).not.toBeInTheDocument()
  })

  it("picks lines from the PO's IPAS copy once it exists, even after Received", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, ipasLines: { P01234: [501, 502] } })
    seedItem({ status: "received", po_number: "P01234", po_verification: "VERIFIED" })
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    await showDoneLines()
    const row = await rowNamed("Full Body Harness")
    await user.click(await within(row).findByRole("button", { name: "Change status of Full Body Harness" }))
    await statusMenuReady()
    await user.click(screen.getByRole("button", { name: /Pick PO line/ }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("checkbox", { name: "PO line 502" }))
    await user.click(within(dialog).getByRole("button", { name: "Pick line" }))

    await waitFor(() => expect(within(currentRow("Full Body Harness")).getByText(/PO line 502/)).toBeInTheDocument())
    expect(within(currentRow("Full Body Harness")).queryByText("PO line not picked")).not.toBeInTheDocument()
    expect(db.rows("purchase_request_items")[0].odoo_po_line_ids).toEqual([502])
  })

  it("the sales side sees the PO but can't pick", async () => {
    stubPurchaseRequestItemRpcs({ actorId: salesperson.id, ipasLines: { P01234: [501] } })
    seedItem({ status: "received", po_number: "P01234", po_verification: "VERIFIED" })
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    await showDoneLines()
    const row = await rowNamed("Full Body Harness")
    expect(within(row).getByText("PO P01234")).toBeInTheDocument()
    expect(within(currentRow("Full Body Harness")).getByText("PO line not picked")).toBeInTheDocument()
    expect(within(row).queryByRole("button", { name: /Change status/ })).not.toBeInTheDocument()
  })
})

describe("Correct PO", () => {
  async function openCorrectDialog(user) {
    const row = await rowNamed("Full Body Harness")
    await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
    await statusMenuReady()
    await user.click(screen.getByRole("button", { name: /Correct PO/ }))
    return { row, dialog: await screen.findByRole("dialog") }
  }

  it("swaps the PO on an Ordered item, checks it, and clears the picked line", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found" })
    seedItem({ status: "purchased", po_number: "P01111", po_verification: "VERIFIED", odoo_po_line_ids: [501] })
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    const { dialog } = await openCorrectDialog(user)
    await user.type(within(dialog).getByLabelText("New PO number"), "p01234")
    await user.click(within(dialog).getByRole("button", { name: "Check PO and correct" }))

    await waitFor(() => expect(within(currentRow("Full Body Harness")).getByText(/^PO P01234/)).toBeInTheDocument())
    expect(db.rows("purchase_request_items")[0]).toMatchObject({ po_number: "P01234", po_verification: "VERIFIED", odoo_po_line_ids: [] })
  })

  it("keeps the old PO when Odoo says the new one doesn't exist", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "not_found" })
    seedItem({ status: "purchased", po_number: "P01111", po_verification: "VERIFIED" })
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    const { dialog } = await openCorrectDialog(user)
    await user.type(within(dialog).getByLabelText("New PO number"), "P09999")
    await user.click(within(dialog).getByRole("button", { name: "Check PO and correct" }))

    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Check PO and correct" })).toBeEnabled())
    expect(db.rows("purchase_request_items")[0]).toMatchObject({ po_number: "P01111" })
  })

  it("won't send a number that isn't an Odoo PO", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found" })
    seedItem({ status: "purchased", po_number: "P01111", po_verification: "VERIFIED" })
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    const { dialog } = await openCorrectDialog(user)
    await user.type(within(dialog).getByLabelText("New PO number"), "PO-12")
    expect(within(dialog).getByRole("button", { name: "Check PO and correct" })).toBeDisabled()
  })

  it("is not offered to the sales side", async () => {
    stubPurchaseRequestItemRpcs({ actorId: salesperson.id, odoo: "found" })
    seedItem({ status: "purchased", po_number: "P01111", po_verification: "VERIFIED" })
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    const row = await rowNamed("Full Body Harness")
    await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
    await statusMenuReady()
    expect(screen.getByRole("button", { name: "Cancel item" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Correct PO/ })).not.toBeInTheDocument()
  })

  it("is not offered once the item is Received", async () => {
    stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found" })
    seedItem({ status: "received", po_number: "P01111", po_verification: "VERIFIED" })
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    await showDoneLines()
    const row = await rowNamed("Full Body Harness")
    expect(within(row).queryByRole("button", { name: "Change status of Full Body Harness" })).not.toBeInTheDocument()
  })
})
