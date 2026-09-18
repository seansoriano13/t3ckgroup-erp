/**
 * ADR 0021 / #295 — the SOR chat's mention roster offers only people
 * `sor_visit_audience` names for the opportunity's current Stage Visit, not
 * every employee. This lives beside SorModal.test.jsx rather than inside it
 * because it needs its own `sor_visit_audience` RPC stub per test.
 */
import { describe, it, expect, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"

import { renderWithProviders } from "../../../test/support"
import { makeEmployee, makeOpportunity, makeSaleType, makeFlowStage, makeStageVisit } from "../../../test/factories"
import OpportunityDetailsModal from "../OpportunityDetailsModal"
import { stubRpc } from "../../../test/msw/server"
import { waitForNetworkIdle } from "../../../test/network"

let authUser
vi.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

// Wide layout, so the chat column is on screen beside the tabs rather than
// behind a "Chat" tab (SorModal — narrow layout in SorModal.test.jsx).
window.matchMedia = (query) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })

function renderModal(opportunity) {
  const owner = makeEmployee()
  authUser = { id: owner.id, isSuperAdmin: true }
  renderWithProviders(
    <OpportunityDetailsModal isOpen onClose={() => {}} opportunity={opportunity} />,
  )
}

async function openChatAndType(text) {
  // Chat sits beside the tabs at the default (wide) layout, so it is already
  // on screen once the shell renders.
  const textarea = await screen.findByPlaceholderText("Add a note — type @ to mention someone")
  fireEvent.change(textarea, { target: { value: text } })
  fireEvent.select(textarea, { target: { selectionStart: text.length } })
}

describe("SorModal — mention roster is visit-scoped", () => {
  it("offers only the employees sor_visit_audience names for the current Stage Visit", async () => {
    const saleType = makeSaleType({ name: "Flow for mention roster" })
    const stage = makeFlowStage({ name: "Lead" })
    const deal = makeOpportunity({ status: "LEAD", sale_type_id: saleType.id })
    const visit = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: stage.id })

    const inAudience = makeEmployee({ name: "Cjay Espina" })
    makeEmployee({ name: "Ana Reyes" }) // exists company-wide, but not in this visit's audience

    stubRpc("sor_visit_audience", (args) => {
      expect(args).toMatchObject({ p_opportunity_id: deal.id, p_visit_id: visit.id })
      return [inAudience.id]
    })

    renderModal(deal)
    await screen.findByText("What blocks this stage")
    await waitForNetworkIdle()

    await openChatAndType("@")

    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument())
    expect(screen.getByRole("option", { name: /Cjay Espina/ })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /Ana Reyes/ })).not.toBeInTheDocument()
  })

  it("leaves the roster as every employee for a legacy deal with no Stage Visit", async () => {
    const deal = makeOpportunity({ status: "LEAD" }) // no sale_type_id: legacy pipeline deal
    const someone = makeEmployee({ name: "Ben Cruz" })

    renderModal(deal)
    await screen.findByText("What blocks this stage")
    await waitForNetworkIdle()

    await openChatAndType("@")

    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument())
    expect(screen.getByRole("option", { name: new RegExp(someone.name) })).toBeInTheDocument()
  })
})
