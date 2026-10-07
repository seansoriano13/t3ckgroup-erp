/**
 * Requested Items (#305) on screen, against the fake database with the item
 * RPCs re-implemented on its store. Asserts what a salesperson and a
 * purchaser read and do — names, amounts, stock, "SOR line now says N" —
 * through accessible names, not structure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubRpc } from "@/test/msw/server"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { opportunityService } from "@/services/opportunityService"
import { purchaseRequestService } from "@/services/purchaseRequestService"
import RequestedItems from "./RequestedItems"

vi.mock("browser-image-compression", () => ({ default: async (file) => file }))

const PRODUCT_LIST = [
  { product_name: "Full Body Harness", unit: "pc", quantity: 10, unit_price: 5998.1, odoo_product_id: 101 },
  { product_name: "Rope Access Kit", unit: "set", quantity: 2, unit_price: 30000, odoo_product_id: 202 },
]

let salesperson, opportunity, request

const lineNamed = async (name) =>
  (await opportunityService.getItems(opportunity.id)).find((l) => l.product_name === name)

const rows = () => screen.queryAllByTestId("requested-item")

beforeEach(async () => {
  salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
  await opportunityService.replaceItems(opportunity.id, PRODUCT_LIST)
  db.seed("sor_stock_snapshots", {
    opportunity_id: opportunity.id,
    fetched_at: "2026-10-07T01:30:00Z",
    data: {
      products: {
        101: { type: "product", free: 4, onHand: 6, forecast: 6 },
        202: { type: "product", free: 5, onHand: 5, forecast: 5 },
      },
      warehouses: [],
    },
  })
  request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
  stubPurchaseRequestItemRpcs({ actorId: salesperson.id })
})

describe("RequestedItems", () => {
  it("shows a picked item's stock with its read time, and what its SOR line says now", async () => {
    await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Full Body Harness")).id)
    await opportunityService.replaceItems(opportunity.id, [{ ...PRODUCT_LIST[0], quantity: 12 }, PRODUCT_LIST[1]])

    renderWithProviders(<RequestedItems request={request} />)

    const row = await screen.findByTestId("requested-item")
    expect(within(row).getByText("Full Body Harness")).toBeInTheDocument()
    expect(within(row).getByText("10 pc")).toBeInTheDocument()
    expect(within(row).getByText("Requested")).toBeInTheDocument()
    expect(within(row).getByText("Partial · 4 of 10")).toBeInTheDocument()
    expect(within(row).getByText(/^Stock as of /)).toBeInTheDocument()
    expect(within(row).getByText("SOR line now says 12 pc")).toBeInTheDocument()
  })

  it("adds an item picked from the SOR's Product List", async () => {
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    await user.click(await screen.findByRole("button", { name: "Add from the SOR" }))
    await user.click(await screen.findByRole("checkbox", { name: "Rope Access Kit" }))
    await user.click(screen.getByRole("button", { name: "Request item" }))

    await waitFor(() => expect(rows()).toHaveLength(1))
    const [row] = rows()
    expect(within(row).getByText("Rope Access Kit")).toBeInTheDocument()
    expect(within(row).getByText("2 set")).toBeInTheDocument()
    expect(within(row).getByText("Available")).toBeInTheDocument()
    expect(within(row).queryByText(/SOR line/)).not.toBeInTheDocument()
  })

  it("says which lines are already requested", async () => {
    await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Full Body Harness")).id)
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    await user.click(await screen.findByRole("button", { name: "Add from the SOR" }))
    const harness = (await screen.findByRole("checkbox", { name: "Full Body Harness" })).closest("li")
    const kit = screen.getByRole("checkbox", { name: "Rope Access Kit" }).closest("li")
    expect(within(harness).getByText("Already requested")).toBeInTheDocument()
    expect(within(kit).queryByText("Already requested")).not.toBeInTheDocument()
  })

  it("adds a new product with its description and images", async () => {
    globalThis.URL.createObjectURL = vi.fn(() => "blob:preview")
    globalThis.URL.revokeObjectURL = vi.fn()
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    await user.click(await screen.findByRole("button", { name: "New product" }))
    await user.type(screen.getByLabelText("Product name"), "Custom mounting bracket")
    await user.clear(screen.getByLabelText("Quantity"))
    await user.type(screen.getByLabelText("Quantity"), "4")
    await user.type(screen.getByLabelText("Description"), "Stainless, per the client's drawing")
    await user.upload(
      document.body.querySelector('input[type="file"]'),
      new File(["png"], "bracket.png", { type: "image/png" }),
    )
    await user.click(screen.getByRole("button", { name: "Request it" }))

    await waitFor(() => expect(rows()).toHaveLength(1))
    const [row] = rows()
    expect(within(row).getByText("Custom mounting bracket")).toBeInTheDocument()
    expect(within(row).getByText(/New product/)).toBeInTheDocument()
    expect(within(row).getByText("Stainless, per the client's drawing")).toBeInTheDocument()
    expect(within(row).queryByText(/Stock as of/)).not.toBeInTheDocument()

    const [item] = db.rows("purchase_request_items")
    expect(item.images).toEqual([expect.objectContaining({ name: "bracket.png", url: expect.stringMatching(/^https:\/\//) })])
  })

  it("offers no way to add to someone who may not", async () => {
    stubRpc("purchase_request_can_add_items", () => false)
    renderWithProviders(<RequestedItems request={request} />)

    expect(await screen.findByText("Nothing requested yet")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add from the SOR" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "New product" })).not.toBeInTheDocument()
  })
})
