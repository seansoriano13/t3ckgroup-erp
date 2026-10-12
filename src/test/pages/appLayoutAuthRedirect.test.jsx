import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../support.jsx";
import AppLayout from "../../pages/_app";
import { useLocation } from "react-router";
import * as AuthContext from "../../context/AuthContext";

// Stands in for the login screen and reports the origin it was handed, so the
// assertion is on the value the real login screen reads back.
function OriginProbe() {
  const location = useLocation();
  return <div data-testid="origin">{location.state?.from ?? "none"}</div>;
}

// Every page hangs off _app.jsx, so the logged-out guard belongs here rather
// than in each page's own ProtectedRoute — pages that forget to wrap
// themselves (tasks, group-tasks, profile, settings) used to render a blank
// shell instead of bouncing to /login.
describe("AppLayout auth redirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderAt(path, auth) {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue(auth);

    return render(
      <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/tasks" element={<div>Tasks Page</div>} />
            <Route path="/login" element={<div>Login Screen</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("sends a logged-out visitor from a deep route to /login", () => {
    renderAt("/tasks", { user: null, isAuthLoading: false });
    expect(screen.getByText("Login Screen")).toBeInTheDocument();
    expect(screen.queryByText("Tasks Page")).not.toBeInTheDocument();
  });

  it("hands the login screen the route it turned the visitor away from", () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: null,
      isAuthLoading: false,
    });

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={["/tasks?status=pending"]}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/tasks" element={<div>Tasks Page</div>} />
              <Route path="/login" element={<OriginProbe />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByTestId("origin")).toHaveTextContent("/tasks?status=pending");
  });

  it("leaves /login alone when logged out", () => {
    renderAt("/login", { user: null, isAuthLoading: false });
    expect(screen.getByText("Login Screen")).toBeInTheDocument();
  });

  it("does not redirect while the session is still resolving", () => {
    renderAt("/tasks", { user: null, isAuthLoading: true });
    expect(screen.queryByText("Login Screen")).not.toBeInTheDocument();
    expect(screen.getByText(/Loading portal/i)).toBeInTheDocument();
  });

  it("renders the page for a logged-in visitor", () => {
    renderAt("/tasks", { user: { id: "u1", email: "a@b.c" }, isAuthLoading: false });
    expect(screen.getByText("Tasks Page")).toBeInTheDocument();
  });
});
