/**
 * #817 — opening a SOR re-checks a Found or Not checked S0 once, in the background, then refreshes
 * the S0 card. When Odoo no longer has the S0 the card shows a red "Gone from Odoo" badge whose
 * reason ("Odoo no longer has S01237") is hover text only. The database function is covered by
 * src/test/policy/817-sales-reference-recheck.test.js; here the edge function and the card read are
 * stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"

import { renderWithProviders, setupUser } from "../../test/support"
import { stubEdgeFunction, stubRpc } from "../../test/msw/server"
import { makeEmployee, makeOpportunity } from "../../test/factories"
import OpportunityDetailsModal from "./OpportunityDetailsModal"

let authUser
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

/** A card read whose Odoo state is whatever the last re-check left it as. */
function stubCard(initialState) {
  const state = { odoo: initialState }
  stubRpc("sales_reference_card", () => ({
    sales_reference: "S01237",
    lock: "open",
    first_stage_name: "Lead",
    can_edit: true,
    odoo_state: state.odoo,
    checked_at: null,
    product_count: 0,
    duplicates: [],
  }))
  return state
}

function stubRecheck(card, answer) {
  const calls = []
  stubEdgeFunction("sor-sales-reference", (body) => {
    calls.push(body)
    card.odoo = answer
    return { success: true, odoo_state: answer }
  })
  return calls
}

function renderModal() {
  const owner = makeEmployee()
  authUser = { id: owner.id, isSuperAdmin: true }
  const opportunity = makeOpportunity({ registered_by: owner.id, sales_reference: "S01237" })
  renderWithProviders(<OpportunityDetailsModal isOpen onClose={() => {}} opportunity={opportunity} />)
  return opportunity
}

describe("OpportunityDetailsModal — S0 re-check on open (#817)", () => {
  beforeEach(() => {
    stubRpc("sor_can_edit_opportunity", () => true)
    stubEdgeFunction("odoo-sor-lookup", { success: false, found: false })
  })

  it("re-checks a Not checked S0 once and refreshes the card", async () => {
    const card = stubCard("not_checked")
    const calls = stubRecheck(card, "found")
    const opportunity = renderModal()

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ action: "recheck", opportunityId: opportunity.id })
    expect(await screen.findByText("In Odoo")).toBeInTheDocument()
    expect(calls).toHaveLength(1)
  })

  it("shows a red Gone from Odoo badge with the reason on hover only", async () => {
    const card = stubCard("found")
    const calls = stubRecheck(card, "gone")
    const user = setupUser()
    renderModal()

    const badge = await screen.findByText("Gone from Odoo")
    expect(calls).toHaveLength(1)
    expect(screen.queryByText("Odoo no longer has S01237.")).not.toBeInTheDocument()
    await user.hover(badge)
    expect(await screen.findByText("Odoo no longer has S01237.")).toBeInTheDocument()
  })

  it("does not re-check an S0 already marked Gone", async () => {
    const card = stubCard("gone")
    const calls = stubRecheck(card, "gone")
    renderModal()

    expect(await screen.findByText("Gone from Odoo")).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(calls).toHaveLength(0)
  })
})
