/**
 * Issue #53 — opening an SOR that carries a Sales Reference triggers a
 * background fetch against Odoo and, on success, writes the returned product
 * lines straight to the record. It is the only path in the app that mutates
 * an opportunity as a side effect of *viewing* it, and until now it had no
 * coverage at all.
 *
 * Per docs/testing.md this exercises the fake Supabase through the real
 * opportunityService rather than mocking it — only the Odoo edge function
 * itself, a genuine external boundary, is stubbed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"

import { renderWithProviders } from "../../test/support"
import { stubEdgeFunction, stubRpc } from "../../test/msw/server"
import { waitForNetworkIdle } from "../../test/network"
import { useQuery } from "@tanstack/react-query"
import {
  makeEmployee,
  makeFlowEdge,
  makeFlowSnapshot,
  makeFlowStage,
  makeOpportunity,
  makeOpportunityItem,
  makeSaleType,
  makeSalesFlow,
  makeStageAction,
  makeStageCondition,
  seedPipeline,
} from "../../test/factories"
import { opportunityService } from "../../services/opportunityService"
import OpportunityDetailsModal from "./OpportunityDetailsModal"

let authUser
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

function renderModal(opportunity) {
  const owner = makeEmployee()
  authUser = { id: owner.id, isSuperAdmin: true }
  renderWithProviders(
    <OpportunityDetailsModal isOpen onClose={() => {}} opportunity={opportunity} />,
  )
  return owner
}

// The Product List now lives behind its own tab (#301) rather than the
// modal's default view, so a test after its items must open Items first.
async function openItemsTab() {
  fireEvent.click(await screen.findByRole("button", { name: /^Products/ }))
}

const found = (items, extra = {}) => ({
  success: true,
  found: true,
  order: { id: 6070, name: "S06070", state: "sale" },
  customer: { company: "Makati City Government", contact: "" },
  items,
  ...extra,
})

describe("OpportunityDetailsModal — Odoo auto-sync on open (#53)", () => {
  beforeEach(() => {
    stubRpc("sor_can_edit_opportunity", () => true)
    stubEdgeFunction("odoo-sor-lookup", found([]))
  })

  it("does not touch the stored Product List when Odoo returns success with no lines", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({
      registered_by: owner.id,
      sales_reference: "S06070",
    })
    makeOpportunityItem(opportunity.id, { product_name: "Existing Pumper" })
    stubEdgeFunction(
      "odoo-sor-lookup",
      found([], { message: "S06070 was found in Odoo but has no product lines yet." }),
    )

    renderModal(opportunity)
    await openItemsTab()
    await screen.findByText("Existing Pumper")
    await waitForNetworkIdle()

    const items = await opportunityService.getItems(opportunity.id)
    expect(items.map((i) => i.product_name)).toEqual(["Existing Pumper"])
  })

  it("does not touch the stored Product List when the lookup fails or matches nothing", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({
      registered_by: owner.id,
      sales_reference: "S06070",
    })
    makeOpportunityItem(opportunity.id, { product_name: "Existing Pumper" })
    stubEdgeFunction("odoo-sor-lookup", {
      success: false,
      found: false,
      message: 'No Odoo quotation found matching "S06070".',
    })

    renderModal(opportunity)
    await openItemsTab()
    await screen.findByText("Existing Pumper")
    await waitForNetworkIdle()

    const items = await opportunityService.getItems(opportunity.id)
    expect(items.map((i) => i.product_name)).toEqual(["Existing Pumper"])
  })

  it("replaces the stored Product List when Odoo actually returns lines", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({
      registered_by: owner.id,
      sales_reference: "S06070",
    })
    makeOpportunityItem(opportunity.id, { product_name: "Stale Pumper" })
    stubEdgeFunction(
      "odoo-sor-lookup",
      found([{ product_name: "Fresh Ambulance", quantity: 1, unit: "unit", unit_price: 1500 }]),
    )

    renderModal(opportunity)

    await waitFor(async () => {
      const items = await opportunityService.getItems(opportunity.id)
      expect(items.map((i) => i.product_name)).toEqual(["Fresh Ambulance"])
    })
  })

  it("does not run at all for an SOR without a Sales Reference", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({ registered_by: owner.id, sales_reference: null })
    makeOpportunityItem(opportunity.id, { product_name: "Existing Pumper" })

    renderModal(opportunity)
    await openItemsTab()
    await screen.findByText("Existing Pumper")
    await waitForNetworkIdle()

    const items = await opportunityService.getItems(opportunity.id)
    expect(items.map((i) => i.product_name)).toEqual(["Existing Pumper"])
  })

  it("syncs a given Sales Reference at most once", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({
      registered_by: owner.id,
      sales_reference: "S06070",
    })
    let calls = 0
    stubEdgeFunction("odoo-sor-lookup", () => {
      calls += 1
      return found([{ product_name: "Fresh Ambulance", quantity: 1, unit: "unit", unit_price: 1500 }])
    })

    renderModal(opportunity)

    await waitFor(async () => {
      const items = await opportunityService.getItems(opportunity.id)
      expect(items.map((i) => i.product_name)).toEqual(["Fresh Ambulance"])
    })
    await waitForNetworkIdle()

    expect(calls).toBe(1)
  })
})

describe("OpportunityDetailsModal — no manual Fetch Items (#816)", () => {
  it("has no Fetch Items button in the edit form: Odoo is read when the S0 is saved", async () => {
    stubRpc("sor_can_edit_opportunity", () => true)
    const owner = makeEmployee()
    const opportunity = makeOpportunity({ registered_by: owner.id, sales_reference: "S06070" })
    makeOpportunityItem(opportunity.id, { product_name: "Existing Pumper" })
    stubEdgeFunction("odoo-sor-lookup", found([], { message: "S06070 was found in Odoo but has no product lines yet." }))

    renderModal(opportunity)
    await openItemsTab()
    await screen.findByText("Existing Pumper")
    await waitForNetworkIdle()

    fireEvent.click(screen.getByRole("button", { name: /^edit( opportunity)?$/i }))
    await screen.findByRole("button", { name: /^save$/i })

    expect(screen.queryByRole("button", { name: /fetch items/i })).not.toBeInTheDocument()
  })
})

/**
 * Issue #199 — the modal reads its SOR the way GlobalDetailManager hands it
 * over: through the ["globalOpportunity", id] query, so an invalidation is
 * what refreshes it, never a remount.
 */
