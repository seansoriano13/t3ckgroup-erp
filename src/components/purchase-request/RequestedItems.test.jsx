/**
 * Requested Items (#305, #678) on screen, against the fake database with the item RPCs and the
 * S0-line triggers re-implemented on its store. Asserts what a salesperson and a purchaser read
 * and do: the two sections, each product's name, amount and status, stock, "Removed from S0",
 * through accessible names, not structure.
 */
import { openRow } from "@/test/openRequestedItem"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { renderWithProviders, setupUser, chooseOption } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubRpc } from "@/test/msw/server"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { syncRequestItems } from "@/test/stubs/sorItemSync"
import { opportunityService } from "@/services/opportunityService"
import RequestedItems from "./RequestedItems"

vi.mock("browser-image-compression", () => ({ default: async (file) => file }))

const PRODUCT_LIST = [
  { product_name: "Full Body Harness", unit: "pc", quantity: 10, unit_price: 5998.1, odoo_product_id: 101, odoo_line_id: 9001 },
  { product_name: "Rope Access Kit", unit: "set", quantity: 2, unit_price: 30000, odoo_product_id: 202, odoo_line_id: 9002 },
]

let salesperson, opportunity, request

const rows = () => screen.queryAllByTestId("requested-item")
const itemRow = (name) => db.internal.rowsOf("purchase_request_items").find((i) => i.name === name)

const HOUR = 60 * 60 * 1000
const hoursAgo = (n) => new Date(Date.now() - n * HOUR).toISOString()
const STOCK = {
  products: {
    101: { type: "product", free: 4, onHand: 6, forecast: 6 },
    202: { type: "product", free: 5, onHand: 5, forecast: 5 },
  },
  warehouses: [],
}

beforeEach(async () => {
  salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
  await opportunityService.replaceItems(opportunity.id, PRODUCT_LIST)
  db.seed("sor_stock_snapshots", { opportunity_id: opportunity.id, fetched_at: hoursAgo(2), data: STOCK })
  request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
  stubPurchaseRequestItemRpcs({ actorId: salesperson.id })
  // The request opened: one item for every S0 line.
  syncRequestItems(opportunity.id)
})

