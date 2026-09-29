import { screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router"

import TasksPage from "@/pages/tasks/index.jsx"
import { renderWithProviders, setupUser } from "@/test/support"
import { makeEmployee, makeHead, makeHrEmployee } from "@/test/factories"

/**
 * "Save filters as default" on the Tasks page: the control's three states
 * (nothing saved, saved, changed since saving) and a clear that works from
 * both saved states. Same seam as tasksPageDelete.test.jsx.
 */

let authUser
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

const control = (name) => screen.findByRole("button", { name, hidden: true })
const queryControl = (name) => screen.queryByRole("button", { name, hidden: true })

function renderPage() {
  return renderWithProviders(
    <MemoryRouter>
      <TasksPage />
    </MemoryRouter>,
  )
}

describe("TasksPage — saved default filters", () => {
  beforeEach(() => {
    localStorage.clear()
    const me = makeEmployee({ name: "Ana Reyes", department: "IT" })
    authUser = { id: me.id, department: "IT", is_head: false, is_hr: false, isSuperAdmin: false }
  })

  it("saves the current filters, then clears them from the saved chip", async () => {
    const user = setupUser()

    const first = renderPage()
    await user.click(await control("Save filters as default"))
    expect(screen.getByText("Default saved")).toBeInTheDocument()

    await user.click(await control("Clear saved default filters"))
    expect(await control("Save filters as default")).toBeInTheDocument()
    first.unmount()

    // Cleared for the next visit too.
    renderPage()
    expect(await control("Save filters as default")).toBeInTheDocument()
  })

  it("offers Update default only after a real change, and clears from there too", async () => {
    const user = setupUser()
    renderPage()
    await user.click(await control("Save filters as default"))
    expect(queryControl("Update default")).not.toBeInTheDocument()

    await user.click(await control("SORS"))
    expect(await control("Update default")).toBeInTheDocument()

    // Changing it back is no change at all.
    await user.click(await control("SORS"))
    expect(queryControl("Update default")).not.toBeInTheDocument()
    expect(screen.getByText("Default saved")).toBeInTheDocument()

    await user.click(await control("SORS"))
    await user.click(await control("Clear saved default filters"))
    expect(await control("Save filters as default")).toBeInTheDocument()
  })

  it("reads a head's saved default back on the next visit without calling it changed", async () => {
    const head = makeHead({ name: "Head Ito", department: "IT" })
    authUser = { id: head.id, department: "IT", is_head: true, is_hr: false, isSuperAdmin: false }
    const user = setupUser()
    const first = renderPage()
    await user.click(await control("SORS"))
    await user.click(await control("Save filters as default"))
    first.unmount()

    renderPage()

    expect(await screen.findByText("Default saved")).toBeInTheDocument()
    expect(queryControl("Update default")).not.toBeInTheDocument()
  })

  it("restores the department HR saved, rather than calling it changed on the next visit", async () => {
    const hr = makeHrEmployee({ name: "Hera HR", department: "HR" })
    authUser = { id: hr.id, department: "HR", is_head: false, is_hr: true, isSuperAdmin: false }
    localStorage.setItem(`erp_saved_filters_tasks_${hr.id}`, JSON.stringify({ deptFilter: "IT" }))
    renderPage()

    expect(await screen.findByText("Default saved")).toBeInTheDocument()
    expect(queryControl("Update default")).not.toBeInTheDocument()
  })

  it("does not call a default saved before every filter was remembered changed", async () => {
    // The shape stored before the page saved its whole filter set.
    localStorage.setItem(`erp_saved_filters_tasks_${authUser.id}`, JSON.stringify({ crmOnly: true }))
    renderPage()

    expect(await screen.findByText("Default saved")).toBeInTheDocument()
    expect(queryControl("Update default")).not.toBeInTheDocument()
  })
})
