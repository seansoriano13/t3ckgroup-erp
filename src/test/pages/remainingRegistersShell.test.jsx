import { screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router"

import GroupTaskTemplatesPage from "@/pages/group-tasks/templates/index.jsx"
import SuperAdminActivityLogPage from "@/pages/super-admin/activity-log/index.jsx"
import { renderWithProviders, setupUser } from "@/test/support"

/**
 * Task Templates and Activity Log as Register pages (#438): tables instead of
 * stacked cards, underlined level-1 tabs, main action in the header, and the
 * Activity Log's one-line FilterBar with working pagination. HR Employees and
 * My Requests are covered by hrManagement.test.jsx and offsets.test.jsx.
 */

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Ana", is_head: true, isSuperAdmin: true, is_super_admin: true, is_hr: true },
  }),
}))

const templates = [
  { id: "t1", name: "Site survey crew", members: [{}, {}], archived_at: null },
  { id: "t2", name: "Install crew", members: [{}], archived_at: null },
]
vi.mock("@/services/groupTaskTemplateService", () => ({
  groupTaskTemplateService: {
    getTemplates: vi.fn(async () => templates),
    getUsageStats: vi.fn(async () => ({ t1: { count: 3, lastUsedAt: "2026-08-01T00:00:00Z" } })),
  },
}))

vi.mock("@/services/employeeService", () => ({
  employeeService: { getAllEmployees: vi.fn(async () => []) },
}))

const logEntry = (n) => ({
  id: `log-${n}`,
  taskId: `task-${n}`,
  taskDescription: `Task number ${n}`,
  taskStatus: "INCOMPLETE",
  type: "COMMENT",
  content: `Entry ${n}`,
  metadata: {},
  createdAt: "2026-08-20T09:00:00Z",
  authorId: "u1",
  authorName: "Ana",
})
const fullPage = Array.from({ length: 50 }, (_, i) => logEntry(i))

vi.mock("@/services/tasks/taskActivityService", () => ({
  taskActivityService: {
    getRecentTaskActivity: vi.fn(async ({ offset }) => (offset === 0 ? fullPage : [logEntry(99)])),
    subscribeToAllActivity: vi.fn(() => ({})),
    unsubscribeFromActivity: vi.fn(),
  },
}))
vi.mock("@/services/groupTaskActivityService", () => ({
  groupTaskActivityService: {
    getRecentGroupActivity: vi.fn(async () => []),
    subscribeToAllActivity: vi.fn(() => ({})),
    unsubscribeFromActivity: vi.fn(),
  },
}))
vi.mock("@/services/systemAuditLogService", () => ({
  HR_ENTITY_TYPES: [],
  systemAuditLogService: {
    getRecentSystemActivity: vi.fn(async () => []),
    getRecentHrActivity: vi.fn(async () => []),
    subscribeToAllActivity: vi.fn(() => ({})),
    unsubscribeFromActivity: vi.fn(),
  },
}))
vi.mock("@/services/opportunityService", () => ({
  opportunityService: { getOpportunities: vi.fn(async () => []) },
}))

const inPage = (name) => screen.findByRole("button", { name, hidden: true })

describe("Task Templates on PageShell", () => {
  beforeEach(() => localStorage.clear())

  it("lists templates in a table with the main action in the header", async () => {
    renderWithProviders(<MemoryRouter><GroupTaskTemplatesPage /></MemoryRouter>)

    const table = await screen.findByRole("table")
    expect(within(table).getByText("Site survey crew")).toBeInTheDocument()
    expect(within(table).getByText(/Used 3 times/)).toBeInTheDocument()
    expect(within(table).getByText("Never used")).toBeInTheDocument()

    const header = screen.getByRole("heading", { name: /group\s*task\s*templates/i }).closest("div").parentElement
    expect(header).toContainElement(await inPage(/new template/i))
  })

  it("switches Active / Archived on underlined tabs", async () => {
    renderWithProviders(<MemoryRouter><GroupTaskTemplatesPage /></MemoryRouter>)

    const active = await screen.findByRole("tab", { name: "Active" })
    expect(active).toHaveAttribute("aria-selected", "true")
    expect(active.className).toContain("border-b-2")
    expect(screen.getByRole("tab", { name: "Archived" })).toBeInTheDocument()
  })
})

describe("Activity Log on PageShell", () => {
  beforeEach(() => localStorage.clear())

  it("shows entries in a table under underlined log-type tabs", async () => {
    renderWithProviders(<SuperAdminActivityLogPage />)

    const table = await screen.findByRole("table")
    expect(within(table).getByText("Task number 3")).toBeInTheDocument()
    expect(within(table).getByRole("columnheader", { name: "By" })).toBeInTheDocument()

    const tasksTab = screen.getByRole("tab", { name: "Task Logs" })
    expect(tasksTab).toHaveAttribute("aria-selected", "true")
    expect(tasksTab.className).toContain("border-b-2")
    for (const name of ["Group Task Logs", "SOR Logs", "System Logs", "HR Logs"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument()
    }
  })

  it("filters on one line: no filter card, and Filters counts what it holds", async () => {
    const user = setupUser()
    renderWithProviders(<SuperAdminActivityLogPage />)

    expect(await inPage("Filters")).toBeInTheDocument()
    expect(await screen.findByRole("textbox", { name: /search content/i })).toBeInTheDocument()

    await user.click(await inPage("Filters"))
    const from = await screen.findByLabelText("Date from")
    await user.type(from, "2026-08-01")

    expect(await inPage(/^Filterss*1$/)).toBeInTheDocument()
  })

  it("pages through older entries", async () => {
    const user = setupUser()
    const { taskActivityService } = await import("@/services/tasks/taskActivityService")
    renderWithProviders(<SuperAdminActivityLogPage />)

    await screen.findByRole("table")
    const older = screen.getByRole("button", { name: /older/i })
    expect(screen.getByRole("button", { name: /newer/i })).toBeDisabled()

    await user.click(older)

    await waitFor(() => expect(screen.getByText("Task number 99")).toBeInTheDocument())
    expect(taskActivityService.getRecentTaskActivity).toHaveBeenCalledWith(expect.objectContaining({ offset: 50 }))
    expect(screen.getByRole("button", { name: /older/i })).toBeDisabled()
    expect(screen.getByText("Page 2")).toBeInTheDocument()
  })

  it("keeps the HR Logs tab, with its own one-line filter row", async () => {
    const user = setupUser()
    renderWithProviders(<SuperAdminActivityLogPage />)

    await user.click(await screen.findByRole("tab", { name: "HR Logs" }))
    expect(await screen.findByText("No HR activity found")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: /search log content/i })).toBeInTheDocument()
  })
})
