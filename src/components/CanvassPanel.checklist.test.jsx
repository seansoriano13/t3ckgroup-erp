/**
 * The Canvass panel's "Your move" checklist (#898), against the fake database. "Offers in" is done
 * only when the three supplier slots are filled or explained, the checklist lists the reason step
 * so its count matches the steps shown, and the reason says when it is saved.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, within } from "@testing-library/react"
import { renderWithProviders } from "@/test/support"
import { stubRpc } from "@/test/msw/server"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubCanvassMoneyRpc } from "@/test/stubs/canvassRpc"
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc"
import CanvassPanel from "./CanvassPanel"

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", name: "Ben Cruz" } }) }))

const COMPONENT = "00000000-0000-0000-0000-0000000000c2"
let OPPORTUNITY

const seedCanvass = (fields = {}) => db.seed("sor_canvasses", { component_id: COMPONENT, number: "CNV_0042", ...fields })

const seedOffer = (canvass, fields) => {
  const offer = db.seed("sor_canvass_offers", { canvass_id: canvass.id, supplier_name: "Redleaf Inc.", brochure: [], ...fields })
  db.seed("sor_canvass_offer_prices", { offer_id: offer.id, unit_price: 1000, comparison_rate: null })
  return offer
}

const open = () =>
  renderWithProviders(
    <CanvassPanel open onOpenChange={() => {}} subject={{ componentId: COMPONENT }} subjectLabel="1.2 Table" userId="u1" canEdit opportunityId={OPPORTUNITY} />,
  )

const stepRow = (title) => screen.getByRole("button", { name: new RegExp(`^${title}`) })

beforeEach(() => {
  stubCanvassMoneyRpc({ money: true })
  stubRpc("canvass_offer_projection", () => [])
  stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] })
  const seller = makeEmployee({ name: "Ana Reyes" })
  OPPORTUNITY = makeOpportunity({ registered_by: seller.id, deal_owner_id: seller.id }).id
  const matrix = db.seed("costing_matrices", { opportunity_id: OPPORTUNITY })
  db.seed("costing_matrix_money", { matrix_id: matrix.id, default_factor: 1.25 })
  const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, quantity: 1 })
  db.seed("costing_tender_line_prices", { tender_line_id: line.id, final_offer_unit: 150000 })
  db.seed("costing_components", { id: COMPONENT, tender_line_id: line.id, position: 1, name: "Table", quantity: 1 })
  db.seed("costing_component_costs", { component_id: COMPONENT, acquire_unit: 60000, final_acquire_unit: 60000 })
})

describe("Offers in", () => {
  it("is not done with fewer than three supplier slots filled or explained", async () => {
    const canvass = seedCanvass()
    seedOffer(canvass, { supplier_name: "Redleaf PH" })
    seedOffer(canvass, { supplier_name: "Acme" })
    open()
    expect(await screen.findByText("2 of 3 supplier slots filled or explained", {}, { timeout: 15000 })).toBeInTheDocument()
    expect(within(stepRow("Offers in")).getByText("Now")).toBeInTheDocument()
    expect(screen.getByText("Next: fill or explain the other supplier slots")).toBeInTheDocument()
  }, 20000)

  it("is done once three offers are in", async () => {
    const canvass = seedCanvass()
    seedOffer(canvass, { supplier_name: "Redleaf PH" })
    seedOffer(canvass, { supplier_name: "Acme" })
    seedOffer(canvass, { supplier_name: "Beta" })
    open()
    await screen.findByText("Redleaf PH")
    expect(within(stepRow("Offers in")).getByText("Done")).toBeInTheDocument()
  })
})

describe("the checklist", () => {
  it("lists the reason step, and the count matches the steps shown", async () => {
    const canvass = seedCanvass()
    seedOffer(canvass, { supplier_name: "Redleaf PH" })
    seedOffer(canvass, { supplier_name: "Acme" })
    seedOffer(canvass, { supplier_name: "Beta" })
    open()
    await screen.findByText("Redleaf PH")
    expect(stepRow("Why this supplier")).toBeInTheDocument()
    const stepCount = document.querySelectorAll("ol > li > button[aria-expanded]").length
    expect(screen.getByText(`1 of ${stepCount} signed`)).toBeInTheDocument()
  })
})

describe("the reason", () => {
  it("shows Saved once a reason is stored", async () => {
    const canvass = seedCanvass({ reason: "Best lead time" })
    seedOffer(canvass, { supplier_name: "Redleaf PH" })
    seedOffer(canvass, { supplier_name: "Acme" })
    seedOffer(canvass, { supplier_name: "Beta" })
    open()
    expect(await screen.findByTestId("reason-saved")).toHaveTextContent("Saved")
  })

  it("shows no Saved sign when no reason is written", async () => {
    const canvass = seedCanvass()
    seedOffer(canvass, { supplier_name: "Redleaf PH" })
    open()
    await screen.findByText("Redleaf PH")
    expect(screen.queryByTestId("reason-saved")).not.toBeInTheDocument()
  })
})