function LiveModal({ id }) {
  const { data } = useQuery({
    queryKey: ["globalOpportunity", id],
    queryFn: () => opportunityService.getOpportunityById(id),
  })
  if (!data) return null
  return <OpportunityDetailsModal isOpen onClose={() => {}} opportunity={data} />
}

describe("OpportunityDetailsModal — Stage Checklist and moves (#199)", () => {
  let owner, lead, qualified, saleType

  beforeEach(() => {
    stubEdgeFunction("odoo-sor-lookup", found([]))
    seedPipeline()
    owner = makeEmployee({ name: "Ben Cruz" })
    authUser = { id: owner.id, isSuperAdmin: true }
    saleType = makeSaleType({ name: "Flow" })
    const flow = makeSalesFlow({ sale_type_id: saleType.id })
    lead = makeFlowStage({ flow_id: flow.id, name: "Lead", sort_order: 0 })
    qualified = makeFlowStage({ flow_id: flow.id, name: "Qualified", sort_order: 1 })
    makeFlowEdge(lead, qualified)
  })

  const register = () =>
    opportunityService.createOpportunity(
      {
        registration_date: "2026-03-01",
        lead_source: "LGU",
        client_name: "Quezon City Hall",
        project_title: "Fire truck supply",
        project_type: "SSP",
        sale_type_id: saleType.id,
        deal_owner_id: owner.id,
        items: [{ product_name: "Stored Pumper", quantity: 1, unit_price: 100 }],
      },
      owner.id,
    )

  // Issue #203: Field on record is a removed condition kind — the checklist
  // no longer renders an editable input for it at all (a `field` condition
  // now evaluates not_applicable and getStageChecklist leaves it out).
  // What used to be entered this way now belongs on the Fields tab's Stage
  // Fields form (Q49's SOR-field write path, reusing #199's single-field
  // write) — that form is not implemented in this pass (see PR notes); this
  // test's own claim ("Field on record" renders and saves) is retired
  // rather than left to assert dead UI.
  it("no longer renders an input for a field condition — it's a removed kind", async () => {
    makeStageCondition({ stage_id: lead.id, kind: "field", label: "PO Date on file", config: { column: "po_date" } })
    makeFlowSnapshot({ flow_id: lead.flow_id })
    const deal = await register()

    renderWithProviders(<LiveModal id={deal.id} />)
    await openItemsTab()
    await screen.findByText("Stored Pumper")
    expect(screen.queryByLabelText("PO Date on file")).not.toBeInTheDocument()
  })

  it("shows the move's new task and the new Stage's checklist without reopening", async () => {
    makeStageAction({ stage_id: qualified.id, kind: "create_individual_task", config: { title: "Confirm requirements" } })
    makeStageCondition({ stage_id: qualified.id, kind: "tickbox", label: "Signed proposal" })
    makeFlowSnapshot({ flow_id: lead.flow_id })
    const deal = await register()

    renderWithProviders(<LiveModal id={deal.id} />)
    fireEvent.click(await screen.findByRole("button", { name: /^This stage/ }))
    await screen.findByText("What blocks this stage")
    const destinationTile = (await screen.findAllByText("Qualified")).map((el) => el.closest("li")).find(Boolean)
    fireEvent.click(destinationTile)
    await waitForNetworkIdle()

    // Issue #178: a Stage Action's task is always titled `[ref] [project]`,
    // not the action's own config.title — that stays identifiable from a
    // task list without opening it, whatever the automation was called.
    expect(await screen.findByText("[No Sales Reference] [Fire truck supply]")).toBeInTheDocument()
    expect(await screen.findByText("Signed proposal")).toBeInTheDocument()
  })
})
