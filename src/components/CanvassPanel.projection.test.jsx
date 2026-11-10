/**
 * Offer Projection on the Canvass panel (#321), against the fake database: beside each Offer on a
 * Component's Canvass, what the costing would become if it won. The figures themselves come from
 * the database (policy test 98) and the pure arithmetic is in offerProjection.test.js; this checks
 * what reaches the screen: Purchasing sees Acquire and Markup Price, a foreign Offer with no rate
 * shows nothing, a Canvass with no Component shows no projection and no error, and the Closed
 * Book also sees the margin and the summary.
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

const COMPONENT = "00000000-0000-0000-0000-0000000000c1"
let OPPORTUNITY

let canvass, php, usd

const seedOffer = (fields, price) => {
  const offer = db.seed("sor_canvass_offers", { canvass_id: canvass.id, supplier_name: "Redleaf Inc.", brochure: [], ...fields })
  db.seed("sor_canvass_offer_prices", { offer_id: offer.id, unit_price: null, comparison_rate: null, ...price })
  return offer
}

const open = () =>
  renderWithProviders(
    <CanvassPanel open onOpenChange={() => {}} subject={{ componentId: COMPONENT }} subjectLabel="1.1 Stretcher" userId="u1" canEdit={false} opportunityId={OPPORTUNITY} />,
  )

beforeEach(() => {
  stubCanvassMoneyRpc({ money: true })
  const seller = makeEmployee({ name: "Ana Reyes" })
  OPPORTUNITY = makeOpportunity({ registered_by: seller.id, deal_owner_id: seller.id }).id
  const matrix = db.seed("costing_matrices", { opportunity_id: OPPORTUNITY })
  db.seed("costing_matrix_money", { matrix_id: matrix.id, default_factor: 1.25 })
  const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, quantity: 2 })
  db.seed("costing_tender_line_prices", { tender_line_id: line.id, final_offer_unit: 150000 })
  db.seed("costing_components", { id: COMPONENT, tender_line_id: line.id, position: 1, name: "Stretcher", quantity: 2 })
  db.seed("costing_component_costs", { component_id: COMPONENT, acquire_unit: 60000, final_acquire_unit: 60000 })
  canvass = db.seed("sor_canvasses", { component_id: COMPONENT, number: "CNV_0001" })
  php = seedOffer({ supplier_name: "Redleaf PH" }, { unit_price: 78000 })
  usd = seedOffer({ supplier_name: "Hong Kong", currency: "USD" }, {})
})

describe("Purchasing", () => {
  beforeEach(() => {
    stubRpc("canvass_offer_projection", () => [
      { offer_id: php.id, acquire_unit: 78000, markup_price_unit: 97500 },
      { offer_id: usd.id, acquire_unit: null, markup_price_unit: null },
    ])
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] })
  })

  it("sees the Acquire and the Markup Price beside an Offer that has a figure", async () => {
    open()
    const projection = await screen.findByTestId("offer-projection")
    expect(within(projection).getByTestId("projection-acquire")).toHaveTextContent("78,000")
    expect(within(projection).getByTestId("projection-markup-price")).toHaveTextContent("97,500")
  })

  it("shows nothing for a foreign Offer with no rate, rather than a wrong figure", async () => {
    open()
    await screen.findByTestId("offer-projection")
    expect(screen.getAllByTestId("offer-projection")).toHaveLength(1)
  })

  it("sees neither the margin nor the summary", async () => {
    open()
    await screen.findByTestId("offer-projection")
    expect(screen.queryByTestId("projection-margin")).not.toBeInTheDocument()
    expect(screen.queryByTestId("projection-summary")).not.toBeInTheDocument()
  })
})

describe("a reader the database serves no projection", () => {
  it("sees the Offers and no projection, and no error", async () => {
    stubRpc("canvass_offer_projection", () => null)
    open()
    expect(await screen.findByText("Redleaf PH")).toBeInTheDocument()
    expect(screen.queryByTestId("offer-projection")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})

describe("a Canvass on a Requested Item", () => {
  it("shows no projection and asks the database nothing", async () => {
    const request = db.seed("purchase_requests", { opportunity_id: OPPORTUNITY, created_by: db.internal.rowsOf("employees")[0].id })
    const item = db.seed("purchase_request_items", { request_id: request.id, source: "new", name: "Spine board", unit: "pc", quantity: 1, requested_by: request.created_by })
    const itemCanvass = db.seed("sor_canvasses", { requested_item_id: item.id, number: "CNV_0002" })
    db.seed("sor_canvass_offers", { canvass_id: itemCanvass.id, supplier_name: "Acme", brochure: [] })
    let asked = false
    stubRpc("canvass_offer_projection", () => {
      asked = true
      return null
    })
    renderWithProviders(
      <CanvassPanel open onOpenChange={() => {}} subject={{ requestedItemId: item.id }} subjectLabel="Spine board" userId="u1" canEdit={false} opportunityId={OPPORTUNITY} />,
    )
    expect(await screen.findByText("Acme")).toBeInTheDocument()
    expect(screen.queryByTestId("offer-projection")).not.toBeInTheDocument()
    expect(asked).toBe(false)
  })
})

describe("the Closed Book", () => {
  it("also sees the Tender Line margin and what the summary would become", async () => {
    stubRpc("canvass_offer_projection", () => [{ offer_id: php.id, acquire_unit: 50000, markup_price_unit: 62500 }])
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["management"] })
    open()
    const projection = await screen.findByTestId("offer-projection")
    expect(within(projection).getByTestId("projection-acquire")).toHaveTextContent("50,000")
    // 2 x 150,000 offer; the Component at 2 x 50,000 leaves a 200,000 margin (66.67%), up from 180,000
    expect(await within(projection).findByTestId("projection-margin")).toHaveTextContent("200,000")
    expect(within(projection).getByTestId("projection-margin")).toHaveTextContent("66.67%")
    expect(within(projection).getByTestId("projection-margin")).toHaveTextContent("now ₱180,000")
    expect(within(projection).getByTestId("projection-summary")).toBeInTheDocument()
  })
})
