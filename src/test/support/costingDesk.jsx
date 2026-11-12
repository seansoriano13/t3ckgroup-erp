import { MemoryRouter } from "react-router"
import { expect } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"

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

/**
 * Opens line `number` (the first by default) in its slide-over and every part in it, so a test can reach any field the way someone
 * clicking through would. A part list only exists once its line is open.
 */
export async function openLines(number = 1) {
  await screen.findByTestId("costing-desk")
  // A line opens in the slide-over from its row in the sheet; the panel sits outside the desk.
  // `hidden`: another panel (a Canvass) may be open over the desk.
  const open = screen.queryByRole("button", { name: new RegExp(`^Open line ${number}:`), hidden: true })
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
