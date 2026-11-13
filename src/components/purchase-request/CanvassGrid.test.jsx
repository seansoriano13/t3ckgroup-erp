/**
 * The request's Canvass grid (#970, spec #956) on screen, against the fake database with the Canvass
 * RPCs of #967 and #969 re-implemented on its store. Asserts what a purchaser reads and does:
 * adding a supplier once, quoting lines, picking winners with a reason, the three-supplier gate, a
 * locked line, and the grid a reader without money sees. The rules themselves are the database's
 * (policy tier 90 and 969); here only what the screen offers and hands over.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { renderWithProviders, setupUser, chooseOption } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubEdgeFunction } from "@/test/msw/server"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { stubCanvassMoneyRpc } from "@/test/stubs/canvassRpc"
import { SampleAuthProvider } from "@/context/AuthContext"
import { canvassService } from "@/services/canvassService"
import CanvassGrid from "./CanvassGrid"

vi.mock("browser-image-compression", () => ({ default: async (file) => file }))

let purchaser
let request
let lineA
let lineB

const line = (name, over = {}) =>
  db.seed("purchase_request_items", { request_id: request.id, name, quantity: 2, unit: "pc", source: "new", requested_by: purchaser.id, status: "to_purchase", ...over })

/** Renders the grid as `user`, a Purchasing member by default. */
function show({ side = "purchasing", user = purchaser, money = true, focusItemId = null, projection = null } = {}) {
  stubCanvassMoneyRpc({ money, projection })
  stubPurchaseRequestItemRpcs({ actorId: user.id, side })
  return renderWithProviders(
    <SampleAuthProvider user={{ id: user.id, name: user.name, is_super_admin: Boolean(user.is_super_admin) }}>
      <CanvassGrid request={request} focusItemId={focusItemId} />
    </SampleAuthProvider>,
  )
}

// The fake hands back copies, so a change to a line goes on the stored row itself (no foreign-key check: a Component id need not exist).
const patchLine = (item, patch) => Object.assign(db.internal.rowsOf("purchase_request_items").find((i) => i.id === item.id), patch)

const addSupplier = (name, extra = {}) => canvassService.addSupplier(request.id, { supplierName: name, ...extra }, purchaser.id)
const quote = (supplier, item, input) => canvassService.saveQuote(supplier.supplier.id, item.id, input)

/** Three PHP suppliers, each quoting both lines: the Canvass is covered. */
async function threeSuppliers() {
  const redleaf = await addSupplier("Redleaf Inc.")
  const ferno = await addSupplier("Ferno")
  const stryker = await addSupplier("Stryker")
  for (const [supplier, price] of [[redleaf, 1000], [ferno, 900], [stryker, 1100]]) {
    await quote(supplier, lineA, { unitPrice: price, brand: supplier.supplier.supplier_name })
    await quote(supplier, lineB, { unitPrice: price * 2 })
  }
  return { redleaf, ferno, stryker }
}

const cell = (item, supplier) => screen.getByTestId(`cell-${item.id}-${supplier.supplier.id}`)
const priceBox = (supplier, item) => screen.getByRole("spinbutton", { name: `Unit price, ${supplier}, ${item}` })

beforeEach(() => {
  purchaser = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true })
  const deal = makeOpportunity({ registered_by: purchaser.id })
  request = db.seed("purchase_requests", { opportunity_id: deal.id, created_by: purchaser.id, title: "S07983 supplies" })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: purchaser.id, side: "purchasing" })
  lineA = line("Folding stretcher")
  lineB = line("Spine board")
  stubEdgeFunction("odoo-supplier-search", { success: true, suppliers: [] })
  // Seeding goes through the service, so the RPCs have to be there before the first test line.
  stubCanvassMoneyRpc({ money: true })
  stubPurchaseRequestItemRpcs({ actorId: purchaser.id, side: "purchasing" })
})