describe("RequestedItems", () => {
  it("shows the S0's products under From the S0 and everything else under Other requests, each with its status", async () => {
    db.seed("purchase_request_items", {
      request_id: request.id,
      source: "new",
      name: "Custom mounting bracket",
      quantity: 4,
      unit: "pc",
      status: "to_purchase",
      requested_by: salesperson.id,
    })
    itemRow("Rope Access Kit").status = "available"

    renderWithProviders(<RequestedItems request={request} />)

    const s0 = await screen.findByRole("region", { name: "From the S0" })
    const other = screen.getByRole("region", { name: "Other requests" })
    const s0Rows = within(s0).getAllByTestId("requested-item")
    expect(s0Rows).toHaveLength(2)
    expect(within(s0Rows[0]).getByText("Full Body Harness")).toBeInTheDocument()
    expect(within(s0Rows[0]).getByText("10 pc")).toBeInTheDocument()
    expect(within(s0Rows[0]).getByText("Not checked")).toBeInTheDocument()
    expect(within(s0Rows[1]).getByText("Rope Access Kit")).toBeInTheDocument()
    expect(within(s0Rows[1]).getAllByText("Available").length).toBeGreaterThan(0)
    expect(within(s0Rows[1]).queryByText("Not checked")).not.toBeInTheDocument()

    const otherRows = within(other).getAllByTestId("requested-item")
    expect(otherRows).toHaveLength(1)
    expect(within(otherRows[0]).getByText("Custom mounting bracket")).toBeInTheDocument()
    expect(within(otherRows[0]).getByText("To purchase")).toBeInTheDocument()
  })

  it("lists the S0's products with no typing, and says when there are no other requests", async () => {
    renderWithProviders(<RequestedItems request={request} />)

    const s0 = await screen.findByRole("region", { name: "From the S0" })
    expect(within(s0).getAllByTestId("requested-item")).toHaveLength(2)
    const other = screen.getByRole("region", { name: "Other requests" })
    expect(within(other).getByText("No other requests.")).toBeInTheDocument()
  })

  it("opens a row only when asked", async () => {
    renderWithProviders(<RequestedItems request={request} />)

    const row = (await screen.findAllByTestId("requested-item"))[0]
    expect(within(row).getByRole("button", { name: /^Open details of/ })).toHaveAttribute("aria-expanded", "false")
    await openRow(row)
    expect(within(row).getByText("Requested by")).toBeInTheDocument()
    expect(within(row).getByText("From the S0", { selector: "dd" })).toBeInTheDocument()
  })

  it("shows the quantity as the S0 now says it, and no flag", async () => {
    await opportunityService.replaceItems(opportunity.id, [{ ...PRODUCT_LIST[0], quantity: 12 }, PRODUCT_LIST[1]])
    renderWithProviders(<RequestedItems request={request} />)

    const row = (await screen.findAllByTestId("requested-item"))[0]
    expect(within(row).getByText("12 pc")).toBeInTheDocument()
    expect(within(row).queryByText(/Removed from S0|SOR changed/)).not.toBeInTheDocument()
  })

  it("keeps a product Odoo dropped on the list, marked Removed from S0", async () => {
    await opportunityService.replaceItems(opportunity.id, [PRODUCT_LIST[1]])
    renderWithProviders(<RequestedItems request={request} />)

    const s0 = await screen.findByRole("region", { name: "From the S0" })
    const [harness, kit] = within(s0).getAllByTestId("requested-item")
    expect(within(harness).getByText("Full Body Harness")).toBeInTheDocument()
    // The note sits under the name and again in the opened details.
    expect(within(harness).getAllByText("Removed from S0").length).toBeGreaterThan(0)
    expect(within(kit).queryByText("Removed from S0")).not.toBeInTheDocument()
  })

  it("offers none of the old flows: pick from the SOR, update to the SOR, keep as asked", async () => {
    await opportunityService.replaceItems(opportunity.id, [{ ...PRODUCT_LIST[0], quantity: 12 }, PRODUCT_LIST[1]])
    renderWithProviders(<RequestedItems request={request} />)

    const row = await openRow((await screen.findAllByTestId("requested-item"))[0])
    for (const name of ["Add from the SOR", "Pick from SOR", "Update to SOR", "Update to the SOR", "Keep as asked", "Add from the Costing Matrix"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByTestId("unrequested-sor-lines")).not.toBeInTheDocument()
    expect(within(row).queryByText("SOR changed")).not.toBeInTheDocument()
  })

  it("shows an item's stock with its read time", async () => {
    renderWithProviders(<RequestedItems request={request} />)

    const row = await openRow((await screen.findAllByTestId("requested-item"))[0])
    expect(within(row).getByText("Partial · 4 of 10")).toBeInTheDocument()
    expect(within(row).getByText(/^Stock as of /)).toBeInTheDocument()
    expect(within(row).queryByText("Stale")).not.toBeInTheDocument()
  })

  it("reads stock through the request, so a Buyer without SOR access still sees it (#501)", async () => {
    // The SOR's own snapshot row is hidden from a Buyer; the request hands it over.
    db.internal.rowsOf("sor_stock_snapshots").splice(0)
    stubRpc("purchase_request_stock_snapshot", ({ p_request_id }) =>
      p_request_id === request.id ? { fetched_at: hoursAgo(1), data: STOCK } : null,
    )

    renderWithProviders(<RequestedItems request={request} />)

    const row = await openRow((await screen.findAllByTestId("requested-item"))[1])
    expect(await within(row).findByText("Available", { selector: "span" })).toBeInTheDocument()
    expect(within(row).getByText(/^Stock as of /)).toBeInTheDocument()
  })

  it("marks stock read more than a day ago Stale (#501)", async () => {
    stubRpc("purchase_request_stock_snapshot", () => ({ fetched_at: hoursAgo(72), data: STOCK }))

    renderWithProviders(<RequestedItems request={request} />)

    const row = await openRow((await screen.findAllByTestId("requested-item"))[0])
    expect(await within(row).findByText("Partial · 4 of 10")).toBeInTheDocument()
    expect(within(row).getByText("Stale")).toBeInTheDocument()
  })

  it("adds a new product as an Other request, with its description and images", async () => {
    globalThis.URL.createObjectURL = vi.fn(() => "blob:preview")
    globalThis.URL.revokeObjectURL = vi.fn()
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    await user.click(await screen.findByRole("button", { name: "Ask for a product" }))
    await user.type(screen.getByLabelText("What do you need?"), "Custom mounting bracket")
    await user.clear(screen.getByLabelText("Quantity"))
    await user.type(screen.getByLabelText("Quantity"), "4")
    await user.type(screen.getByLabelText("Description"), "Stainless, per the client's drawing")
    await user.upload(
      document.body.querySelector('input[type="file"]'),
      new File(["png"], "bracket.png", { type: "image/png" }),
    )
    await chooseOption(user, screen.getByRole("combobox", { name: "What is it for?" }), "Material for the job")
    await user.click(screen.getByRole("button", { name: "Send request" }))

    const other = screen.getByRole("region", { name: "Other requests" })
    await waitFor(() => expect(within(other).getAllByTestId("requested-item")).toHaveLength(1))
    const row = await openRow(within(other).getByTestId("requested-item"))
    expect(within(row).getByText("Custom mounting bracket")).toBeInTheDocument()
    expect(within(row).getByText("Other request", { selector: "dd" })).toBeInTheDocument()
    expect(within(row).getByText("Stainless, per the client's drawing")).toBeInTheDocument()
    expect(within(row).queryByText(/Stock as of/)).not.toBeInTheDocument()
    expect(rows()).toHaveLength(3)

    const item = db.rows("purchase_request_items").find((i) => i.name === "Custom mounting bracket")
    expect(item).toMatchObject({ purpose: "job", status: "not_checked" })
    expect(item.images).toEqual([expect.objectContaining({ name: "bracket.png", url: expect.stringMatching(/^https:\/\//) })])
  })

  it("offers no way to add to someone who may not", async () => {
    stubRpc("purchase_request_can_add_items", () => false)
    renderWithProviders(<RequestedItems request={request} />)

    await screen.findAllByTestId("requested-item")
    expect(screen.queryByRole("button", { name: "Ask for a product" })).not.toBeInTheDocument()
  })

  describe("the price copied from a Canvass winner (#582)", () => {
    it("shows the price on the row when the database returns it", async () => {
      const kit = itemRow("Rope Access Kit")
      db.seed("purchase_request_item_prices", { item_id: kit.id, unit_price: 1250.5, currency: "PHP" })

      renderWithProviders(<RequestedItems request={request} />)

      const row = await openRow((await screen.findAllByTestId("requested-item"))[1])
      expect(await within(row).findByTestId("requested-item-price")).toHaveTextContent("PHP 1,250.50 each")
    })

    it("shows no price when the database returns none, as for a member who may not see prices", async () => {
      renderWithProviders(<RequestedItems request={request} />)

      const row = await openRow((await screen.findAllByTestId("requested-item"))[1])
      expect(within(row).getByText("Rope Access Kit")).toBeInTheDocument()
      expect(within(row).queryByTestId("requested-item-price")).not.toBeInTheDocument()
    })
  })
})
