/**
 * Adding Canvasses that already exist to a Purchase Request: only Canvasses with a winner and no
 * subject are offered, each becomes a new item with its quantity or goes onto an item that has no
 * Canvass yet, and the Canvass is locked afterwards. Real components on the fake database; the
 * database's own rules are in the policy tier (132-canvass-add-to-request).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { renderWithProviders, setupUser, chooseOption } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee } from "@/test/factories"
import { stubCanvassListRpcs, stubCanvassAddToRequestRpc } from "@/test/stubs/canvassRpc"
import AddCanvassedItemsDialog from "./AddCanvassedItemsDialog"

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }))

let purchaser, request, stapler

const mount = (items) =>
  renderWithProviders(<AddCanvassedItemsDialog open onOpenChange={() => {}} requestId={request.id} items={items ?? [stapler]} />)

const seedCanvass = (number, productName, { winner = true, signed = false, subject = null } = {}) => {
  const canvass = db.seed("sor_canvasses", {
    number,
    product_name: productName,
    canvasser_id: purchaser.id,
    created_by: purchaser.id,
    signed_off_at: signed ? "2026-10-20T01:00:00Z" : null,
    requested_item_id: subject,
  })
  db.seed("sor_canvass_offers", { canvass_id: canvass.id, supplier_name: "Staple Co", brand: "Rapid", is_winner: winner })
  return canvass
}

beforeEach(() => {
  purchaser = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true })
  request = db.seed("purchase_requests", { title: "Direct buy", created_by: purchaser.id })
  stapler = db.seed("purchase_request_items", { request_id: request.id, source: "new", name: "Stapler", quantity: 3, status: "not_checked", requested_by: purchaser.id })
  stubCanvassListRpcs({ actorId: purchaser.id })
  stubCanvassAddToRequestRpc()
})

describe("AddCanvassedItemsDialog", () => {
  it("offers only Canvasses with a winner and no subject yet", async () => {
    seedCanvass("CNV_0001", "Gloves")
    seedCanvass("CNV_0002", "No winner yet", { winner: false })
    seedCanvass("CNV_0003", "Already on an item", { subject: stapler.id })
    mount()

    const rows = await screen.findAllByTestId("addable-canvass")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent("CNV_0001 · Gloves")
    expect(rows[0]).toHaveTextContent("Staple Co · Rapid")
    expect(rows[0]).toHaveTextContent("Not signed off")
  })

  it("says so when no Canvass is ready", async () => {
    mount()
    expect(await screen.findByTestId("no-addable-canvasses")).toBeInTheDocument()
  })

  it("adds a ticked Canvass as a new item with its quantity, and locks the Canvass", async () => {
    const canvass = seedCanvass("CNV_0001", "Gloves")
    const user = setupUser()
    mount()

    const row = await screen.findByTestId("addable-canvass")
    expect(screen.getByRole("button", { name: "Add Canvass" })).toBeDisabled()
    await user.click(within(row).getByRole("checkbox"))
    const quantity = within(row).getByLabelText("Quantity for CNV_0001")
    await user.clear(quantity)
    await user.type(quantity, "5")
    await user.click(screen.getByRole("button", { name: "Add Canvass" }))

    await waitFor(() => expect(db.rows("purchase_request_items").some((i) => i.name === "Gloves")).toBe(true))
    const item = db.rows("purchase_request_items").find((i) => i.name === "Gloves")
    expect(item).toMatchObject({ request_id: request.id, quantity: 5 })
    const stored = db.rows("sor_canvasses").find((c) => c.id === canvass.id)
    expect(stored.requested_item_id).toBe(item.id)
    expect(stored.request_made_at).toBeTruthy()
  })

  it("attaches a Canvass to an item the request already has, and adds no new item", async () => {
    const canvass = seedCanvass("CNV_0001", "Staplers")
    const user = setupUser()
    mount()

    const row = await screen.findByTestId("addable-canvass")
    await user.click(within(row).getByRole("checkbox"))
    await chooseOption(user, within(row).getByRole("combobox", { name: "Where CNV_0001 goes" }), "On Stapler")
    expect(within(row).queryByLabelText("Quantity for CNV_0001")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add Canvass" }))

    await waitFor(() => expect(db.rows("sor_canvasses").find((c) => c.id === canvass.id).requested_item_id).toBe(stapler.id))
    expect(db.rows("purchase_request_items")).toHaveLength(1)
  })

  it("does not offer an item that already has a Canvass", async () => {
    seedCanvass("CNV_0001", "Staplers")
    seedCanvass("CNV_0002", "Stapler pins", { subject: stapler.id })
    const user = setupUser()
    // The request's items carry their Canvass once they have one.
    mount([{ ...stapler, canvass: { id: "x", number: "CNV_0002", signed: false } }])

    const row = await screen.findByTestId("addable-canvass")
    await user.click(within(row).getByRole("checkbox"))
    await user.click(within(row).getByRole("combobox", { name: "Where CNV_0001 goes" }))
    expect(screen.queryByRole("option", { name: "On Stapler" })).not.toBeInTheDocument()
  })
})
