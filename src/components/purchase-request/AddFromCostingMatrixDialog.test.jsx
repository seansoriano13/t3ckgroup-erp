/**
 * "Add from the Costing Matrix" (#273) on screen, against the fake database with the item and
 * matrix RPCs re-implemented on its store. The picker starts with the For Order Components
 * ticked, adding links the new items to their Components ("1.2 · name"), and the button is
 * Purchasing access's alone. That the database refuses anyone else is the policy tier's
 * (83-costing-purchase-request-items.test.js).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { costingMatrixService } from "@/services/costingMatrixService"
import { MemoryRouter } from "react-router"
import RequestedItems from "./RequestedItems"

vi.mock("browser-image-compression", () => ({ default: async (file) => file }))

let purchaser, opportunity, request, hose, nozzle

const rows = () => screen.queryAllByTestId("requested-item")

beforeEach(async () => {
  purchaser = makeEmployee({ name: "Pat Purchaser", has_purchasing_flow: true })
  opportunity = makeOpportunity({ registered_by: purchaser.id, deal_owner_id: purchaser.id })
  stubCostingMatrixRpcs({ tier: "cost", bands: ["sales", "purchasing"] })

  const matrix = db.seed("costing_matrices", { opportunity_id: opportunity.id })
  const line = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Fire hose, 65 mm", quantity: 4 })
  hose = await costingMatrixService.addComponent(line, { name: "Hose reel", quantity: 4, unit: "pc", availability: "for_order" })
  nozzle = await costingMatrixService.addComponent(line, { name: "Nozzle", quantity: 2, unit: "pc", availability: "available" })
  await costingMatrixService.addComponent(line, { name: "Wall bracket", quantity: 8, availability: "for_order", odooProductId: 303 })

  request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: purchaser.id, buyer_id: purchaser.id })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: purchaser.id, side: "purchasing" })
})

describe("Add from the Costing Matrix", () => {
  it("starts with the For Order Components ticked", async () => {
    stubPurchaseRequestItemRpcs({ actorId: purchaser.id, purchasing: true })
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    await user.click(await screen.findByRole("button", { name: "Add from the Costing Matrix" }))

    expect(await screen.findByRole("checkbox", { name: "1.1 Hose reel" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "1.2 Nozzle" })).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: "1.3 Wall bracket" })).toBeChecked()
    expect(screen.getByRole("button", { name: "Request 2 items" })).toBeEnabled()
  })

  it("adds the ticked Components, each item naming its Component", async () => {
    stubPurchaseRequestItemRpcs({ actorId: purchaser.id, purchasing: true })
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    await user.click(await screen.findByRole("button", { name: "Add from the Costing Matrix" }))
    await user.click(await screen.findByRole("checkbox", { name: "1.2 Nozzle" }))
    await user.click(screen.getByRole("checkbox", { name: "1.3 Wall bracket" }))
    await user.click(screen.getByRole("button", { name: "Request 2 items" }))

    await waitFor(() => expect(rows()).toHaveLength(2))
    const [first, second] = rows()
    expect(within(first).getByText("Hose reel")).toBeInTheDocument()
    expect(within(first).getByText("4 pc")).toBeInTheDocument()
    expect(within(first).getByText("From the Costing Matrix", { exact: false })).toBeInTheDocument()
    expect(within(first).getByTestId("requested-item-component")).toHaveTextContent("1.1 · Hose reel")
    expect(within(second).getByTestId("requested-item-component")).toHaveTextContent("1.2 · Nozzle")
    expect(db.rows("purchase_request_items").map((i) => i.component_id)).toEqual([hose, nozzle])
  })

  it("says how often a Component is already requested, and still lets it be requested again", async () => {
    stubPurchaseRequestItemRpcs({ actorId: purchaser.id, purchasing: true })
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    await user.click(await screen.findByRole("button", { name: "Add from the Costing Matrix" }))
    await user.click(await screen.findByRole("button", { name: "Request 2 items" }))
    await waitFor(() => expect(rows()).toHaveLength(2))

    await user.click(await screen.findByRole("button", { name: "Add from the Costing Matrix" }))
    const reel = (await screen.findByRole("checkbox", { name: "1.1 Hose reel" })).closest("li")
    expect(within(reel).getByText("Already requested")).toBeInTheDocument()
    expect(within(screen.getByRole("checkbox", { name: "1.2 Nozzle" }).closest("li")).queryByText(/Already requested/)).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Request 2 items" }))
    await waitFor(() => expect(rows()).toHaveLength(4))
  })

  it("says so when the SOR has no Costing Matrix", async () => {
    stubPurchaseRequestItemRpcs({ actorId: purchaser.id, purchasing: true })
    db.internal.rowsOf("costing_matrices").splice(0)
    const user = setupUser()
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    await user.click(await screen.findByRole("button", { name: "Add from the Costing Matrix" }))
    expect(await screen.findByText("This SOR has no Costing Matrix yet.")).toBeInTheDocument()
  })

  it("does not offer it to someone without Purchasing access", async () => {
    stubPurchaseRequestItemRpcs({ actorId: purchaser.id, purchasing: false })
    renderWithProviders(<MemoryRouter><RequestedItems request={request} /></MemoryRouter>)

    expect(await screen.findByRole("button", { name: "Add from the SOR" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add from the Costing Matrix" })).not.toBeInTheDocument()
  })
})
