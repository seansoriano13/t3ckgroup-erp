/**
 * The Requested Item status controls (#306) on screen, against the fake
 * database with the item RPCs re-implemented on its store. What each side
 * sees and does; who may is the policy tier's (40-purchase-request-item-status).
 */
import { currentRow, openRowNamed, showDoneLines } from "@/test/openRequestedItem"
import { beforeEach, describe, expect, it } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import { Toaster } from "react-hot-toast"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
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

beforeEach(() => {
  salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  buyer = makeEmployee({ name: "Ben Cruz", department: "OPERATIONS", has_purchasing_flow: true })
  const opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
  request = db.seed("purchase_requests", {
    opportunity_id: opportunity.id,
    created_by: salesperson.id,
    buyer_id: buyer.id,
  })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
})

describe("purchasing", () => {
  beforeEach(() => stubPurchaseRequestItemRpcs({ actorId: buyer.id, canSubstitute: true }))

  it("moves an item along the path, and the move posts in the request", async () => {
    seedItem()
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    const row = await rowNamed("Full Body Harness")
    await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
    await statusMenuReady()
    expect(screen.getByRole("button", { name: "Available" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Purchased" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "To purchase" }))

    await waitFor(() => expect(within(currentRow("Full Body Harness")).getByText("To purchase")).toBeInTheDocument())
    expect(db.rows("purchase_request_messages")).toEqual([
      expect.objectContaining({
        author_id: buyer.id,
        metadata: expect.objectContaining({ event: "item_status_changed", from: "not_checked", to: "to_purchase" }),
      }),
    ])
  })

  it("offers Undo after a change, and Undo puts the item back", async () => {
    seedItem()
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)
    render(<Toaster />)

    const row = await rowNamed("Full Body Harness")
    await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
    await statusMenuReady()
    await user.click(screen.getByRole("button", { name: "To purchase" }))
    await waitFor(() => expect(within(currentRow("Full Body Harness")).getByText("To purchase")).toBeInTheDocument())

    await user.click(await screen.findByRole("button", { name: "Undo" }))
    await waitFor(() => expect(within(currentRow("Full Body Harness")).getByText("Not checked")).toBeInTheDocument())
    expect(db.rows("purchase_request_items")[0].status).toBe("not_checked")
  })

  it("holds a long item name to one line and keeps the full name", async () => {
    const name = "Safety Harness Full Body With Double Lanyard And Shock Absorber, Large, Orange, Odoo 4421"
    seedItem({ name })
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    const title = await screen.findByText(name)
    expect(title).toHaveClass("truncate")
    expect(title).toHaveAttribute("title", name)
  })

  it("shows the new status on the row, in its section, when the item is closed", async () => {
    seedItem({ status: "still_canvassing" })
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    const row = await rowNamed("Full Body Harness")
    expect(within(screen.getByRole("region", { name: "Other requests" })).getByText("Full Body Harness")).toBeInTheDocument()
    await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
    await statusMenuReady()
    await user.click(screen.getByRole("button", { name: "Cannot source" }))
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cannot source" }))

    const other = screen.getByRole("region", { name: "Other requests" })
    await waitFor(() => expect(within(within(other).getByTestId("requested-item")).getByText("Cannot source")).toBeInTheDocument())
  })

  it("asks before a way out", async () => {
    seedItem({ status: "still_canvassing" })
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    const row = await rowNamed("Full Body Harness")
    await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
    await statusMenuReady()
    await user.click(screen.getByRole("button", { name: "Cannot source" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "Cannot source" }))

    await waitFor(() => expect(within(currentRow("Full Body Harness")).getByText("Cannot source")).toBeInTheDocument())
    // A closed line has no further steps; Purchasing may still Replace it (#687).
    await user.click(within(currentRow("Full Body Harness")).getByRole("button", { name: /Change status/ }))
    await statusMenuReady()
    expect(screen.getByRole("button", { name: /Replace/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Cancel item" })).not.toBeInTheDocument()
  })

  it("Purchasing replaces a product: it needs a reason, cancels the old line and adds the new one", async () => {
    seedItem({ status: "still_canvassing" })
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    const row = await rowNamed("Full Body Harness")
    await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
    await statusMenuReady()
    await user.click(screen.getByRole("button", { name: /Replace/ }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Replace with"), "Harness, other brand")
    expect(within(dialog).getByRole("button", { name: "Replace product" })).toBeDisabled()
    await user.type(within(dialog).getByLabelText("Reason"), "Brand out of stock")
    await user.click(within(dialog).getByRole("button", { name: "Replace product" }))

    const replacement = await rowNamed("Harness, other brand")
    expect(within(replacement).getByText("Substitute for Full Body Harness")).toBeInTheDocument()
    expect(within(replacement).getByText("Not checked")).toBeInTheDocument()
    await showDoneLines()
    await rowNamed("Full Body Harness")
    await waitFor(() => expect(within(currentRow("Full Body Harness")).getByText("Cancelled")).toBeInTheDocument())
    expect(
      within(currentRow("Full Body Harness")).getAllByText("Replaced by Harness, other brand — Brand out of stock").length,
    ).toBeGreaterThan(0)
  })

  it("an S0 line that was replaced says the S0 still lists it and stays out of the folded list", async () => {
    const old = seedItem({ status: "cancelled", s0_still_lists: true, replaced_reason: "Out of stock" })
    seedItem({ name: "Other brand", substitute_for_item_id: old.id })
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    expect((await screen.findAllByText(/S0 still lists Full Body Harness · Sales to update the S0/)).length).toBeGreaterThan(0)
    expect(screen.queryByTestId("done-row")).not.toBeInTheDocument()
  })
})

describe("the sales side", () => {
  beforeEach(() => stubPurchaseRequestItemRpcs({ actorId: salesperson.id }))

  it("can only cancel, after confirming", async () => {
    seedItem({ status: "purchased" })
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    const row = await rowNamed("Full Body Harness")
    await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
    await statusMenuReady()
    expect(screen.queryByRole("button", { name: "Received" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Cancel item" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "Cancel item" }))

    await showDoneLines()
    await waitFor(() => expect(within(currentRow("Full Body Harness")).getByText("Cancelled")).toBeInTheDocument())
    expect(within(row).queryByRole("button", { name: /Change status/ })).not.toBeInTheDocument()
    expect(db.rows("purchase_request_items")[0]).toMatchObject({ status: "cancelled", status_changed_by: salesperson.id })
  })
})

describe("anyone else", () => {
  it("sees no controls once the item is past the stock check", async () => {
    stubPurchaseRequestItemRpcs({ actorId: salesperson.id, side: "other" })
    seedItem({ status: "purchased" })
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    const row = await rowNamed("Full Body Harness")
    expect(within(row).queryByRole("button", { name: /Change status/ })).not.toBeInTheDocument()
  })
})
