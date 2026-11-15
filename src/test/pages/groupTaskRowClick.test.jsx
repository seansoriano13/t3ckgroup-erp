import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"

import GroupTasksPage from "@/pages/group-tasks/index.jsx"
import { renderWithProviders, setupUser } from "@/test/support"

const task = {
  id: "gt-1",
  title: "Q1 Server Migration",
  description: "Migrate servers",
  status: "ACTIVE",
  created_by: "user-9",
  creator: { name: "Ana Reyes" },
  due_date: "2026-04-15T00:00:00Z",
  created_at: "2026-03-01T00:00:00Z",
  members: [
    {
      id: "m1",
      employee_id: "emp-2",
      employee: { id: "emp-2", name: "Ben Cruz" },
      status: "DONE",
      task_description: "Do the thing",
      checklist: null,
      grade: 0,
    },
  ],
}

vi.mock("@/services/groupTaskService", () => ({
  groupTaskService: { getGroupTasks: vi.fn(async () => [task]) },
}))

vi.mock("@/services/employeeService", () => ({
  employeeService: { getAllEmployees: vi.fn(async () => []) },
}))

// Creator of the task, but not a head, HR or super admin.
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-9", name: "Ana Reyes", is_head: false, is_hr: false, isSuperAdmin: false },
  }),
}))

describe("Group Tasks page — row click", () => {
  beforeEach(() => vi.clearAllMocks())

  it("opens the task through the address handler instead of its own window", async () => {
    const user = setupUser()
    const seen = []
    const listener = (e) => seen.push(e.detail)
    window.addEventListener("OPEN_ENTITY_DETAILS", listener)
    renderWithProviders(
      <MemoryRouter>
        <GroupTasksPage />
      </MemoryRouter>,
    )

    await user.click(await screen.findByText("Q1 Server Migration"))

    await waitFor(() => expect(seen).toEqual([{ id: "gt-1", type: "GROUP_TASK" }]))
    window.removeEventListener("OPEN_ENTITY_DETAILS", listener)
    expect(screen.queryByText("Rate Group Members")).not.toBeInTheDocument()
  })
})
