import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import HrRedirect from "./index";
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

  it("redirects unauthorized user to /", () => {
    const user = { id: "u1", isHr: false, isSuperAdmin: false };
    renderRedirect(user);
    expect(screen.getByText("Dashboard Root")).toBeInTheDocument();
  });
});
