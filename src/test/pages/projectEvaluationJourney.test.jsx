import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import ProjectEvaluationPanel from "@/components/sor/ProjectEvaluationPanel"
import InclusionsPanel from "@/components/sor/InclusionsPanel"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { renderWithProviders } from "@/test/support"

/**
 * Issue #48's own end-to-end journey: a salesperson creates a Project
 * Evaluation on an unbound SOR, enters an Inclusion, and sees the
 * completeness summary and the margin — the two panels as they sit together
 * in the real SOR detail view (OpportunityDetailsModal), driven through the
 * real services against the fake database.
 *
 * Lives under src/test/pages rather than beside either component, matching
 * the approvals queue's own worked example (approvalSplitView.test.jsx):
 * this journey spans two modules, and no single module owns it.
 */

const mockUser = vi.hoisted(() => ({ current: null }))
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser.current }) }))

function Screen({ opportunity }) {
  return (
    <div>
      <ProjectEvaluationPanel opportunity={opportunity} isRequired={true} />
      <InclusionsPanel opportunity={opportunity} isRequired={true} />
    </div>
  )
}

describe("Project Evaluation journey", () => {
  it("creates an evaluation, enters an Inclusion, and shows completeness and margin", async () => {
    const salesperson = makeEmployee({ name: "Ana Reyes" })
    const opportunity = makeOpportunity({
      registered_by: salesperson.id,
      client_name: "Brgy. Wack-Wack",
    })
    mockUser.current = { id: salesperson.id, name: salesperson.name }

    const user = userEvent.setup()
    renderWithProviders(<Screen opportunity={opportunity} />)

    // Unbound: no Sales Reference exists yet.
    expect(await screen.findByText(/estimate — no sales reference yet/i)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /start a project evaluation/i }))

    const priceField = await screen.findByLabelText(/candidate sales price/i)
    await user.type(priceField, "1000000")
    await user.tab()

    const opexField = await screen.findByLabelText(/estimated operating expense/i)
    await user.type(opexField, "50000")
    await user.tab()

    // Margin reflects the candidate price and opex before any Inclusion has
    // a cost — base cost is zero-contribution because nothing is costed yet.
    await waitFor(() => expect(screen.getByText("₱950,000")).toBeInTheDocument())

    // Now walk the client's spec sheet.
    await user.click(screen.getByRole("button", { name: /add inclusion/i }))
    await user.type(screen.getByPlaceholderText(/what the client asked for/i), "Boom Lift 12m")
    await user.click(screen.getByRole("button", { name: /^add$/i }))

    await waitFor(() => expect(screen.getByText("0/1 answered")).toBeInTheDocument())

    // Base cost has nothing to roll up yet — an honest "No cost yet," not ₱0.
    // Two legitimate occurrences: the evaluation's aggregate base cost, and
    // the one Inclusion's own cost line.
    await waitFor(() => expect(screen.getAllByText("No cost yet").length).toBeGreaterThanOrEqual(1))
  })
})