describe("the grid", () => {
  it("lists the request's lines down, with quantity and unit, and says no supplier is there yet", async () => {
    show()
    const grid = await screen.findByRole("grid", { name: "Canvass" })
    expect(within(grid).getByRole("rowheader", { name: "Folding stretcher" })).toHaveTextContent("2 pc")
    expect(within(grid).getByRole("rowheader", { name: "Spine board" })).toBeInTheDocument()
    expect(screen.getByText(/No supplier yet/)).toBeInTheDocument()
    expect(screen.getByTestId("strip-suppliers")).toHaveTextContent("0 of 3 suppliers")
    // Opening the grid writes nothing.
    expect(db.rows("request_canvasses")).toHaveLength(0)
  })

  it("puts the suppliers across, each with its currency, hold, lead time and note, and keeps the line column frozen", async () => {
    await addSupplier("Redleaf Inc.", { leadTime: "14 days", qualityNote: "OEM", validUntil: "2099-01-31" })
    await addSupplier("Hong Kong", { currency: "USD", comparisonRate: 56.5 })
    show()
    const redleaf = await screen.findByTestId(`supplier-${db.rows("request_canvass_suppliers")[0].id}`)
    expect(redleaf).toHaveTextContent("Redleaf Inc.")
    expect(redleaf).toHaveTextContent("Holds until 2099-01-31")
    expect(redleaf).toHaveTextContent("Lead time 14 days")
    expect(redleaf).toHaveTextContent("OEM")
    const hk = screen.getByTestId(`supplier-${db.rows("request_canvass_suppliers")[1].id}`)
    expect(hk).toHaveTextContent("USD")
    expect(hk).toHaveTextContent("Rate 56.5")
    // The line column sticks while the suppliers scroll sideways.
    expect(screen.getByRole("rowheader", { name: "Spine board" }).className).toMatch(/sticky/)
    expect(screen.getByTestId("canvass-scroller").className).toMatch(/overflow-auto/)
  })

  it("has no table anywhere inside it", async () => {
    await threeSuppliers()
    const { container } = show()
    await screen.findByRole("grid", { name: "Canvass" })
    await userDetails("Redleaf Inc.", "Folding stretcher")
    expect(container.querySelector("table")).toBeNull()
    expect(within(screen.getByTestId("cell-liner")).queryByRole("table")).toBeNull()
  })

  it("rings the line it was opened at", async () => {
    show({ focusItemId: lineB.id })
    await screen.findByRole("grid", { name: "Canvass" })
    const lines = screen.getAllByTestId("canvass-line")
    expect(lines.map((l) => l.dataset.focused)).toEqual([undefined, "true"])
  })
})

async function userDetails(supplier, item) {
  const user = setupUser()
  await user.click(await screen.findByRole("button", { name: `Details, ${supplier}, ${item}` }))
  return user
}

