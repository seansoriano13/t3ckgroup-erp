/**
 * Requested Items (#305) on screen, against the fake database with the item
 * RPCs re-implemented on its store. Asserts what a salesperson and a
 * purchaser read and do — names, amounts, stock, "SOR line now says N" —
 * through accessible names, not structure.
 */
import { openRow } from "@/test/openRequestedItem"
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
import { groupItems } from "./requestedItemGroups"

vi.mock("browser-image-compression", () => ({ default: async (file) => file }))

const PRODUCT_LIST = [
  { product_name: "Full Body Harness", unit: "pc", quantity: 10, unit_price: 5998.1, odoo_product_id: 101 },
  { product_name: "Rope Access Kit", unit: "set", quantity: 2, unit_price: 30000, odoo_product_id: 202 },
]

let salesperson, opportunity, request

const lineNamed = async (name) =>
  (await opportunityService.getItems(opportunity.id)).find((l) => l.product_name === name)

const rows = () => screen.queryAllByTestId("requested-item")

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
})

describe("groupItems", () => {
  const at = (status) => ({ id: status, status })

  it("splits items into To do, In progress and Closed, in that order, leaving out empty groups", () => {
    const groups = groupItems(["cancelled", "ordered", "requested", "to_order", "received"].map(at))
    expect(groups.map((g) => [g.label, g.list.map((i) => i.status)])).toEqual([
      ["To do", ["requested", "to_order"]],
      ["In progress", ["ordered"]],
      ["Closed", ["cancelled", "received"]],
    ])
    expect(groupItems([at("requested")]).map((g) => g.label)).toEqual(["To do"])
  })
})

