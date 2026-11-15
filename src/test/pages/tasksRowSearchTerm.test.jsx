import { screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router"

import TasksPage from "@/pages/tasks/index.jsx"
import GlobalDetailManager from "@/components/GlobalDetailManager"
import { renderWithProviders, setupUser } from "@/test/support"
import { makeCategory, makeEmployee, makeTask } from "@/test/factories"

/**
 * #1023: a row opens the task through the address, and the list's search words
 * ride in the event so the opened task still marks them.
 */

let authUser
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

describe("TasksPage — search words in the opened task", () => {
  it("marks the searched words in the task window", async () => {
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
        <GlobalDetailManager />
      </MemoryRouter>,
    )

    await user.type(await screen.findByPlaceholderText("Search tasks"), "switch")
    await user.click(await screen.findByText(/Replace the office/))

    const dialog = await screen.findByRole("dialog")
    const hit = await within(dialog).findByText("switch")
    expect(hit.className).toContain("text-amber-11")
  })
})