describe("adding a supplier", () => {
  it("asks once for the supplier, currency, rate, hold, lead time and quality note, with a red asterisk on what is required", async () => {
    const user = setupUser()
    show()
    await user.click(await screen.findByRole("button", { name: "Add a supplier" }))
    const dialog = await screen.findByRole("dialog", { name: "Add a supplier" })

    // Supplier and currency are required; a foreign currency makes the rate required too.
    expect(within(dialog).getAllByText("*")).toHaveLength(2)
    await chooseOption(user, within(dialog).getByRole("combobox", { name: "Currency" }), "USD")
    expect(within(dialog).getAllByText("*")).toHaveLength(3)
    for (const label of ["Supplier", "Currency", "Comparison rate", "Quote holds until", "Lead time", "Quality note"]) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument()
    }
    // Nothing to save without a name.
    expect(within(dialog).getByRole("button", { name: "Add supplier" })).toBeDisabled()
  })

  it("starts the Canvass with the first supplier, saving its currency, rate, hold, lead time and note", async () => {
    const user = setupUser()
    show()
    await user.click(await screen.findByRole("button", { name: "Add a supplier" }))
    const dialog = await screen.findByRole("dialog", { name: "Add a supplier" })
    await user.type(within(dialog).getByRole("combobox", { name: "Supplier" }), "Hong Kong Trading")
    await chooseOption(user, within(dialog).getByRole("combobox", { name: "Currency" }), "USD")
    // A foreign supplier can't be added without the rate it is compared at.
    expect(within(dialog).getByRole("button", { name: "Add supplier" })).toBeDisabled()
    await user.type(within(dialog).getByLabelText("Comparison rate"), "56.5")
    await user.type(within(dialog).getByLabelText("Quote holds until"), "2099-01-31")
    await user.type(within(dialog).getByLabelText("Lead time"), "45 days")
    await user.type(within(dialog).getByLabelText("Quality note"), "Grade A")
    await user.click(within(dialog).getByRole("button", { name: "Add supplier" }))

    await waitFor(() => expect(screen.getByTestId("strip-suppliers")).toHaveTextContent("1 of 3 suppliers"))
    expect(screen.getByText("CNV_0001")).toBeInTheDocument()
    expect(db.rows("request_canvass_suppliers")[0]).toMatchObject({
      supplier_name: "Hong Kong Trading",
      currency: "USD",
      lead_time: "45 days",
      quality_note: "Grade A",
    })
    expect(db.rows("request_canvass_supplier_prices")[0].comparison_rate).toBe(56.5)
    expect(screen.queryByRole("dialog", { name: "Add a supplier" })).toBeNull()
  })
})

describe("a cancelled line", () => {
  it("stays in the grid, marked Cancelled, with nothing to edit or pick", async () => {
    const { redleaf } = await threeSuppliers()
    await quote(redleaf, lineA, { unitPrice: 1000 })
    patchLine(lineA, { status: "cancelled" })
    show()
    const grid = await screen.findByRole("grid", { name: "Canvass" })
    expect(within(grid).getByRole("rowheader", { name: "Folding stretcher" })).toHaveTextContent("Cancelled")
    // Its price is still readable but cannot be typed over, and there is no pick on it.
    expect(screen.queryByRole("spinbutton", { name: /Folding stretcher/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Pick .*Folding stretcher/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Un-pick .*Folding stretcher/ })).toBeNull()
    expect(screen.getAllByRole("button", { name: /^Pick .*Spine board/ })).toHaveLength(3)
    // Only the open line counts toward the winners.
    expect(screen.getByTestId("strip-lines")).toHaveTextContent("0 of 1 line has a winner")
  })
})

