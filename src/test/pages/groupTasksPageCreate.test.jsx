import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router"

import GroupTasksPage from "@/pages/group-tasks/index.jsx"
import { groupTaskService } from "@/services/groupTaskService"
import { renderWithProviders } from "@/test/support"

vi.mock("@/services/groupTaskService", () => ({
  groupTaskService: {
    getGroupTasks: vi.fn(async () => []),
    createGroupTask: vi.fn(async () => ({ id: "gt-1" })),
  },
}))

vi.mock("@/services/employeeService", () => ({
  employeeService: {
    getAllEmployees: vi.fn(async () => [
      { id: "user-9", name: "Ana Reyes", department: "Sales" },
      { id: "user-10", name: "Ben Cruz", department: "Sales" },
    ]),
  },
}))

// A department head: heads, HR and Super Admins create Group Tasks (#656).
// Ordinary employees do not get the action.
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-9", name: "Ana Reyes", is_head: true, is_hr: false, isSuperAdmin: false },
  }),
}))

describe("Group Tasks page — create action", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lets a department head create a Group Task from the page", async () => {
    renderWithProviders(
      <MemoryRouter>
        <GroupTasksPage />
      </MemoryRouter>,
    )

    const openBtn = await screen.findByRole("button", { name: /create group task/i })
    fireEvent.click(openBtn)

    const titleInput = await screen.findByPlaceholderText("Group Task Title")
    fireEvent.change(titleInput, { target: { value: "Company outing" } })

    fireEvent.click(await screen.findByText("Select Employee…"))
    fireEvent.click(await screen.findByText("Ben Cruz"))

    const descriptionInput = await screen.findByPlaceholderText(
      "What exactly are they responsible for?",
    )
    fireEvent.change(descriptionInput, { target: { value: "Book the venue" } })

    const submitButtons = screen.getAllByRole("button", { name: /create group task/i })
    fireEvent.click(submitButtons[submitButtons.length - 1])

    await waitFor(() => {
      expect(groupTaskService.createGroupTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Company outing",
          createdBy: "user-9",
        }),
      )
    })
  })
})
