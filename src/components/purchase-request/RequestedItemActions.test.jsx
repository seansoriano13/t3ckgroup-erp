/**
 * The Requested Item status controls (#306) on screen, against the fake
 * database with the item RPCs re-implemented on its store. What each side
 * sees and does; who may is the policy tier's (40-purchase-request-item-status).
 */
import { beforeEach, describe, expect, it } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
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
    renderWithProviders(<RequestedItems request={request} />)

    const row = await rowNamed("Full Body Harness")
    await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
    expect(screen.getByRole("button", { name: "From stock" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Ordered" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "To order" }))

    await waitFor(() => expect(within(row).getByText("To order")).toBeInTheDocument())
    expect(db.rows("purchase_request_messages")).toEqual([
      expect.objectContaining({
        author_id: buyer.id,
        metadata: expect.objectContaining({ event: "item_status_changed", from: "requested", to: "to_order" }),
      }),
    ])
  })

  it("asks before a way out", async () => {
    seedItem({ status: "canvassing" })
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    const row = await rowNamed("Full Body Harness")
    await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
    await user.click(screen.getByRole("button", { name: "Cannot source" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "Cannot source" }))

    await waitFor(() => expect(within(row).getByText("Cannot source")).toBeInTheDocument())
    expect(within(row).queryByRole("button", { name: /Change status/ })).not.toBeInTheDocument()
  })

  it("the Buyer offers a substitute, linked to the item it replaces", async () => {
    seedItem({ status: "canvassing" })
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    const row = await rowNamed("Full Body Harness")
    await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
    await user.click(screen.getByRole("button", { name: /Offer a substitute/ }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText("Quantity")).toHaveValue(10)
    await user.type(within(dialog).getByLabelText("Product name"), "Harness, other brand")
    await user.click(within(dialog).getByRole("button", { name: "Offer substitute" }))

    const substitute = await rowNamed("Harness, other brand")
    expect(within(substitute).getByText("Substitute for Full Body Harness")).toBeInTheDocument()
    expect(within(substitute).getByText("Requested")).toBeInTheDocument()
    const original = await rowNamed("Full Body Harness")
    await waitFor(() => expect(within(original).getByText("Substituted")).toBeInTheDocument())
    expect(within(original).getByText("Replaced by Harness, other brand")).toBeInTheDocument()
  })
})

describe("the sales side", () => {
  beforeEach(() => stubPurchaseRequestItemRpcs({ actorId: salesperson.id }))

  it("can only cancel, after confirming", async () => {
    seedItem({ status: "ordered" })
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    const row = await rowNamed("Full Body Harness")
    expect(within(row).queryByRole("button", { name: /Change status/ })).not.toBeInTheDocument()
    await user.click(within(row).getByRole("button", { name: "Cancel Full Body Harness" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "Cancel item" }))

    await waitFor(() => expect(within(row).getByText("Cancelled")).toBeInTheDocument())
    expect(db.rows("purchase_request_items")[0]).toMatchObject({ status: "cancelled", status_changed_by: salesperson.id })
  })
})

describe("anyone else", () => {
  it("sees no controls", async () => {
    stubPurchaseRequestItemRpcs({ actorId: salesperson.id, side: "other" })
    seedItem()
    renderWithProviders(<RequestedItems request={request} />)

    const row = await rowNamed("Full Body Harness")
    expect(within(row).queryAllByRole("button")).toEqual([])
  })
})
