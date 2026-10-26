import { useState } from "react"
import { MemoryRouter } from "react-router"
import { fireEvent, screen } from "@testing-library/react"

import { renderWithProviders, setupUser } from "@/test/support"
import CostingDesk from "@/components/costing/desk/CostingDesk"
import CanvassPanel from "@/components/CanvassPanel"

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
 * Opens every line and every part of the Costing Desk, so a test can reach any field the way someone
 * clicking through would. Rows open in place; a part list only exists once its line is open.
 */
export async function openLines() {
  const desk = await screen.findByTestId("costing-desk")
  for (let round = 0; round < 4; round += 1) {
    const closed = [...desk.querySelectorAll('[role="group"] button[aria-expanded="false"][aria-controls]')]
    if (closed.length === 0) break
    for (const button of closed) fireEvent.click(button)
  }
}

/**
 * Opens a Component's Canvass the way the app does now: from a product line (#682), not from the
 * Component row, so the panel is mounted straight on the Component as its subject. With `withDesk`
 * the Costing Desk is drawn beside it, to see what the winner writes onto the row. Closing the panel
 * unmounts it, as ItemCanvass does.
 */
export function renderComponentCanvass(opportunity, component, { userId, canEdit = true, withDesk = false } = {}) {
  function Host() {
    const [open, setOpen] = useState(true)
    return (
      <>
        {withDesk && <CostingDesk opportunityId={opportunity.id} opportunity={opportunity} />}
        {open && (
          <CanvassPanel
            open
            onOpenChange={setOpen}
            subject={{ componentId: component.id }}
            subjectLabel={component.name}
            userId={userId}
            canEdit={canEdit}
            opportunityId={opportunity.id}
          />
        )}
      </>
    )
  }
  renderWithProviders(
    <MemoryRouter>
      <Host />
    </MemoryRouter>,
  )
  return setupUser()
}
