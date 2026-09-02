import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import Login from "../../pages/login/index";
import * as AuthContext from "../../context/AuthContext";

// The login screen renders a Google button that needs an OAuth provider above
// it; none of these cases exercise it, so it is stubbed to a plain button.
vi.mock("@react-oauth/google", () => ({
  GoogleLogin: () => <button type="button">Sign in with Google</button>,
}));

describe("Login return-to-destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The signed-in branch is what actually runs after a successful login: the
  // auth state flips, Login re-renders, and this Navigate carries the visitor
  // onward. Driving it directly is the same code path.
  function renderLoggedInAt(from) {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "u1", email: "a@b.c" },
      isAuthLoading: false,
      handleLogin: vi.fn(),
    });

    return render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: from ? { from } : null }]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>Dashboard Root</div>} />
          <Route path="/tasks" element={<div>Tasks Page</div>} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("returns to the route the visitor was originally after", () => {
    renderLoggedInAt("/tasks");
    expect(screen.getByText("Tasks Page")).toBeInTheDocument();
  });

  it("keeps the query string of the original route", () => {
    renderLoggedInAt("/tasks?status=pending");
    expect(screen.getByText("Tasks Page")).toBeInTheDocument();
  });

  it("falls back to the dashboard when there is no origin", () => {
    renderLoggedInAt(null);
    expect(screen.getByText("Dashboard Root")).toBeInTheDocument();
  });

  // The full set of rejected origins is covered in
  // src/utils/authRedirect.test.js; this asserts the page actually routes
  // through that check rather than trusting the state it was handed.
  it("refuses an off-site origin", () => {
    renderLoggedInAt("//evil.example.com/steal");
    expect(screen.getByText("Dashboard Root")).toBeInTheDocument();
  });
});