describe("quoting lines", () => {
  it("takes a price in the cell, works the total out, and leaves a place nobody quoted empty", async () => {
    await addSupplier("Redleaf Inc.")
    const user = setupUser()
    show()
    const box = await screen.findByRole("spinbutton", { name: "Unit price, Redleaf Inc., Folding stretcher" })
    await user.type(box, "78000")
    await user.tab()

    await waitFor(() => expect(screen.getByLabelText("Total, Redleaf Inc., Folding stretcher")).toHaveTextContent("Total ₱156,000.00"))
    expect(db.rows("request_canvass_quotes")).toHaveLength(1)
    expect(db.rows("request_canvass_quote_prices")[0].unit_price).toBe(78000)
    // The other line stays unquoted: no quote row, no total.
    expect(priceBox("Redleaf Inc.", "Spine board")).toHaveValue(null)
    expect(screen.queryByLabelText("Total, Redleaf Inc., Spine board")).toBeNull()
  })

  it("shows a foreign quote in its own currency and compares it in PHP for the cheapest mark", async () => {
    const redleaf = await addSupplier("Redleaf Inc.")
    const hk = await addSupplier("Hong Kong", { currency: "USD", comparisonRate: 50 })
    await quote(redleaf, lineA, { unitPrice: 5000 })
    await quote(hk, lineA, { unitPrice: 90 })
    show()
    await screen.findByLabelText("Total, Hong Kong, Folding stretcher")
    expect(screen.getByLabelText("Total, Hong Kong, Folding stretcher")).toHaveTextContent("Total USD 180.00")
    // 90 USD x 50 = 4,500 PHP, under Redleaf's 5,000.
    expect(within(cell(lineA, hk)).getByText("Cheapest")).toBeInTheDocument()
    expect(within(cell(lineA, redleaf)).queryByText("Cheapest")).toBeNull()
  })

  it("opens a cell's details as a one-line liner under the row and saves a brand, link and remarks from it", async () => {
    const redleaf = await addSupplier("Redleaf Inc.")
    await quote(redleaf, lineA, { unitPrice: 100 })
    show()
    const user = await userDetails("Redleaf Inc.", "Folding stretcher")
    const liner = await screen.findByTestId("cell-liner")
    expect(liner).toHaveAccessibleName("Quote details, Redleaf Inc., Folding stretcher")

    await user.type(within(liner).getByRole("textbox", { name: "Brand, Redleaf Inc., Folding stretcher" }), "Ferno")
    await user.tab()
    await user.type(within(liner).getByRole("textbox", { name: "Source link, Redleaf Inc., Folding stretcher" }), "https://example.test/p")
    await user.tab()
    await user.type(within(liner).getByRole("textbox", { name: "Remarks, Redleaf Inc., Folding stretcher" }), "Includes straps")
    await user.tab()

    await waitFor(() =>
      expect(db.rows("request_canvass_quotes")[0]).toMatchObject({ brand: "Ferno", source_link: "https://example.test/p", remarks: "Includes straps" }),
    )
    expect(within(liner).getByRole("link", { name: /Open the source link/ })).toHaveAttribute("href", "https://example.test/p")
    // The liner sits under its line's row, not in the cell.
    expect(cell(lineA, redleaf).contains(liner)).toBe(false)
  })

  it("takes a supplier's quote off a line with No quote", async () => {
    const redleaf = await addSupplier("Redleaf Inc.")
    await quote(redleaf, lineA, { unitPrice: 100 })
    show()
    const user = await userDetails("Redleaf Inc.", "Folding stretcher")
    await user.click(await screen.findByRole("button", { name: "No quote" }))
    await waitFor(() => expect(db.rows("request_canvass_quotes")).toHaveLength(0))
  })

  it("shows a refusal under the cell and keeps what was typed", async () => {
    await addSupplier("Redleaf Inc.")
    const user = setupUser()
    show()
    const box = await screen.findByRole("spinbutton", { name: "Unit price, Redleaf Inc., Folding stretcher" })
    await user.type(box, "-5")
    await user.tab()
    expect(await screen.findByRole("alert")).toHaveTextContent("Unit price must be zero or more.")
    expect(box).toHaveValue(-5)
  })
})

