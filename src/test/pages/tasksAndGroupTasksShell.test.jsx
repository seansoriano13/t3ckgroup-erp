import { screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router"

import TasksPage from "@/pages/tasks/index.jsx"
import GroupTasksPage from "@/pages/group-tasks/index.jsx"
import { renderWithProviders, setupUser } from "@/test/support"
import { makeCategory, makeEmployee, makeTask } from "@/test/factories"

/**
 * All Tasks and Group Tasks as Register pages (#436): table by default with a
 * Grid toggle, one-line FilterBar with a Filters count, main action in the
 * header. Same seam as tasksPageSavedDefault.test.jsx.
 */

let authUser
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

vi.mock("@/services/groupTaskService", () => ({
  groupTaskService: { getGroupTasks: vi.fn(async () => []) },
}))

const inPage = (name) => screen.findByRole("button", { name, hidden: true })

describe("Tasks page on PageShell", () => {
  beforeEach(() => {
    localStorage.clear()
    const me = makeEmployee({ name: "Ana Reyes", department: "IT" })
    const category = makeCategory({ category_id: "IT-01" })
    makeTask({ logged_by: me.id, category_id: category.category_id, task_description: "Replace the switch" })
    authUser = { id: me.id, department: "IT", is_head: false, is_hr: false, isSuperAdmin: false }
  })

  it("opens as a table, with the card grid one toggle away", async () => {
    const user = setupUser()
    renderWithProviders(<MemoryRouter><TasksPage /></MemoryRouter>)

    expect(await screen.findByRole("table")).toBeInTheDocument()
    expect(screen.getByText("Replace the switch")).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: /grid/i }))
    await waitFor(() => expect(screen.queryByRole("table")).not.toBeInTheDocument())
    expect(screen.getByText("Replace the switch")).toBeInTheDocument()
  })

  it("filters on one line: no filter card, and Filters counts what it holds", async () => {
    const user = setupUser()
    renderWithProviders(<MemoryRouter><TasksPage /></MemoryRouter>)

    expect(await inPage("Filters")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /add filter/i })).not.toBeInTheDocument()

    await user.click(await inPage("Filters"))
    await user.click(await inPage("SORs only"))

    expect(await inPage(/^Filterss*1$/)).toBeInTheDocument()
  })
})

describe("Tasks page HR landing", () => {
  beforeEach(() => {
    localStorage.clear()
    const hr = makeEmployee({ name: "Hana HR", department: "HR" })
    authUser = { id: hr.id, department: "HR", is_head: false, is_hr: true, isSuperAdmin: false }
  })

  it("opens HR on My Tasks, also when a saved default holds an empty employee scope", async () => {
    localStorage.setItem(`erp_saved_filters_tasks_${authUser.id}`, JSON.stringify({ employeeFilter: null }))
    renderWithProviders(<MemoryRouter><TasksPage /></MemoryRouter>)

    expect(await screen.findByRole("tab", { name: "My Tasks", selected: true })).toBeInTheDocument()
  })
})

describe("Group Tasks page on PageShell", () => {
  beforeEach(() => {
    localStorage.clear()
    authUser = { id: "user-9", name: "Ana Reyes", is_head: true, is_hr: false, isSuperAdmin: false }
  })

  it("puts the main action in the header and keeps the one-line filter bar", async () => {
    renderWithProviders(<MemoryRouter><GroupTasksPage /></MemoryRouter>)

    const header = (await screen.findByRole("heading", { name: /group\s*tasks/i })).closest("div").parentElement
    expect(header).toContainElement(await inPage(/create group task/i))
    expect(await inPage("Filters")).toBeInTheDocument()
    expect(await screen.findByRole("textbox", { name: /search group tasks/i })).toBeInTheDocument()
  })
})
