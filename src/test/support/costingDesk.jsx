import { MemoryRouter } from "react-router"
import { expect } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"

import { renderWithProviders, setupUser } from "@/test/support"
import CostingDesk from "@/components/costing/desk/CostingDesk"

/**
 * Renders the Costing Desk (the Costing Matrix's record window body) for an SOR, in a router as the app
 * has it. Stub the matrix functions first (stubCostingMatrixRpcs).
 */
export function renderCostingDesk(opportunity) {
  renderWithProviders(
    <MemoryRouter>
      <CostingDesk opportunityId={opportunity.id} opportunity={opportunity} />
    </MemoryRouter>,
  )
  return setupUser()
}

/** The step button labelled `label` (Costs, Final Acquire, Other costs, Offers, Lines, Specs), or null when the viewer has no such step. */
function stepButton(label) {
  const steps = screen.queryByRole("list", { name: "Steps" })
  if (!steps) return null
  return within(steps).queryAllByRole("button").find((button) => new RegExp(`^\\d*${label}`).test(button.textContent.trim())) ?? null
}

/** Opens a step of the S0 Evaluation by its label, the way someone clicks it. */
export async function openStep(label) {
  await screen.findByRole("list", { name: "Steps" })
  const button = stepButton(label)
  if (!button) throw new Error(`No "${label}" step for this viewer`)
  fireEvent.click(button)
}

/** Opens the Overview (the whole sheet, the summary with Planned vs Actual, and After buying). */
export async function openOverview() {
  fireEvent.click(await screen.findByRole("button", { name: "Overview" }))
  return screen.findByTestId("costing-overview")
}

/**
 * Opens line `number` (the first by default) in its slide-over and every part in it, so a test can reach any field the way someone
 * clicking through would. A part list only exists once its line is open. The lines are listed on the line steps (Offers, Costs,
 * Final Acquire, or Lines for a viewer sent no money), so one of those is opened first when the screen is on another step.
 */
export async function openLines(number = 1) {
  await screen.findByTestId("costing-desk")
  const name = new RegExp(`^Open line ${number}:`)
  if (!screen.queryByRole("button", { name, hidden: true })) {
    await screen.findByRole("list", { name: "Steps" })
    const lineStep = ["Offers", "Costs", "Final Acquire", "Lines"].map(stepButton).find(Boolean)
    if (lineStep) fireEvent.click(lineStep)
  }
  // A line opens in the slide-over from its row; the panel sits outside the desk.
  // `hidden`: another panel (a Canvass) may be open over the desk.
  const open = screen.queryByRole("button", { name, hidden: true })
  if (open) fireEvent.click(open)
  if (open) await screen.findByTestId("tender-line")
  for (let round = 0; round < 4; round += 1) {
    const closed = [...document.querySelectorAll('[data-testid="tender-line"] [role="group"] button[aria-expanded="false"][aria-controls]')]
    if (closed.length === 0) break
    for (const button of closed) fireEvent.click(button)
  }
}

/** Shuts the line's slide-over, so the desk behind it can be reached again. */
export async function closeLine() {
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  await waitFor(() => expect(screen.queryByTestId("tender-line")).not.toBeInTheDocument())
}