describe("picking winners", () => {
  it("asks for the reason at pick time, will not confirm a blank one, and keeps the winner and reason per line", async () => {
    const { ferno } = await threeSuppliers()
    const user = setupUser()
    show()
    await user.click(await screen.findByRole("button", { name: "Pick Ferno, Folding stretcher" }))

    const dialog = await screen.findByRole("dialog", { name: "Ferno wins Folding stretcher?" })
    // The reason is required: red asterisk, and Confirm stays off until there is one.
    expect(within(dialog).getByText("*")).toBeInTheDocument()
    const confirm = within(dialog).getByRole("button", { name: "Pick winner" })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByRole("textbox", { name: "Why this supplier" }), "   ")
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByRole("textbox", { name: "Why this supplier" }), "Cheapest, holds stock.")
    await user.click(confirm)

    await waitFor(() => expect(db.rows("request_canvass_winners")).toHaveLength(1))
    expect(db.rows("request_canvass_winners")[0]).toMatchObject({ item_id: lineA.id, supplier_id: ferno.supplier.id, reason: "Cheapest, holds stock." })
    // The line shows its winner and reason, and the strip counts it.
    const liner = await screen.findByTestId("winner-liner")
    expect(liner).toHaveTextContent("Ferno")
    expect(within(liner).getByRole("textbox", { name: "Reason, Folding stretcher" })).toHaveValue("Cheapest, holds stock.")
    expect(within(cell(lineA, ferno)).getByText("Winner")).toBeInTheDocument()
    expect(screen.getByTestId("strip-lines")).toHaveTextContent("1 of 2 lines have a winner")
    expect(screen.getByText("Winner picked")).toBeInTheDocument()
  })

  it("rewrites a winner's reason from the liner, and refuses to blank it", async () => {
    const { ferno } = await threeSuppliers()
    await canvassService.setWinner(lineA.id, ferno.supplier.id, "Old reason", purchaser.id)
    const user = setupUser()
    show()
    const box = await screen.findByRole("textbox", { name: "Reason, Folding stretcher" })
    await user.clear(box)
    await user.type(box, "New reason")
    await user.tab()
    await waitFor(() => expect(db.rows("request_canvass_winners")[0].reason).toBe("New reason"))

    await user.clear(box)
    await user.tab()
    expect(await screen.findByRole("alert")).toHaveTextContent("A winner needs a reason.")
    expect(db.rows("request_canvass_winners")[0].reason).toBe("New reason")
  })

  it("un-picks a line's winner", async () => {
    const { ferno } = await threeSuppliers()
    await canvassService.setWinner(lineA.id, ferno.supplier.id, "Cheapest", purchaser.id)
    const user = setupUser()
    show()
    await user.click(await screen.findByRole("button", { name: "Un-pick Ferno on Folding stretcher" }))
    await waitFor(() => expect(db.rows("request_canvass_winners")).toHaveLength(0))
    expect(screen.queryByTestId("winner-liner")).toBeNull()
  })

  it("picks a replacement winner, with the old reason to start from", async () => {
    const { ferno, redleaf } = await threeSuppliers()
    await canvassService.setWinner(lineA.id, ferno.supplier.id, "Cheapest", purchaser.id)
    const user = setupUser()
    show()
    await user.click(await screen.findByRole("button", { name: "Pick Redleaf Inc., Folding stretcher" }))
    const dialog = await screen.findByRole("dialog", { name: "Redleaf Inc. wins Folding stretcher?" })
    expect(within(dialog).getByRole("textbox", { name: "Why this supplier" })).toHaveValue("Cheapest")
    await user.clear(within(dialog).getByRole("textbox", { name: "Why this supplier" }))
    await user.type(within(dialog).getByRole("textbox", { name: "Why this supplier" }), "Better warranty")
    await user.click(within(dialog).getByRole("button", { name: "Pick winner" }))
    await waitFor(() => expect(db.rows("request_canvass_winners")[0]).toMatchObject({ supplier_id: redleaf.supplier.id, reason: "Better warranty" }))
  })

  it("lets one supplier win every line it quoted with one reason, then the same reason for all", async () => {
    const { redleaf, ferno } = await threeSuppliers()
    const user = setupUser()
    show()
    await user.click(await screen.findByRole("button", { name: "Ferno wins every line" }))
    const dialog = await screen.findByRole("dialog", { name: "Ferno wins every line it quoted?" })
    await user.type(within(dialog).getByRole("textbox", { name: "Why this supplier" }), "Lowest on both")
    await user.click(within(dialog).getByRole("button", { name: "Pick on every line" }))
    await waitFor(() => expect(db.rows("request_canvass_winners")).toHaveLength(2))
    expect(db.rows("request_canvass_winners").every((w) => w.supplier_id === ferno.supplier.id)).toBe(true)
    expect(screen.getByTestId("strip-lines")).toHaveTextContent("2 of 2 lines have a winner")

    // One line goes to Redleaf with its own reason, then the shortcut copies a single reason to both.
    await canvassService.setWinner(lineB.id, redleaf.supplier.id, "Own reason", purchaser.id)
    await user.click(await screen.findByRole("button", { name: "Same reason for all" }))
    const same = await screen.findByRole("dialog", { name: "Use the same reason for all?" })
    await user.type(within(same).getByRole("textbox", { name: "Reason" }), "Buying both together")
    await user.click(within(same).getByRole("button", { name: "Use for all" }))
    await waitFor(() => expect(db.rows("request_canvass_winners").map((w) => w.reason)).toEqual(["Buying both together", "Buying both together"]))
  })

  it("marks the cheapest quote on a line and not the dearer ones", async () => {
    const { redleaf, ferno, stryker } = await threeSuppliers()
    show()
    await screen.findByRole("grid", { name: "Canvass" })
    expect(within(cell(lineA, ferno)).getByText("Cheapest")).toBeInTheDocument()
    expect(within(cell(lineA, redleaf)).queryByText("Cheapest")).toBeNull()
    expect(within(cell(lineA, stryker)).queryByText("Cheapest")).toBeNull()
    expect(within(cell(lineB, ferno)).getByText("Cheapest")).toBeInTheDocument()
  })
})

