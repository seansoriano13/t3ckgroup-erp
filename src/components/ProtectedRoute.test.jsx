import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router"
import ProtectedRoute from "./ProtectedRoute"
import * as AuthContext from "../context/AuthContext"

/**
 * The gate a direct URL has to pass even when the nav link is already
 * hidden. `allowLeaveManagers` is the one case where requireHr's usual
 * "HR or Super Admin" bar is deliberately widened for a narrower capability.
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
        </Routes>
      </MemoryRouter>,
    )
  }

  it("admits a leave-management capability holder when the route opts in", () => {
    renderGuarded({ id: "lm-1", canManageLeaves: true }, { allowLeaveManagers: true })

    expect(screen.getByText("Guarded Content")).toBeInTheDocument()
  })

  it("still blocks a capability holder from a route that has not opted in", () => {
    renderGuarded({ id: "lm-1", canManageLeaves: true })

    expect(screen.getByText("Dashboard Root")).toBeInTheDocument()
  })

  it("blocks an employee with neither HR nor the capability, even on an opted-in route", () => {
    renderGuarded({ id: "std-1" }, { allowLeaveManagers: true })

    expect(screen.getByText("Dashboard Root")).toBeInTheDocument()
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
