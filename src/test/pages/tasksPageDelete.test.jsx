import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router"

import TasksPage from "@/pages/tasks/index.jsx"
import { renderWithProviders, setupUser } from "@/test/support"
import { makeCategory, makeEmployee, makeTask } from "@/test/factories"

/**
 * Lives under src/test/pages, not beside the page: Generouted routes every
 * file under src/pages with a hardcoded glob, so a test file left there
 * becomes a route and pulls this harness into the production bundle.
 *
 * Covers the fix for a task deleted through the page's own delete action not
 * disappearing from that same page's list without a manual reload — the
 * delete mutation used to invalidate only the dashboard's task query, never
 * the Tasks page's own list.
 */

vi.mock("@/components/ui/CustomToast", () => ({
  // The real confirmDeleteToast needs a live <Toaster/> portal to reach the
  // DOM, which nothing here mounts. Skipping straight to onConfirm tests what
  // this page is responsible for (wiring delete through to its own query),
  // not the generic confirm-toast widget itself.
  confirmDeleteToast: (_title, _description, onConfirm) => onConfirm(),
}))

let authUser
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

describe("TasksPage — delete", () => {
  it("drops a task from its own list the moment it's deleted, without a reload", async () => {
    const user = setupUser()
    const category = makeCategory({ category_id: "IT-01" })
    const owner = makeEmployee({ name: "Ana Reyes" })
    authUser = { id: owner.id, is_head: false, is_hr: false, isSuperAdmin: false }
    makeTask({
      logged_by: owner.id,
      category_id: category.category_id,
      task_description: "Replace the office switch",
    })

    renderWithProviders(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    )

    const card = await screen.findByText("Replace the office switch")
    await user.click(card)

    const deleteButton = await screen.findByRole("button", { name: /delete/i })
    await user.click(deleteButton)

    await waitFor(() =>
      expect(screen.queryByText("Replace the office switch")).not.toBeInTheDocument(),
    )
  })
})