describe("the three-supplier gate", () => {
  it("keeps Pick off with fewer than three suppliers, and says what is needed", async () => {
    const redleaf = await addSupplier("Redleaf Inc.")
    await addSupplier("Ferno")
    await quote(redleaf, lineA, { unitPrice: 1000 })
    show()
    const pick = await screen.findByRole("button", { name: "Pick Redleaf Inc., Folding stretcher" })
    expect(pick).toBeDisabled()
    expect(pick).toHaveAttribute("title", expect.stringContaining('3 suppliers, or a "No other supplier" note'))
    expect(screen.getByRole("button", { name: "Ferno wins every line" })).toBeDisabled()
    expect(screen.getByTestId("strip-suppliers")).toHaveTextContent("2 of 3 suppliers")
  })

  it("opens the gate with a No other supplier note, which needs a reason, and shows it in the strip", async () => {
    const redleaf = await addSupplier("Redleaf Inc.")
    await addSupplier("Ferno")
    await quote(redleaf, lineA, { unitPrice: 1000 })
    const user = setupUser()
    show()
    await user.click(await screen.findByRole("button", { name: "No other supplier" }))
    const dialog = await screen.findByRole("dialog", { name: "No other supplier?" })
    expect(within(dialog).getByRole("button", { name: "Save note" })).toBeDisabled()
    await user.type(within(dialog).getByRole("textbox", { name: "Why there is no other supplier" }), "Sole distributor")
    await user.click(within(dialog).getByRole("button", { name: "Save note" }))

    await waitFor(() => expect(screen.getByTestId("strip-note")).toHaveTextContent(/No other supplier:s*Sole distributor/))
    expect(screen.getByRole("button", { name: "Pick Redleaf Inc., Folding stretcher" })).toBeEnabled()
    expect(db.rows("request_canvass_no_other_supplier")).toHaveLength(1)
  })

  it("does not let a supplier that did not quote the line be picked", async () => {
    const { redleaf } = await threeSuppliers()
    db.internal.rowsOf("request_canvass_quotes").splice(
      db.internal.rowsOf("request_canvass_quotes").findIndex((q) => q.supplier_id === redleaf.supplier.id && q.item_id === lineB.id),
      1,
    )
    show()
    const pick = await screen.findByRole("button", { name: "Pick Redleaf Inc., Spine board" })
    expect(pick).toBeDisabled()
    expect(pick).toHaveAttribute("title", "This supplier did not quote this line.")
  })
})

