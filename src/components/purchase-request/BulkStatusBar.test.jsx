/**
 * #852: tick boxes on product lines and the bar offering only the statuses valid for every ticked
 * line. The batch is one call, with one shared reason for the ways out, and one Undo.
 */
import { beforeEach, describe, expect, it } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import { Toaster } from "react-hot-toast"
import { MemoryRouter } from "react-router"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { bulkStatuses } from "@/constants/purchaseRequest"
import RequestedItems from "./RequestedItems"

let salesperson, buyer, request

const seedItem = (name, fields = {}) =>
  db.seed("purchase_request_items", {
    request_id: request.id,
    source: "new",
    name,
    unit: "pc",
    quantity: 10,
    requested_by: salesperson.id,
    status: "not_checked",
    ...fields,
  })

const show = () => renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)
const statusOf = (name) => db.rows("purchase_request_items").find((i) => i.name === name).status

beforeEach(() => {
  salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  buyer = makeEmployee({ name: "Ben Cruz", department: "OPERATIONS", has_purchasing_flow: true })
  const opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
  request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id, buyer_id: buyer.id })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
})

describe("bulkStatuses", () => {
  it("offers only what every line allows", () => {
    const lines = [{ status: "not_checked" }, { status: "to_purchase" }]
    expect(bulkStatuses(lines, "purchasing")).toEqual(["available", "cannot_source", "cancelled"])
    expect(bulkStatuses([{ status: "cancelled" }, { status: "to_purchase" }], "purchasing")).toEqual([])
    expect(bulkStatuses([{ status: "not_checked" }], "sales")).toEqual(["available", "to_purchase", "cancelled"])
  })
})

describe("purchasing", () => {
  beforeEach(() => stubPurchaseRequestItemRpcs({ actorId: buyer.id }))

  it("shows the bar for ticked lines, asks one reason, changes all, and one Undo reverses all", async () => {
    seedItem("Harness")
    seedItem("Rope")
    const user = setupUser()
    show()
    render(<Toaster />)

    await user.click(await screen.findByRole("checkbox", { name: "Select Harness" }))
    await user.click(screen.getByRole("checkbox", { name: "Select Rope" }))
    const bar = screen.getByRole("region", { name: "Change many lines" })
    expect(within(bar).getByText("2 selected")).toBeInTheDocument()
    expect(within(bar).queryByRole("button", { name: "Purchased" })).not.toBeInTheDocument()

    await user.click(within(bar).getByRole("button", { name: "Cannot source" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("button", { name: "Cannot source" })).toBeDisabled()
    await user.type(within(dialog).getByLabelText("Reason"), "Supplier closed")
    await user.click(within(dialog).getByRole("button", { name: "Cannot source" }))

    await waitFor(() => expect(statusOf("Harness")).toBe("cannot_source"))
    expect(statusOf("Rope")).toBe("cannot_source")
    const reasons = db.rows("purchase_request_messages").filter((m) => m.metadata?.event === "item_status_reason")
    expect(reasons).toHaveLength(2)

    await user.click(await screen.findByRole("button", { name: "Undo" }))
    await waitFor(() => expect(statusOf("Harness")).toBe("not_checked"))
    expect(statusOf("Rope")).toBe("not_checked")
  })

  it("changes without a reason for Available and To purchase", async () => {
    seedItem("Harness")
    seedItem("Rope")
    const user = setupUser()
    show()

    await user.click(await screen.findByRole("checkbox", { name: "Select Harness" }))
    await user.click(screen.getByRole("checkbox", { name: "Select Rope" }))
    await user.click(screen.getByRole("button", { name: "To purchase" }))
    await waitFor(() => expect(statusOf("Rope")).toBe("to_purchase"))
    expect(statusOf("Harness")).toBe("to_purchase")
  })
})

describe("a member who may not change status", () => {
  it("sees no tick boxes", async () => {
    const stranger = makeEmployee({ name: "Cy Lim", department: "OPERATIONS" })
    db.seed("purchase_request_members", { request_id: request.id, employee_id: stranger.id, side: "purchasing" })
    stubPurchaseRequestItemRpcs({ actorId: stranger.id, side: null })
    seedItem("Harness")
    show()

    await screen.findByText("Harness")
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Change many lines" })).not.toBeInTheDocument()
  })
})
