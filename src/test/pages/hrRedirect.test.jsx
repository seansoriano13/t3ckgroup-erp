import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import HrRedirect from "../../pages/hr/index";
import * as AuthContext from "../../context/AuthContext";

describe("HrRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderRedirect(user) {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user,
      isAuthLoading: false,
    });

    return render(
      <MemoryRouter initialEntries={["/hr"]}>
        <Routes>
          <Route path="/hr" element={<HrRedirect />} />
          <Route path="/hr/management" element={<div>HR Employee Directory</div>} />
          <Route path="/hr/offsets" element={<div>Offsets & Leaves</div>} />
          <Route path="/" element={<div>Dashboard Root</div>} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("redirects HR user to /hr/management", () => {
    const user = { id: "hr1", isHr: true };
    renderRedirect(user);
    expect(screen.getByText("HR Employee Directory")).toBeInTheDocument();
  });

  it("redirects Super Admin to /hr/management", () => {
    const user = { id: "sa1", isSuperAdmin: true };
    renderRedirect(user);
    expect(screen.getByText("HR Employee Directory")).toBeInTheDocument();
  });

  // Issue #101: the leave-management capability is narrower than full HR —
  // the nav already sends these users to Offsets & Leaves, and the route
  // itself admits them, so landing here should not bounce them to "/".
  it("redirects a leave manager to /hr/offsets", () => {
    const user = { id: "lm1", isHr: false, isSuperAdmin: false, canManageLeaves: true };
    renderRedirect(user);
    expect(screen.getByText("Offsets & Leaves")).toBeInTheDocument();
  });

  it("redirects unauthorized user to /", () => {
    const user = { id: "u1", isHr: false, isSuperAdmin: false };
    renderRedirect(user);
    expect(screen.getByText("Dashboard Root")).toBeInTheDocument();
  });
});
