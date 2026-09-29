/**
 * #406 — a ribbon move on an SOR not in the loaded register (Scratch SORs;
 * also any SOR the register page has to fetch through its `directOpportunity`
 * fallback) left the open modal showing the OLD stage: ribbon, header badge
 * and "What blocks this stage" gate all stayed put even though the move
 * succeeded and the timeline updated. A full reload showed the right state.
 *
 * Root cause: src/pages/sors/index.jsx backs that fallback with a query keyed
 * `["opportunity", id]` (singular — distinct from `["opportunities"]` and
 * `["globalOpportunity", id]`). SorModal's `invalidate()` (called from every
 * stage-move success) never named that key, so the fallback query's cached
 * row never refetched and the modal kept rendering the stale prop.
 *
 * This test reproduces the exact data-flow the register page uses — a list
 * query the moved deal is NOT part of (its Scratch flag excludes it, same as
 * `getOpportunities()` really does) plus the `["opportunity", id]` fallback —
 * without pulling in the whole 1200-line register page.
 */
import { describe, it, expect } from "vitest"
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { screen, fireEvent, waitFor } from "@testing-library/react"

import { renderWithProviders } from "../support"
import { makeEmployee, makeOpportunity } from "../factories"
import OpportunityDetailsModal from "../../components/sor/OpportunityDetailsModal"
import { opportunityService } from "../../services/opportunityService"

let authUser
import { vi } from "vitest"
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

// Mirrors src/pages/sors/index.jsx lines ~195-198 and ~520-529: a register
// list query, plus a same-shape fallback query for a selected id the list
// doesn't carry, feeding the modal's `opportunity` prop.
function RegisterLikeHarness({ dealId }) {
  const [selectedId, setSelectedId] = useState(dealId)

  const { data: opportunities = [] } = useQuery({
    queryKey: ["opportunities"],
    queryFn: () => opportunityService.getOpportunities(),
  })

  const { data: directOpportunity } = useQuery({
    queryKey: ["opportunity", selectedId],
    queryFn: () => opportunityService.getOpportunityById(selectedId),
    enabled: !!selectedId && !opportunities.some((o) => o.id === selectedId),
  })

  const selected = useMemo(() => {
    if (!selectedId) return null
    return opportunities.find((o) => o.id === selectedId) || directOpportunity || null
  }, [opportunities, selectedId, directOpportunity])

  if (!selected) return null

  return (
    <OpportunityDetailsModal
      isOpen
      onClose={() => setSelectedId(null)}
      opportunity={selected}
    />
  )
}

describe("SOR modal refresh after a ribbon move (#406)", () => {
  it("shows the new stage's gate for an SOR the register list doesn't carry, without reload", async () => {
    const owner = makeEmployee()
    authUser = { id: owner.id, isSuperAdmin: true }

    // Scratch, so getOpportunities() (which the harness's "opportunities"
    // query calls, same as the register) excludes it — same shape as the
    // real bug: the modal's data comes from the ["opportunity", id] fallback.
    const deal = makeOpportunity({
      status: "LEAD",
      sales_reference: "S94001",
      is_scratch: true,
    })

    renderWithProviders(<RegisterLikeHarness dealId={deal.id} />)

    // Old stage, gate rendered against LEAD. The modal opens on the Summary
    // (#416), so open the This stage view first.
    fireEvent.click(await screen.findByRole("button", { name: /^This stage/ }))
    expect(await screen.findByText("What blocks this stage")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Lead (current stage)" })).toBeInTheDocument()

    const moveButton = await screen.findByRole("button", { name: "Move to Proposal Submitted" })
    fireEvent.click(moveButton)

    // The ribbon's current-stage chevron must move off LEAD onto Proposal
    // Submitted without any reload/reopen — this is what stayed stuck before
    // the fix (it kept showing "Lead (current stage)").
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Proposal Submitted (current stage)" }),
      ).toBeInTheDocument()
    })
    expect(screen.queryByRole("button", { name: "Lead (current stage)" })).not.toBeInTheDocument()
  })
})
