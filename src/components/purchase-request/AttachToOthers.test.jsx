/**
 * #809: after a P0 is attached to one item, the window offers the other items it covers. The
 * server builds the offer (odoo-po-verify), so these tests stub the edge function's answers and
 * check what the screen shows and sends. The offer's rules are tested in src/utils/p0Offer.test.js.
 */
import { openRowNamed } from "@/test/openRequestedItem"
import { beforeEach, describe, expect, it } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import { Toaster } from "react-hot-toast"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubEdgeFunction } from "@/test/msw/server"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { MemoryRouter } from "react-router"
import RequestedItems from "./RequestedItems"

let salesperson, buyer, request, harness, carabiner, lanyard, sling, typed, sent

const seedItem = (fields = {}) =>
  db.seed("purchase_request_items", {
    request_id: request.id,
    source: "new",
    unit: "pc",
    quantity: 4,
    requested_by: salesperson.id,
    status: "to_purchase",
    ...fields,
  })

const SUGGESTIONS = {
  success: true,
  suggested: [
    { id: 1, name: "P01111", state: "purchase", supplier: "Acme", lines: [{ id: 10, product_id: 7, product_name: "Full Body Harness", quantity: 10, received: 0 }] },
  ],
  others: [],
}

/** The offer the server would build for the three other items of the test request. */
const offer = () => ({
  offered: [
    { itemId: carabiner.id, name: "Carabiner", lineIds: [11], products: ["Carabiner Pouch"], status: "purchased" },
    { itemId: lanyard.id, name: "Lanyard", lineIds: [12], products: ["Lanyard 2m"], status: "to_purchase" },
  ],
  unticked: [{ itemId: sling.id, name: "Sling", reason: "shared_product" }],
  noOdooProduct: [{ itemId: typed.id, name: "Typed product" }],
})

/**
 * Answers the attach (`action: "attach"`) and the bulk attach (`action: "attach_many"`). The first
 * attach is refused for buying not open until the Order early reason is sent, when `needsEarly` is set.
 */
function stubVerify({ needsEarly = false, manyResults } = {}) {
  stubEdgeFunction("odoo-po-verify", (body) => {
    sent.push(body)
    if (body.action === "attach_many") {
      return { success: true, results: manyResults ? manyResults(body) : body.itemIds.map((itemId) => ({ itemId, ok: true, status: "purchased" })) }
    }
    if (needsEarly && !body.orderEarly) {
      return { success: false, refused: true, code: "buying_not_open", message: "buying opens at Award and this SOR has not reached it; choose Order early and give a reason to attach now" }
    }
    return {
      success: true,
      verdict: "verified",
      item: { id: harness.id, name: "Full Body Harness", status: "purchased", po_number: "P01111" },
      ipas: null,
      offer: offer(),
    }
  })
}

const mount = () => renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

/** Opens the Attach P0 window on the harness line, chooses P01111 and attaches it. */
async function attachHarness(user, { label = "Attach P01111" } = {}) {
  const row = await openRowNamed("Full Body Harness")
  await user.click(within(row).getByRole("button", { name: "Attach P0" }))
  const dialog = await screen.findByRole("dialog")
  await user.click(await within(dialog).findByRole("button", { name: "Choose P01111" }))
  await user.click(within(dialog).getByRole("button", { name: label }))
}

/** The window that offers the other items. It replaces the Attach P0 window, so it is looked up again. */
const followUpWindow = () =>
  waitFor(() => {
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText(/covers these other items too/)).toBeInTheDocument()
    return dialog
  })

beforeEach(() => {
  sent = []
  salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  buyer = makeEmployee({ name: "Ben Cruz", department: "OPERATIONS", has_purchasing_flow: true })
  const opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
  request = db.seed("purchase_requests", {
    opportunity_id: opportunity.id,
    created_by: salesperson.id,
    buyer_id: buyer.id,
  })
  request = { ...request, sales_reference: "S01237" }
  db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
  harness = seedItem({ name: "Full Body Harness", odoo_product_id: 7 })
  carabiner = seedItem({ name: "Carabiner", odoo_product_id: 2, status: "not_checked" })
  lanyard = seedItem({ name: "Lanyard", odoo_product_id: 3, status: "not_checked" })
  sling = seedItem({ name: "Sling", odoo_product_id: 3, status: "not_checked" })
  typed = seedItem({ name: "Typed product", odoo_product_id: null, status: "not_checked" })
  stubEdgeFunction("odoo-po-suggest", () => SUGGESTIONS)
  stubPurchaseRequestItemRpcs({ actorId: buyer.id, odoo: "found" })
})

