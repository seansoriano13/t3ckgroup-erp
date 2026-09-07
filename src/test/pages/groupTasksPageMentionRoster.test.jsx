import { describe, it, expect, vi, beforeEach } from "vitest"
import { waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"

import GroupTasksPage from "@/pages/group-tasks/index.jsx"
import { employeeService } from "@/services/employeeService"
import { renderWithProviders } from "@/test/support"

// Asserts on the roster fetch rather than on what the detail modal receives,
// because naming that modal means naming the directory it lives in — and that
// directory is spelled differently on either side of the staging merge. The
// fetch is the thing the fix changed; the prop is one hop downstream of it.
vi.mock("@/services/groupTaskService", () => ({
  groupTaskService: { getGroupTasks: vi.fn(async () => []) },
}))

vi.mock("@/services/employeeService", () => ({
  employeeService: { getAllEmployees: vi.fn(async () => []) },
}))

// No head, no HR, no super admin. A fixture with any of those set would pass
// against the bug this test exists to catch.
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-9", name: "Ana Reyes", is_head: false, is_hr: false, isSuperAdmin: false },
  }),
}))

describe("Group Tasks page — mention roster", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("gives a non-manager the roster the mention picker needs", async () => {
    renderWithProviders(
      <MemoryRouter>
        <GroupTasksPage />
      </MemoryRouter>,
    )

    // Gated on `canManage`, this never ran for a normal employee and left the
    // picker with an empty list and an `@` that silently matched nobody.
    await waitFor(() => {
      expect(employeeService.getAllEmployees).toHaveBeenCalled()
    })
  })
})