describe("a locked line", () => {
  beforeEach(async () => {
    patchLine(lineA, { status: "purchased" })
  })

  it("shows Locked, stops its prices and its pick, and leaves the other line alone", async () => {
    const { ferno } = await threeSuppliers()
    show()
    await screen.findByRole("grid", { name: "Canvass" })
    const row = screen.getAllByTestId("canvass-line")[0]
    expect(within(row).getByText("Locked")).toBeInTheDocument()
    // Read-only: a plain readout, not a box.
    expect(screen.queryByRole("spinbutton", { name: "Unit price, Ferno, Folding stretcher" })).toBeNull()
    expect(screen.getByLabelText("Unit price, Ferno, Folding stretcher")).toHaveTextContent("900")
    expect(screen.getByRole("button", { name: "Pick Ferno, Folding stretcher" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Pick Ferno, Spine board" })).toBeEnabled()
    expect(cell(lineA, ferno)).toBeInTheDocument()
  })

  it("offers Unlock to a Super Admin only, with a required reason", async () => {
    await threeSuppliers()
    const admin = makeEmployee({ name: "Root", is_super_admin: true })
    db.seed("purchase_request_members", { request_id: request.id, employee_id: admin.id, side: "purchasing" })
    const user = setupUser()
    show({ user: admin })
    await user.click(await screen.findByRole("button", { name: "Unlock" }))
    const dialog = await screen.findByRole("dialog", { name: "Unlock Folding stretcher?" })
    expect(within(dialog).getByRole("button", { name: "Unlock" })).toBeDisabled()
    await user.type(within(dialog).getByRole("textbox", { name: "Why it is being unlocked" }), "Wrong price")
    await user.click(within(dialog).getByRole("button", { name: "Unlock" }))

    await waitFor(() => expect(db.rows("request_canvass_line_unlocks")).toHaveLength(1))
    // Open again: its prices are boxes once more.
    expect(await screen.findByRole("spinbutton", { name: "Unit price, Ferno, Folding stretcher" })).toBeInTheDocument()
  })

  it("does not offer Unlock to a purchaser who is not a Super Admin", async () => {
    await threeSuppliers()
    show()
    await screen.findByRole("grid", { name: "Canvass" })
    expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull()
  })
})

describe("who can see and who can change", () => {
  it("draws no edit controls for someone without Purchasing access", async () => {
    await threeSuppliers()
    const salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
    db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
    show({ side: "sales", user: salesperson })
    await screen.findByRole("grid", { name: "Canvass" })
    expect(screen.queryByRole("button", { name: "Add a supplier" })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Pick / })).toBeNull()
    expect(screen.queryByRole("button", { name: /wins every line/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Edit | ^Remove / })).toBeNull()
    expect(screen.queryByRole("spinbutton")).toBeNull()
    // They still read it.
    expect(screen.getByLabelText("Unit price, Ferno, Folding stretcher")).toHaveTextContent("900")
    expect(screen.getByTestId("strip-suppliers")).toHaveTextContent("3 of 3 suppliers")
  })

  it("shows a reader who may not see money the grid with no prices, totals, rates or cheapest mark", async () => {
    await threeSuppliers()
    await addSupplier("Hong Kong", { currency: "USD", comparisonRate: 56.5 })
    show({ money: false })
    await screen.findByRole("grid", { name: "Canvass" })
    expect(screen.getByText("Prices and rates are not shown to you.")).toBeInTheDocument()
    expect(screen.queryByRole("spinbutton")).toBeNull()
    expect(screen.queryByText(/Total /)).toBeNull()
    expect(screen.queryByText("Cheapest")).toBeNull()
    expect(screen.queryByText(/Rate 56/)).toBeNull()
    expect(screen.queryByText(/₱/)).toBeNull()
    // What they may see is still there: who quoted what.
    expect(screen.getAllByText("Quoted").length).toBeGreaterThan(0)
    expect(screen.getByTestId("strip-suppliers")).toHaveTextContent("4 of 3 suppliers")
  })

  it("never asks a purchaser without the money tier for a rate, and saves a foreign supplier without one", async () => {
    const user = setupUser()
    show({ money: false })
    await user.click(await screen.findByRole("button", { name: "Add a supplier" }))
    const dialog = await screen.findByRole("dialog", { name: "Add a supplier" })
    await user.type(within(dialog).getByRole("combobox", { name: "Supplier" }), "Hong Kong Trading")
    await chooseOption(user, within(dialog).getByRole("combobox", { name: "Currency" }), "USD")
    expect(within(dialog).queryByLabelText("Comparison rate")).toBeNull()
    await user.click(within(dialog).getByRole("button", { name: "Add supplier" }))
    await waitFor(() => expect(db.rows("request_canvass_suppliers")[0]).toMatchObject({ supplier_name: "Hong Kong Trading", currency: "USD" }))
    // The price row is there, with no rate, for someone who can see money to fill later.
    expect(db.rows("request_canvass_supplier_prices")[0].comparison_rate).toBeNull()
  })

  it("shows a reader with money a foreign supplier that has no rate as No rate", async () => {
    await addSupplier("Hong Kong", { currency: "USD" })
    show()
    expect(await screen.findByText("No rate")).toBeInTheDocument()
  })

  it("lets a purchaser without the money tier still add a quote's details", async () => {
    const redleaf = await addSupplier("Redleaf Inc.")
    show({ money: false })
    const user = await userDetails("Redleaf Inc.", "Folding stretcher")
    await user.type(await screen.findByRole("textbox", { name: "Brand, Redleaf Inc., Folding stretcher" }), "Ferno")
    await user.tab()
    await waitFor(() => expect(db.rows("request_canvass_quotes")[0]).toMatchObject({ brand: "Ferno", supplier_id: redleaf.supplier.id }))
  })
})

describe("the offer projection", () => {
  it("shows what a line's Component would cost if the quote won, in the liner", async () => {
    const redleaf = await addSupplier("Redleaf Inc.")
    await quote(redleaf, lineA, { unitPrice: 1000 })
    const quoteRow = db.rows("request_canvass_quotes")[0]
    patchLine(lineA, { component_id: "00000000-0000-4000-8000-000000000042" })
    show({
      projection: [{ quote_id: quoteRow.id, offer_id: quoteRow.id, item_id: lineA.id, supplier_id: redleaf.supplier.id, acquire_unit: 1000, markup_price_unit: 1300 }],
    })
    await userDetails("Redleaf Inc.", "Folding stretcher")
    const projection = await screen.findByTestId("offer-projection")
    expect(projection).toHaveTextContent("If this offer wins")
    expect(screen.getByTestId("projection-acquire")).toHaveTextContent("₱1,000.00")
    expect(screen.getByTestId("projection-markup-price")).toHaveTextContent("₱1,300.00")
  })

  it("shows none for a line that names no Component", async () => {
    const redleaf = await addSupplier("Redleaf Inc.")
    await quote(redleaf, lineA, { unitPrice: 1000 })
    show()
    await userDetails("Redleaf Inc.", "Folding stretcher")
    await screen.findByTestId("cell-liner")
    expect(screen.queryByTestId("offer-projection")).toBeNull()
  })
})

describe("removing a supplier", () => {
  it("asks first, then takes the supplier off", async () => {
    const redleaf = await addSupplier("Redleaf Inc.")
    await quote(redleaf, lineA, { unitPrice: 1000 })
    const user = setupUser()
    show()
    await user.click(await screen.findByRole("button", { name: "Remove Redleaf Inc." }))
    const dialog = await screen.findByRole("alertdialog").catch(() => screen.findByRole("dialog", { name: "Remove Redleaf Inc.?" }))
    await user.click(within(dialog).getByRole("button", { name: "Remove" }))
    await waitFor(() => expect(db.rows("request_canvass_suppliers")).toHaveLength(0))
  })
})
