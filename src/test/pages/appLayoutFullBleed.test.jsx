import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../support.jsx";
import AppLayout from "../../pages/_app";
import * as AuthContext from "../../context/AuthContext";

// Issue #206 — /crm joins the full-bleed routes (a board/list you pan or scan
// across), but its Commission pages stay normal, centred pages.
describe("AppLayout full-bleed routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "u1", name: "Test User" },
      isAuthLoading: false,
    });
  });

  function renderAt(path) {
    return render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/crm" element={<div>CRM Register</div>} />
              <Route path="/crm/commission" element={<div>Commission Dashboard</div>} />
              <Route path="/crm/commission-formula" element={<div>Commission Formula</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("gives /crm the full-bleed frame, with no centred page column", () => {
    renderAt("/crm");
    const content = screen.getByText("CRM Register");
    expect(content.closest(".wrapper")).toBeNull();
  });

  it("keeps /crm/commission a normal, centred page", () => {
    renderAt("/crm/commission");
    const content = screen.getByText("Commission Dashboard");
    expect(content.closest(".wrapper")).not.toBeNull();
  });

  it("keeps /crm/commission-formula a normal, centred page", () => {
    renderAt("/crm/commission-formula");
    const content = screen.getByText("Commission Formula");
    expect(content.closest(".wrapper")).not.toBeNull();
  });
});