describe("Attach to the other items", () => {
  it("lists the items the P0 covers, pre-ticked, each with its P0 line and the status it gets", async () => {
    stubVerify()
    mount()
    await attachHarness(setupUser()); const dialog = await followUpWindow()

    expect(await within(dialog).findByText("Carabiner")).toBeInTheDocument()
    expect(within(dialog).getByRole("checkbox", { name: "Attach to Carabiner" })).toBeChecked()
    expect(within(dialog).getByRole("checkbox", { name: "Attach to Lanyard" })).toBeChecked()
    expect(within(dialog).getByText("P0 line: Carabiner Pouch. Becomes Purchased.")).toBeInTheDocument()
    expect(within(dialog).getByText("P0 line: Lanyard 2m. Becomes To purchase.")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Attach to 2 items" })).toBeEnabled()
  })

  it("leaves an unticked item out of the request", async () => {
    stubVerify()
    mount()
    const user = setupUser()
    await attachHarness(user); const dialog = await followUpWindow()
    await user.click(await within(dialog).findByRole("checkbox", { name: "Attach to Lanyard" }))
    expect(within(dialog).getByRole("checkbox", { name: "Attach to Lanyard" })).not.toBeChecked()
    await user.click(within(dialog).getByRole("button", { name: "Attach to 1 item" }))

    await waitFor(() => expect(sent.find((body) => body.action === "attach_many")).toBeDefined())
    expect(sent.find((body) => body.action === "attach_many")).toMatchObject({ poNumber: "P01111", itemIds: [carabiner.id] })
  })

  it("sends nothing when Skip is pressed, and closes the window", async () => {
    stubVerify()
    mount()
    const user = setupUser()
    await attachHarness(user); const dialog = await followUpWindow()
    await user.click(await within(dialog).findByRole("button", { name: "Skip" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(sent.filter((body) => body.action === "attach_many")).toHaveLength(0)
    expect(sent.filter((body) => body.action === "attach")).toHaveLength(1)
  })

  it("lists an item that shares its product unticked, with a note, and lets it be ticked", async () => {
    stubVerify()
    mount()
    const user = setupUser()
    await attachHarness(user); const dialog = await followUpWindow()

    const shared = await within(dialog).findByRole("checkbox", { name: "Attach to Sling" })
    expect(shared).not.toBeChecked()
    expect(shared).not.toHaveAttribute("aria-disabled", "true")
    expect(within(dialog).getAllByText("Same product is on another line of this request. Its P0 line is not picked.")).toHaveLength(1)
    expect(within(dialog).getByRole("button", { name: "Attach to 2 items" })).toBeEnabled()

    await user.click(shared)
    expect(shared).toBeChecked()
    expect(within(dialog).getByRole("button", { name: "Attach to 3 items" })).toBeEnabled()
    await user.click(within(dialog).getByRole("button", { name: "Attach to 3 items" }))
    await waitFor(() => expect(sent.filter((body) => body.action === "attach_many")).toHaveLength(1))
    // The server picks no P0 line for a shared item; the screen only sends its id.
    expect(sent.find((body) => body.action === "attach_many").itemIds).toEqual([carabiner.id, lanyard.id, sling.id])
  })

  it("opens the window when the only other items are shared-product items, all unticked", async () => {
    stubEdgeFunction("odoo-po-verify", (body) => {
      sent.push(body)
      return {
        success: true,
        verdict: "verified",
        item: { id: harness.id, status: "purchased", po_number: "P01111" },
        ipas: null,
        offer: { offered: [], unticked: [{ itemId: sling.id, name: "Sling", reason: "shared_product" }], noOdooProduct: [] },
      }
    })
    mount()
    const user = setupUser()
    await attachHarness(user)
    const dialog = await followUpWindow()

    expect(within(dialog).getByRole("checkbox", { name: "Attach to Sling" })).not.toBeChecked()
    expect(within(dialog).getByRole("button", { name: "Attach to 0 items" })).toBeDisabled()
  })

  it("shows the warning for each item in the results, when the P0 has no row for it", async () => {
    stubVerify({
      manyResults: (body) =>
        body.itemIds.map((itemId) =>
          itemId === carabiner.id
            ? { itemId, ok: true, status: "purchased", warning: "This P0 has no line for this product. It may be the wrong P0." }
            : { itemId, ok: true, status: "to_purchase", warning: null },
        ),
    })
    mount()
    const user = setupUser()
    await attachHarness(user); const dialog = await followUpWindow()
    await user.click(await within(dialog).findByRole("button", { name: "Attach to 2 items" }))

    const results = await within(dialog).findAllByTestId("attach-other-result")
    expect(results[0]).toHaveTextContent("Carabiner: Purchased.")
    expect(within(results[0]).getByTestId("attach-other-warning")).toHaveTextContent("This P0 has no line for this product. It may be the wrong P0.")
    expect(within(results[1]).queryByTestId("attach-other-warning")).not.toBeInTheDocument()
  })

  it("shows the P0 warning as a toast after a single attach that has no row for the item's product", async () => {
    stubEdgeFunction("odoo-po-verify", (body) => {
      sent.push(body)
      return {
        success: true,
        verdict: "verified",
        item: { id: harness.id, name: "Full Body Harness", status: "purchased", po_number: "P01111" },
        ipas: null,
        offer: { offered: [], unticked: [], noOdooProduct: [] },
        warning: "This P0 has no line for this product. It may be the wrong P0.",
      }
    })
    mount()
    render(<Toaster />)
    await attachHarness(setupUser())

    expect(await screen.findByText("This P0 has no line for this product. It may be the wrong P0.")).toBeInTheDocument()
  })

  it("shows the result for each item: its new status, and the reason a failed one did not attach", async () => {
    stubVerify({
      manyResults: (body) =>
        body.itemIds.map((itemId) =>
          itemId === carabiner.id
            ? { itemId, ok: true, status: "purchased" }
            : { itemId, ok: false, message: "Lanyard 2m is cancelled in Odoo, so it can't be attached." },
        ),
    })
    mount()
    const user = setupUser()
    await attachHarness(user); const dialog = await followUpWindow()
    await user.click(await within(dialog).findByRole("button", { name: "Attach to 2 items" }))

    const results = await within(dialog).findAllByTestId("attach-other-result")
    expect(results).toHaveLength(2)
    expect(results[0]).toHaveTextContent("Carabiner: Purchased.")
    expect(results[1]).toHaveTextContent("Lanyard: Lanyard 2m is cancelled in Odoo, so it can't be attached.")
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeInTheDocument()
  })

  it("sends the Order early reason given for the first item with the bulk attach", async () => {
    stubVerify({ needsEarly: true })
    mount()
    const user = setupUser()
    await attachHarness(user)
    const attachWindow = await screen.findByRole("dialog")
    const early = await within(attachWindow).findByTestId("order-early")
    await user.type(within(early).getByLabelText("Order early: why now?"), "Price ends Friday")
    await user.click(within(attachWindow).getByRole("button", { name: "Order early and attach P01111" }))

    const dialog = await followUpWindow()
    await user.click(await within(dialog).findByRole("button", { name: "Attach to 2 items" }))
    await waitFor(() => expect(sent.filter((body) => body.action === "attach_many")).toHaveLength(1))
    expect(sent.find((body) => body.action === "attach_many")).toMatchObject({
      orderEarly: true,
      orderEarlyReason: "Price ends Friday",
      itemIds: [carabiner.id, lanyard.id],
    })
  })

  it("does not open the window when the P0 covers no other item", async () => {
    stubEdgeFunction("odoo-po-verify", (body) => {
      sent.push(body)
      return { success: true, verdict: "verified", item: { id: harness.id, status: "purchased", po_number: "P01111" }, ipas: null, offer: { offered: [], unticked: [] } }
    })
    mount()
    await attachHarness(setupUser())

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(sent.filter((body) => body.action === "attach_many")).toHaveLength(0)
  })

  it("shows an item with no Odoo product in its own section, unticked, and leaves the count alone", async () => {
    stubVerify()
    mount()
    await attachHarness(setupUser())
    const dialog = await followUpWindow()

    const section = within(dialog).getByRole("region", { name: "No Odoo product" })
    expect(within(section).getByText("No Odoo product. Tick if this P0 covers them")).toBeInTheDocument()
    expect(within(section).getByRole("checkbox", { name: "Attach to Typed product" })).not.toBeChecked()
    // The P0 items stay pre-ticked, so the count is still the two of them.
    expect(within(dialog).getByRole("button", { name: "Attach to 2 items" })).toBeEnabled()
  })

  it("sends a ticked item with no Odoo product in the bulk attach, and the result shows it", async () => {
    stubVerify()
    mount()
    const user = setupUser()
    await attachHarness(user)
    const dialog = await followUpWindow()
    await user.click(within(dialog).getByRole("checkbox", { name: "Attach to Typed product" }))
    await user.click(within(dialog).getByRole("button", { name: "Attach to 3 items" }))

    await waitFor(() => expect(sent.filter((body) => body.action === "attach_many")).toHaveLength(1))
    expect(sent.find((body) => body.action === "attach_many")).toMatchObject({
      poNumber: "P01111",
      itemIds: [carabiner.id, lanyard.id, typed.id],
    })
    const results = await within(dialog).findAllByTestId("attach-other-result")
    expect(results[2]).toHaveTextContent("Typed product: Purchased.")
  })

  it("opens the window when the only other item is one with no Odoo product", async () => {
    stubEdgeFunction("odoo-po-verify", (body) => {
      sent.push(body)
      return {
        success: true,
        verdict: "verified",
        item: { id: harness.id, status: "purchased", po_number: "P01111" },
        ipas: null,
        offer: { offered: [], unticked: [], noOdooProduct: [{ itemId: typed.id, name: "Typed product" }] },
      }
    })
    mount()
    const user = setupUser()
    await attachHarness(user)
    const dialog = await followUpWindow()

    expect(within(dialog).getByRole("checkbox", { name: "Attach to Typed product" })).not.toBeChecked()
    expect(within(dialog).getByRole("button", { name: "Attach to 0 items" })).toBeDisabled()
  })
})
