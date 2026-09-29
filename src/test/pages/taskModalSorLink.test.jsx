import { fireEvent, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import TaskDetails from "@/components/TaskDetails"
import GroupTaskDetailModal from "@/pages/group-tasks/_components/GroupTaskDetailModal"
import { renderWithProviders } from "@/test/support"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubRpc } from "@/test/msw/server"

let authUser
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

/**
 * Issue #199 — a task a Stage Action created links back to its SOR in both
 * task modals, labelled from the SOR itself. The tasks below are shaped like
 * a list read: they carry the SOR id and no embedded SOR.
 */
describe("the SOR link on task modals", () => {
  let opened
  const onOpen = (e) => opened.push(e.detail)

  beforeEach(() => {
    opened = []
    window.addEventListener("OPEN_ENTITY_DETAILS", onOpen)
    const me = makeEmployee({ name: "Ana Reyes" })
    authUser = { id: me.id, name: me.name, isSuperAdmin: true }
  })
  afterEach(() => window.removeEventListener("OPEN_ENTITY_DETAILS", onOpen))

  it("links an individual task to its SOR by Sales Reference, and opens Quick View in place of the task", async () => {
    const sor = makeOpportunity({ sales_reference: "S04521", client_name: "Quezon City Hall" })
    stubRpc("sor_link_label", () => sor.sales_reference || sor.client_name)
    const onClose = vi.fn()
    renderWithProviders(
      <TaskDetails
        isOpen
        onClose={onClose}
        task={{
          id: "task-1",
          taskDescription: "Confirm requirements",
          loggedById: authUser.id,
          status: "INCOMPLETE",
          priority: "MEDIUM",
          attachments: [],
          opportunityId: sor.id,
        }}
        onUpdateTask={vi.fn()}
        onDeleteTask={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole("button", { name: /S04521/ }))

    expect(onClose).toHaveBeenCalled()
    expect(opened).toEqual([{ id: sor.id, type: "OPPORTUNITY_QUICK_VIEW" }])
  })

  it("links a Group Task to its SOR by Company when it has no Sales Reference", async () => {
    const sor = makeOpportunity({ sales_reference: null, client_name: "Pasig City Hall" })
    stubRpc("sor_link_label", () => sor.sales_reference || sor.client_name)
    const onClose = vi.fn()
    renderWithProviders(
      <GroupTaskDetailModal
        isOpen
        onClose={onClose}
        currentUserId={authUser.id}
        task={{
          id: "gt-1",
          title: "Kickoff",
          description: "",
          status: "ACTIVE",
          created_by: authUser.id,
          members: [],
          opportunity_id: sor.id,
        }}
      />,
    )

    fireEvent.click(await screen.findByRole("button", { name: /Deal: Pasig City Hall/ }))

    expect(onClose).toHaveBeenCalled()
    expect(opened).toEqual([{ id: sor.id, type: "OPPORTUNITY_QUICK_VIEW" }])
  })
})