describe("RequestedItems", () => {
  it("lists items under their group with a count, and opens a row only when asked", async () => {
    await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Full Body Harness")).id)
    renderWithProviders(<RequestedItems request={request} />)

    const group = await screen.findByRole("region", { name: "To do" })
    expect(within(group).getByText("1")).toBeInTheDocument()
    const row = within(group).getByTestId("requested-item")
    expect(within(row).getByRole("button", { name: /^Open details of/ })).toHaveAttribute("aria-expanded", "false")
    await openRow(row)
    expect(within(row).getByText("Requested by")).toBeInTheDocument()
  })

  it("shows a picked item's stock with its read time, and what its SOR line says now", async () => {
    await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Full Body Harness")).id)
    await opportunityService.replaceItems(opportunity.id, [{ ...PRODUCT_LIST[0], quantity: 12 }, PRODUCT_LIST[1]])

    renderWithProviders(<RequestedItems request={request} />)

    const row = await openRow(await screen.findByTestId("requested-item"))
    expect(within(row).getByText("Full Body Harness")).toBeInTheDocument()
    expect(within(row).getByText("10 pc")).toBeInTheDocument()
    expect(within(row).getByText("Requested")).toBeInTheDocument()
    expect(within(row).getByText("Partial · 4 of 10")).toBeInTheDocument()
    expect(within(row).getByText(/^Stock as of /)).toBeInTheDocument()
    expect(within(row).queryByText("Stale")).not.toBeInTheDocument()
    expect(within(row).getByText("SOR line now says 12 pc")).toBeInTheDocument()
  })

  describe("when the SOR line changed", () => {
    const changeHarness = async () => {
      await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Full Body Harness")).id)
      await opportunityService.replaceItems(opportunity.id, [{ ...PRODUCT_LIST[0], quantity: 12 }, PRODUCT_LIST[1]])
    }

    it("flags the row in the list, before it is opened", async () => {
      await changeHarness()
      renderWithProviders(<RequestedItems request={request} />)

      const row = await screen.findByTestId("requested-item")
      expect(within(row).getByText("SOR changed")).toBeInTheDocument()
    })

    it("shows what was asked beside what the SOR says now", async () => {
      await changeHarness()
      renderWithProviders(<RequestedItems request={request} />)

      const row = await openRow(await screen.findByTestId("requested-item"))
      const asked = (await within(row).findByText("Asked")).closest("div")
      expect(asked).toHaveTextContent("10 pc")
      const now = within(row).getByText("SOR now").closest("div")
      expect(now).toHaveTextContent("12 pc")
      // The part that moved is the only part marked: bold now, struck through when asked.
      expect(within(now).getByText("12")).toHaveClass("font-bold")
      expect(within(now).getByText("pc")).not.toHaveClass("font-bold")
      expect(within(asked).getByText("10")).toHaveClass("line-through")
    })

    it("updates the item to the SOR, and the request chat says so", async () => {
      const user = setupUser()
      await changeHarness()
      renderWithProviders(<RequestedItems request={request} />)

      const row = await openRow(await screen.findByTestId("requested-item"))
      await user.click(await within(row).findByRole("button", { name: "Update to SOR" }))
      await user.click(await screen.findByRole("button", { name: "Update item" }))

      await waitFor(() => expect(within(rows()[0]).getByText("12 pc")).toBeInTheDocument())
      expect(within(rows()[0]).queryByText("SOR changed")).not.toBeInTheDocument()
      expect(
        db.internal.rowsOf("purchase_request_messages").some((m) => m.metadata?.event === "item_followed_sor"),
      ).toBe(true)
    })

    it("asks for a reason before following the SOR on an Ordered item", async () => {
      const user = setupUser()
      await changeHarness()
      db.internal.rowsOf("purchase_request_items")[0].status = "ordered"
      renderWithProviders(<RequestedItems request={request} />)

      const row = await openRow(await screen.findByTestId("requested-item"))
      await user.click(await within(row).findByRole("button", { name: "Update to SOR" }))
      const update = await screen.findByRole("button", { name: "Update item" })
      expect(update).toBeDisabled()
      await user.type(screen.getByRole("textbox"), "Client added two")
      expect(update).toBeEnabled()
    })

    it("warns that a Canvass was done on the old quantity", async () => {
      const user = setupUser()
      await changeHarness()
      const [item] = await purchaseRequestService.listItems(request.id)
      const listItems = vi
        .spyOn(purchaseRequestService, "listItems")
        .mockResolvedValue([{ ...item, canvass: { id: "c1", number: "CNV_1", signed: true } }])
      renderWithProviders(<RequestedItems request={request} />)

      const row = await openRow(await screen.findByTestId("requested-item"))
      await user.click(await within(row).findByRole("button", { name: "Update to SOR" }))
      expect(await screen.findByText(/Quantity changed since the Canvass/)).toBeInTheDocument()
      listItems.mockRestore()
    })

    it("keeps the item as asked, and the flag goes quiet", async () => {
      const user = setupUser()
      await changeHarness()
      renderWithProviders(<RequestedItems request={request} />)

      const row = await openRow(await screen.findByTestId("requested-item"))
      await user.click(await within(row).findByRole("button", { name: "Keep as asked" }))

      await waitFor(() => expect(within(rows()[0]).queryByText("SOR changed")).not.toBeInTheDocument())
      expect(within(rows()[0]).getByText("10 pc")).toBeInTheDocument()
    })

    it("says a removed line is gone and offers no update", async () => {
      await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Full Body Harness")).id)
      await opportunityService.replaceItems(opportunity.id, [PRODUCT_LIST[1]])
      renderWithProviders(<RequestedItems request={request} />)

      const row = await openRow(await screen.findByTestId("requested-item"))
      expect(await within(row).findAllByText("SOR line removed")).not.toHaveLength(0)
      expect(within(row).queryByRole("button", { name: "Update to SOR" })).not.toBeInTheDocument()
    })

    it("has no flag on a closed item", async () => {
      await changeHarness()
      db.internal.rowsOf("purchase_request_items")[0].status = "cancelled"
      renderWithProviders(<RequestedItems request={request} />)

      const row = await screen.findByTestId("requested-item")
      expect(within(row).queryByText("SOR changed")).not.toBeInTheDocument()
    })
  })

  it("says how many SOR lines are not requested yet, and opens the picker from the hint", async () => {
    const user = setupUser()
    await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Full Body Harness")).id)
    renderWithProviders(<RequestedItems request={request} />)

    const hint = await screen.findByTestId("unrequested-sor-lines")
    expect(hint).toHaveTextContent("1 SOR line is not requested yet.")
    await user.click(within(hint).getByRole("button", { name: "Add" }))
    expect(await screen.findByRole("checkbox", { name: "Rope Access Kit" })).toBeInTheDocument()
  })

  it("shows no hint once every SOR line is requested", async () => {
    await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Full Body Harness")).id)
    await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Rope Access Kit")).id)
    renderWithProviders(<RequestedItems request={request} />)

    await screen.findAllByTestId("requested-item")
    expect(screen.queryByTestId("unrequested-sor-lines")).not.toBeInTheDocument()
  })

  it("reads stock through the request, so a Buyer without SOR access still sees it (#501)", async () => {
    await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Rope Access Kit")).id)
    // The SOR's own snapshot row is hidden from a Buyer; the request hands it over.
    db.internal.rowsOf("sor_stock_snapshots").splice(0)
    stubRpc("purchase_request_stock_snapshot", ({ p_request_id }) =>
      p_request_id === request.id ? { fetched_at: hoursAgo(1), data: STOCK } : null,
    )

    renderWithProviders(<RequestedItems request={request} />)

    const row = await openRow(await screen.findByTestId("requested-item"))
    expect(await within(row).findByText("Available")).toBeInTheDocument()
    expect(within(row).getByText(/^Stock as of /)).toBeInTheDocument()
  })

  it("marks stock read more than a day ago Stale (#501)", async () => {
    await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Full Body Harness")).id)
    stubRpc("purchase_request_stock_snapshot", () => ({ fetched_at: hoursAgo(72), data: STOCK }))

    renderWithProviders(<RequestedItems request={request} />)

    const row = await openRow(await screen.findByTestId("requested-item"))
    expect(await within(row).findByText("Partial · 4 of 10")).toBeInTheDocument()
    expect(within(row).getByText(/^Stock as of /)).toBeInTheDocument()
    expect(within(row).getByText("Stale")).toBeInTheDocument()
  })

  it("adds an item picked from the SOR's Product List", async () => {
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    await user.click(await screen.findByRole("button", { name: "Add from the SOR" }))
    await user.click(await screen.findByRole("checkbox", { name: "Rope Access Kit" }))
    await user.click(screen.getByRole("button", { name: "Request item" }))

    await waitFor(() => expect(rows()).toHaveLength(1))
    const row = await openRow(rows()[0])
    expect(within(row).getByText("Rope Access Kit")).toBeInTheDocument()
    expect(within(row).getByText("2 set")).toBeInTheDocument()
    expect(within(row).getByText("Available")).toBeInTheDocument()
    expect(within(row).queryByText(/SOR line/)).not.toBeInTheDocument()
  })

  it("picks every line with Select all, and adds them together", async () => {
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    await user.click(await screen.findByRole("button", { name: "Add from the SOR" }))
    await user.click(await screen.findByRole("checkbox", { name: "Select all" }))
    expect(screen.getByRole("checkbox", { name: "Full Body Harness" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Rope Access Kit" })).toBeChecked()
    await user.click(screen.getByRole("button", { name: "Request 2 items" }))

    await waitFor(() => expect(rows()).toHaveLength(2))
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
    const row = await openRow(rows()[0])
    expect(within(row).getByText("Custom mounting bracket")).toBeInTheDocument()
    expect(within(row).getByText("New product", { selector: "dd" })).toBeInTheDocument()
    expect(within(row).getByText("Stainless, per the client's drawing")).toBeInTheDocument()
    expect(within(row).queryByText(/Stock as of/)).not.toBeInTheDocument()
    expect(within(row).queryByText(/Not checked|Not linked to Odoo|Available|Out of stock/)).not.toBeInTheDocument()

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
  describe("the price copied from a Canvass winner (#582)", () => {
    it("shows the price on the row when the database returns it", async () => {
      const item = await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Rope Access Kit")).id)
      db.seed("purchase_request_item_prices", { item_id: item.id ?? db.internal.rowsOf("purchase_request_items")[0].id, unit_price: 1250.5, currency: "PHP" })

      renderWithProviders(<RequestedItems request={request} />)

      const row = await openRow(await screen.findByTestId("requested-item"))
      expect(await within(row).findByTestId("requested-item-price")).toHaveTextContent("PHP 1,250.50 each")
    })

    it("shows no price when the database returns none, as for a member who may not see prices", async () => {
      await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Rope Access Kit")).id)

      renderWithProviders(<RequestedItems request={request} />)

      const row = await openRow(await screen.findByTestId("requested-item"))
      expect(within(row).getByText("Rope Access Kit")).toBeInTheDocument()
      expect(within(row).queryByTestId("requested-item-price")).not.toBeInTheDocument()
    })
  })
})
