import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router"

import GroupTasksPage from "@/pages/group-tasks/index.jsx"
import { renderWithProviders } from "@/test/support"
import { makeEmployee, makeGroupTask } from "@/test/factories"

let authUser
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

// Capture what the page hands the detail modal: the mention picker's `people`
// comes straight off this prop, so an empty array is the bug's exact symptom.
let seenEmployees = null
vi.mock("@/pages/group-tasks/_components/GroupTaskDetailModal", () => ({
  default: ({ employees }) => {
    seenEmployees = employees
    return null
  },
}))

describe("Group Tasks — mentions for a normal employee", () => {
  it("gives a non-manager the roster the mention picker needs", async () => {
    const member = makeEmployee({ name: "Ana Reyes", is_head: false, is_super_admin: false })
    makeEmployee({ name: "Cjay Es" })
    authUser = { id: member.id, is_head: false, is_hr: false, isSuperAdmin: false }
    makeGroupTask({ created_by: member.id, title: "Q1 Server Migration" })

    renderWithProviders(
      <MemoryRouter>
        <GroupTasksPage />
      </MemoryRouter>,
    )

    await screen.findByText("Q1 Server Migration")
    await waitFor(() => {
      expect(seenEmployees?.map((e) => e.name)).toContain("Cjay Es")
    })
  })
})
