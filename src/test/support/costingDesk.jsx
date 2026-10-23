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
 * The Costing Desk with a Component's Canvass panel open beside it. The desk no longer carries a
 * Canvass button; a Canvass opens from the Canvasses page, and its panel writes through the same
 * queries the desk reads. Mounting both in one tree lets a test mark a winner in the panel and read
 * what it filled on the desk. Closing the panel unmounts it, as the page does.
 */
export function renderDeskWithCanvass(opportunity, { componentId, userId, canEdit = true, label = "Component 1.1" }) {
  function Both() {
    const [open, setOpen] = useState(true)
    return (
      <>
        <CostingDesk opportunityId={opportunity.id} opportunity={opportunity} />
        {open && (
          <CanvassPanel
            open
            onOpenChange={setOpen}
            subject={{ componentId }}
            subjectLabel={label}
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
      <Both />
    </MemoryRouter>,
  )
  return setupUser()
}
