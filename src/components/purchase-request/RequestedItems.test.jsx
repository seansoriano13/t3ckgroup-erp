/**
 * Requested Items (#305, #678) on screen, against the fake database with the item RPCs and the
 * S0-line triggers re-implemented on its store. Asserts what a salesperson and a purchaser read
 * and do: the two sections, each product's name, amount and status, stock, "Removed from S0",
 * through accessible names, not structure.
 */
import { openRow, showDoneLines } from "@/test/openRequestedItem"
import { useEffect } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router"
import { stubCanvassMoneyRpc } from "@/test/stubs/canvassRpc"
import { SampleAuthProvider } from "@/context/AuthContext"
import { renderWithProviders, setupUser, chooseOption } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubEdgeFunction, stubRpc } from "@/test/msw/server"
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
    // The Available line folds into one "done" row until shown.
    expect(within(s0).getAllByTestId("requested-item")).toHaveLength(1)
    expect(within(s0).getByText("1 done")).toBeInTheDocument()
    await showDoneLines()
    const s0Rows = within(s0).getAllByTestId("requested-item")
    expect(s0Rows).toHaveLength(2)
    expect(within(s0Rows[0]).getByText("Full Body Harness")).toBeInTheDocument()
    expect(within(s0Rows[0]).getByText("×10 pc")).toBeInTheDocument()
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
    expect(within(row).getByText("×12 pc")).toBeInTheDocument()
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
    for (const name of ["Add from the SOR", "Pick from SOR", "Update to SOR", "Update to the SOR", "Keep as asked", "Add from the S0 Evaluation"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByTestId("unrequested-sor-lines")).not.toBeInTheDocument()
    expect(within(row).queryByText("SOR changed")).not.toBeInTheDocument()
  })

  it("shows an item's stock with its read time", async () => {
    renderWithProviders(<RequestedItems request={request} />)

    const row = await openRow((await screen.findAllByTestId("requested-item"))[0])
    expect(within(row).getAllByText("4 free of 10").length).toBeGreaterThan(0)
    expect(within(row).getByText(/^read /)).toBeInTheDocument()
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
    expect((await within(row).findAllByText("5 free, enough")).length).toBeGreaterThan(0)
    expect(within(row).getByText(/^read /)).toBeInTheDocument()
  })

  it("marks stock read more than a day ago Stale (#501)", async () => {
    stubRpc("purchase_request_stock_snapshot", () => ({ fetched_at: hoursAgo(72), data: STOCK }))

    renderWithProviders(<RequestedItems request={request} />)

    const row = await openRow((await screen.findAllByTestId("requested-item"))[0])
    expect((await within(row).findAllByText("4 free of 10")).length).toBeGreaterThan(0)
    expect(within(row).getByText("Stale")).toBeInTheDocument()
  })

  it("adds a new product as an Other request, with its description and images", async () => {
    globalThis.URL.createObjectURL = vi.fn(() => "blob:preview")
    globalThis.URL.revokeObjectURL = vi.fn()
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    await user.click(await screen.findByRole("button", { name: "Ask for a product" }))
    await user.type(screen.getByLabelText("What do you need?"), "Custom mounting bracket")
    await user.clear(screen.getByLabelText(/^Quantity/))
    await user.type(screen.getByLabelText(/^Quantity/), "4")
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
    expect(within(row).queryByText(/^read /)).not.toBeInTheDocument()
    expect(rows()).toHaveLength(3)

    const item = db.rows("purchase_request_items").find((i) => i.name === "Custom mounting bracket")
    expect(item).toMatchObject({ purpose: "job", status: "not_checked" })
    expect(item.images).toEqual([expect.objectContaining({ name: "bracket.png", url: expect.stringMatching(/^https:\/\//) })])
  })

  it("adds several products in one go, one picked from Odoo and one typed, each with its own Chat line", async () => {
    stubEdgeFunction("odoo-product-search", () => ({
      success: true,
      products: [{ id: 555, name: "Full Body Harness XL", code: "FBH-XL" }],
    }))
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    await user.click(await screen.findByRole("button", { name: "Ask for a product" }))
    // The dialog moves focus into itself as it opens; let that settle before typing.
    await new Promise((resolve) => setTimeout(resolve, 100))
    await user.type(screen.getByRole("combobox", { name: "What do you need?" }), "harness")
    await user.click(await screen.findByRole("button", { name: /Full Body Harness XL/ }))
    expect(screen.getByText("From Odoo")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Add another product" }))
    const second = screen.getByRole("group", { name: "Product 2" })
    await user.type(within(second).getByRole("combobox", { name: "What do you need?" }), "Green tarpaulin")
    await user.clear(within(second).getByLabelText(/^Quantity/))
    await user.type(within(second).getByLabelText(/^Quantity/), "3")
    await user.click(screen.getByRole("button", { name: "Send 2 requests" }))

    const other = screen.getByRole("region", { name: "Other requests" })
    await waitFor(() => expect(within(other).getAllByTestId("requested-item")).toHaveLength(2))
    const picked = db.rows("purchase_request_items").find((i) => i.name === "Full Body Harness XL")
    const typed = db.rows("purchase_request_items").find((i) => i.name === "Green tarpaulin")
    expect(picked).toMatchObject({ odoo_product_id: 555, quantity: 1, status: "not_checked" })
    expect(typed).toMatchObject({ odoo_product_id: null, quantity: 3, status: "not_checked" })
    const added = db.rows("purchase_request_messages").filter((m) => m.metadata?.event === "item_added")
    expect(added.map((m) => m.metadata.item_id)).toEqual(expect.arrayContaining([picked.id, typed.id]))
  })

  it("drops a product row with Remove, and keeps Send off while a row is empty", async () => {
    const user = setupUser()
    renderWithProviders(<RequestedItems request={request} />)

    await user.click(await screen.findByRole("button", { name: "Ask for a product" }))
    await user.type(screen.getByRole("combobox", { name: "What do you need?" }), "Cable ties")
    await user.click(screen.getByRole("button", { name: "Add another product" }))
    expect(screen.getByRole("button", { name: "Send 2 requests" })).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Remove Product 2" }))
    expect(screen.queryByRole("group", { name: "Product 2" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send request" })).toBeEnabled()
  })

  it("offers no way to add to someone who may not", async () => {
    stubRpc("purchase_request_can_add_items", () => false)
    renderWithProviders(<RequestedItems request={request} />)

    await screen.findAllByTestId("requested-item")
    expect(screen.queryByRole("button", { name: "Ask for a product" })).not.toBeInTheDocument()
  })

  describe("editing and removing an added product", () => {
    const PHOTO = { url: "https://res.cloudinary.com/demo/image/upload/v1/bracket.jpg", name: "bracket.jpg", type: "image/jpeg", bytes: 2048 }
    const seedAdded = (fields = {}) =>
      db.seed("purchase_request_items", {
        request_id: request.id,
        source: "new",
        name: "Custom mounting bracket",
        quantity: 4,
        unit: "pc",
        images: [PHOTO],
        status: "not_checked",
        requested_by: salesperson.id,
        ...fields,
      })
    const otherRow = async () => {
      const other = await screen.findByRole("region", { name: "Other requests" })
      return openRow(await within(other).findByTestId("requested-item"))
    }

    it("edits it in the form it was asked with, keeping its photo, and posts the change", async () => {
      const added = seedAdded()
      const user = setupUser()
      renderWithProviders(<RequestedItems request={request} />)

      await user.click(within(await otherRow()).getByRole("button", { name: "Edit" }))
      const dialog = await screen.findByRole("dialog")
      expect(within(dialog).getByRole("combobox", { name: "What do you need?" })).toHaveValue("Custom mounting bracket")
      expect(within(dialog).getByAltText("bracket.jpg")).toBeInTheDocument()
      await user.clear(within(dialog).getByLabelText(/^Quantity/))
      await user.type(within(dialog).getByLabelText(/^Quantity/), "6")
      await user.click(within(dialog).getByRole("button", { name: "Save" }))

      await waitFor(() => expect(itemRow("Custom mounting bracket").quantity).toBe(6))
      expect(itemRow("Custom mounting bracket")).toMatchObject({ unit: "pc", images: [PHOTO] })
      const posts = db.rows("purchase_request_messages").filter((m) => m.metadata?.event === "item_edited")
      expect(posts.map((m) => m.metadata.item_id)).toEqual([added.id])
    })

    it("removes it after asking: it leaves the list, stays on record, and the Chat says so", async () => {
      const added = seedAdded()
      const user = setupUser()
      renderWithProviders(<RequestedItems request={request} />)

      await user.click(within(await otherRow()).getByRole("button", { name: "Remove" }))
      const confirm = await screen.findByRole("dialog", { name: "Remove Custom mounting bracket?" })
      await user.click(within(confirm).getByRole("button", { name: "Remove" }))

      expect(await screen.findByText("No other requests.")).toBeInTheDocument()
      const kept = db.rows("purchase_request_items").find((i) => i.id === added.id)
      expect(kept).toMatchObject({ status: "cancelled" })
      expect(kept.removed_at).toBeTruthy()
      const posts = db.rows("purchase_request_messages").filter((m) => m.metadata?.event === "item_removed")
      expect(posts.map((m) => m.metadata.item_id)).toEqual([added.id])
    })

    it("turns both off, with the reason on hover, once the product is bought", async () => {
      seedAdded({ status: "purchased" })
      renderWithProviders(<RequestedItems request={request} />)

      const row = await otherRow()
      for (const name of ["Edit", "Remove"]) {
        const button = within(row).getByRole("button", { name })
        expect(button).toBeDisabled()
        expect(button).toHaveAttribute("title", "It is on a P0 already. Cancel it instead.")
      }
    })

    it("offers neither on a product from the S0, nor to someone who may not add", async () => {
      seedAdded()
      stubRpc("purchase_request_can_add_items", () => false)
      renderWithProviders(<RequestedItems request={request} />)

      const row = await otherRow()
      expect(within(row).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument()
      const s0 = screen.getByRole("region", { name: "From the S0" })
      const s0Row = await openRow(within(s0).getAllByTestId("requested-item")[0])
      expect(within(s0Row).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument()
    })
  })

  describe("the price copied from a Canvass winner (#582)", () => {
    it("shows the price on the row when the database returns it", async () => {
      const kit = itemRow("Rope Access Kit")
      db.seed("purchase_request_item_prices", { item_id: kit.id, unit_price: 1250.5, currency: "PHP" })

      renderWithProviders(<RequestedItems request={request} />)

      const row = await openRow((await screen.findAllByTestId("requested-item"))[1])
      expect(await within(row).findByTestId("requested-item-price")).toHaveTextContent("PHP 1,250.50")
    })

    it("shows no price when the database returns none, as for a member who may not see prices", async () => {
      renderWithProviders(<RequestedItems request={request} />)

      const row = await openRow((await screen.findAllByTestId("requested-item"))[1])
      expect(within(row).getByText("Rope Access Kit")).toBeInTheDocument()
      expect(within(row).queryByTestId("requested-item-price")).not.toBeInTheDocument()
    })
  })

  describe("the ready bar and folding (#680)", () => {
    const seed = (name, status, extra = {}) =>
      db.seed("purchase_request_items", {
        request_id: request.id, source: "new", name, quantity: 1, unit: "pc", status, requested_by: salesperson.id, ...extra,
      })

    it("says N of M ready and the plain sentence, leaving Cancelled lines out", async () => {
      itemRow("Rope Access Kit").status = "received"
      seed("Bracket", "to_purchase")
      seed("Anchor", "purchased", { po_number: "P01234" })
      seed("Old sling", "cancelled")
      renderWithProviders(<RequestedItems request={request} />)

      const bar = await screen.findByTestId("ready-bar")
      expect(within(bar).getByText("1 of 4 ready")).toBeInTheDocument()
      expect(within(bar).getByTestId("ready-sentence")).toHaveTextContent(
        "1 is in the warehouse. 2 need buying: 1 still needs a supplier, 1 is on P01234 and not here yet. 1 has not been checked yet.",
      )
    })

    it("fills the bar by ready lines only, so lines waiting to be bought read as an empty bar (#902)", async () => {
      seed("Bracket", "to_purchase")
      seed("Anchor", "to_purchase")
      renderWithProviders(<RequestedItems request={request} />)

      const meter = await screen.findByRole("meter", { name: "0 of 4 ready" })
      expect(meter).toHaveAttribute("aria-valuenow", "0")
      expect(within(screen.getByTestId("ready-bar")).getByText("0 of 4 ready")).toBeInTheDocument()
    })

    it("names the cannot-source count and counts several purchased lines", async () => {
      seed("A", "purchased"); seed("B", "purchased"); seed("C", "cannot_source")
      renderWithProviders(<RequestedItems request={request} />)

      const bar = await screen.findByTestId("ready-bar")
      expect(within(bar).getByTestId("ready-sentence")).toHaveTextContent(
        "0 are in the warehouse. 2 need buying: 2 are on a P0 and not here yet. 2 have not been checked yet. 1 cannot be sourced.",
      )
    })

    it("folds finished lines into 'N done' and shows them on request", async () => {
      itemRow("Rope Access Kit").status = "available"
      seed("Old sling", "cancelled")
      const user = setupUser()
      renderWithProviders(<RequestedItems request={request} />)

      const s0 = await screen.findByRole("region", { name: "From the S0" })
      expect(within(s0).getAllByTestId("requested-item")).toHaveLength(1)
      expect(within(s0).getByText("1 done")).toBeInTheDocument()
      const other = screen.getByRole("region", { name: "Other requests" })
      expect(within(other).queryAllByTestId("requested-item")).toHaveLength(0)
      expect(within(other).getByText("1 done")).toBeInTheDocument()
      await user.click(within(s0).getByRole("button", { name: "show" }))
      expect(within(s0).getAllByTestId("requested-item")).toHaveLength(2)
    })

    it("does not hold a finished line open for Removed from S0 alone", async () => {
      itemRow("Full Body Harness").status = "received"
      itemRow("Full Body Harness").removed_from_s0 = true
      renderWithProviders(<RequestedItems request={request} />)

      const s0 = await screen.findByRole("region", { name: "From the S0" })
      const shown = within(s0).getAllByTestId("requested-item")
      expect(shown).toHaveLength(1)
      expect(within(shown[0]).getByText("Rope Access Kit")).toBeInTheDocument()
      expect(within(s0).getByText("1 done")).toBeInTheDocument()
    })

    it("folds a section shut, and a count button opens it again", async () => {
      const user = setupUser()
      renderWithProviders(<RequestedItems request={request} />)

      const header = await screen.findByRole("button", { name: /From the S0/ , expanded: true })
      await user.click(header)
      expect(screen.getByRole("button", { name: /From the S0/, expanded: false })).toBeInTheDocument()
      await user.click(within(screen.getByRole("group", { name: "Jump to a section" })).getByRole("button", { name: "From the S0 · 2" }))
      expect(screen.getByRole("button", { name: /^From the S0/, expanded: true })).toBeInTheDocument()
    })
  })
})

// #972: the S0 Evaluation Canvass button links here with ?canvass=1&line=<item>.
describe("RequestedItems opened from a Canvass link", () => {
  it("opens the request Canvass at the line, then takes the link off the address", async () => {
    const line = itemRow("Rope Access Kit")
    stubCanvassMoneyRpc({ money: true })
    const seen = { search: "" }
    function Probe() {
      const { search } = useLocation()
      useEffect(() => {
        seen.search = search
      })
      return null
    }
    renderWithProviders(
      <MemoryRouter initialEntries={[`/purchasing?request=${request.id}&canvass=1&line=${line.id}`]}>
        <SampleAuthProvider user={{ id: salesperson.id, name: salesperson.name }}>
          <RequestedItems request={request} />
          <Probe />
        </SampleAuthProvider>
      </MemoryRouter>,
    )

    await screen.findByRole("grid", { name: "Canvass" })
    const focused = screen.getAllByTestId("canvass-line").filter((l) => l.dataset.focused === "true")
    expect(focused).toHaveLength(1)
    expect(within(focused[0]).getByRole("rowheader")).toHaveAccessibleName("Rope Access Kit")
    await waitFor(() => expect(seen.search).toBe(`?request=${request.id}`))
  })

  it("stays shut with no Canvass link", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={[`/purchasing?request=${request.id}`]}>
        <RequestedItems request={request} />
      </MemoryRouter>,
    )
    await screen.findByRole("region", { name: "From the S0" })
    expect(screen.queryByRole("grid", { name: "Canvass" })).not.toBeInTheDocument()
  })
})
