import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../support.jsx";
import AppLayout from "../../pages/_app";
import * as AuthContext from "../../context/AuthContext";

// Issue #206 — the register joins the full-bleed routes (a board/list you pan
// or scan across), but its Commission pages stay normal, centred pages. The
// route is /sors since ADR 0024; /crm and /opportunities render redirects, not
// the register, so they are not full-bleed and are not asserted here.
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
              <Route path="/sors" element={<div>SORS Register</div>} />
              <Route path="/purchasing/order-monitoring" element={<div>Order Monitoring</div>} />
              <Route path="/purchasing/ipas" element={<div>IPAS Register</div>} />
              <Route path="/sors/commission" element={<div>Commission Dashboard</div>} />
              <Route path="/sors/commission-formula" element={<div>Commission Formula</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("gives /sors the full-bleed frame, with no centred page column", () => {
    renderAt("/sors");
    const content = screen.getByText("SORS Register");
    expect(content.closest(".wrapper")).toBeNull();
  });

  it("gives /purchasing/order-monitoring the full-bleed frame but keeps /purchasing/ipas centred", () => {
    renderAt("/purchasing/order-monitoring");
    expect(screen.getByText("Order Monitoring").closest(".wrapper")).toBeNull();
  });

  it("keeps /purchasing/ipas a normal, centred page", () => {
    renderAt("/purchasing/ipas");
    expect(screen.getByText("IPAS Register").closest(".wrapper")).not.toBeNull();
  });

  it("keeps /sors/commission a normal, centred page", () => {
    renderAt("/sors/commission");
    const content = screen.getByText("Commission Dashboard");
    expect(content.closest(".wrapper")).not.toBeNull();
  });

  it("keeps /sors/commission-formula a normal, centred page", () => {
    renderAt("/sors/commission-formula");
    const content = screen.getByText("Commission Formula");
    expect(content.closest(".wrapper")).not.toBeNull();
  });
});
