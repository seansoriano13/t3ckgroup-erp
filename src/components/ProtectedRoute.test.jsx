import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router"
import ProtectedRoute from "./ProtectedRoute"
import * as AuthContext from "../context/AuthContext"

/**
 * The gate a direct URL has to pass even when the nav link is already
 * hidden. `allowLeaveManagers` is the one case where requireHr's usual
 * "HR or Super Admin" bar is deliberately widened for a narrower capability.
 * A signed-in person who is blocked sees a No access screen (#1010), not the
 * Dashboard; a signed-out visitor still goes to sign in.
 */
describe("ProtectedRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderGuarded(user, props = {}) {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({ user, isAuthLoading: false })

    return render(
      <MemoryRouter initialEntries={["/guarded"]}>
        <Routes>
          <Route
            path="/guarded"
            element={
              <ProtectedRoute requireHr {...props}>
                <div>Guarded Content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<div>Dashboard Root</div>} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>,
    )
  }

  function expectNoAccess() {
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument()
    expect(screen.queryByText("Dashboard Root")).not.toBeInTheDocument()
    expect(screen.queryByText("Guarded Content")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute("href", "/")
  }

  it("admits a leave-management capability holder when the route opts in", () => {
    renderGuarded({ id: "lm-1", canManageLeaves: true }, { allowLeaveManagers: true })

    expect(screen.getByText("Guarded Content")).toBeInTheDocument()
  })

  it("still blocks a capability holder from a route that has not opted in", () => {
    renderGuarded({ id: "lm-1", canManageLeaves: true })

    expectNoAccess()
  })

  it("blocks an employee with neither HR nor the capability, even on an opted-in route", () => {
    renderGuarded({ id: "std-1" }, { allowLeaveManagers: true })

    expectNoAccess()
  })

  it("says which access the page needs and who grants it", () => {
    renderGuarded({ id: "std-1" })

    expect(screen.getByText(/needs HR access/)).toBeInTheDocument()
    expect(screen.getByText(/Ask HR or a Super Admin/)).toBeInTheDocument()
  })

  it("still sends a signed-out visitor to sign in", () => {
    renderGuarded(null)

    expect(screen.getByText("Login Page")).toBeInTheDocument()
  })

  it("still admits a full HR user with allowLeaveManagers set", () => {
    renderGuarded({ id: "hr-1", isHr: true }, { allowLeaveManagers: true })

    expect(screen.getByText("Guarded Content")).toBeInTheDocument()
  })

  it("still admits Super Admin regardless of the capability flag", () => {
    renderGuarded({ id: "sa-1", isSuperAdmin: true }, { allowLeaveManagers: true })

    expect(screen.getByText("Guarded Content")).toBeInTheDocument()
  })
})
