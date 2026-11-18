import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../support.jsx";
import AppLayout from "../../pages/_app";
import { leaveCalendarFullScreen, toggleCalendarFullScreen, useCalendarFullScreen } from "../../lib/calendarFullScreen";
import * as AuthContext from "../../context/AuthContext";

// The release popup would otherwise open over the page and hide it from the queries.
vi.mock("../../components/ChangelogModal", () => ({ default: () => null }));

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

  it("keeps /purchasing/order-monitoring a normal, centred page", () => {
    renderAt("/purchasing/order-monitoring");
    expect(screen.getByText("Order Monitoring").closest(".wrapper")).not.toBeNull();
  });

  it("keeps /purchasing/ipas a normal, centred page", () => {
    renderAt("/purchasing/ipas");
    expect(screen.getByText("IPAS Register").closest(".wrapper")).not.toBeNull();
  });

  it("keeps /sors/commission a normal, centred page", () => {
    renderAt("/sors/commission");
    const content = screen.getAllByText("Commission Dashboard").find((el) => el.tagName === "DIV");
    expect(content.closest(".wrapper")).not.toBeNull();
  });

  it("keeps /sors/commission-formula a normal, centred page", () => {
    renderAt("/sors/commission-formula");
    const content = screen.getByText("Commission Formula");
    expect(content.closest(".wrapper")).not.toBeNull();
  });
});

// Calendar full screen (#1072) flips the frame to the full-bleed shape while the page is open. The page
// must stay mounted through that flip: the page's hook ends full screen when it unmounts, so a remount
// turned full screen on and straight back off, and the Full screen button did nothing.
describe("AppLayout and Calendar full screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "u1", name: "Test User" },
      isAuthLoading: false,
    });
    leaveCalendarFullScreen();
  });

  const mounts = vi.fn();

  function FakeCalendarPage() {
    const fullScreen = useCalendarFullScreen();
    useEffect(() => {
      mounts();
    }, []);
    return (
      <button type="button" onClick={toggleCalendarFullScreen}>
        {fullScreen ? "Exit full screen" : "Full screen"}
      </button>
    );
  }

  function renderCalendar() {
    return render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={["/calendar"]}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/calendar" element={<FakeCalendarPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("stays in full screen after the button is pressed, without remounting the page", async () => {
    mounts.mockClear();
    renderCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(await screen.findByRole("button", { name: "Exit full screen" })).toBeInTheDocument();
    expect(mounts).toHaveBeenCalledTimes(1);
    // and it comes back out with the same button
    fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(await screen.findByRole("button", { name: "Full screen" })).toBeInTheDocument();
    expect(mounts).toHaveBeenCalledTimes(1);
  });

  it("fills the frame in full screen, with no centred page column", () => {
    renderCalendar();
    expect(screen.getByRole("button", { name: "Full screen" }).closest(".wrapper")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.getByRole("button", { name: "Exit full screen" }).closest(".wrapper")).toBeNull();
  });
});
