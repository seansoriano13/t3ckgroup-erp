import { screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PurchasingDashboardPage from "@/pages/purchasing/dashboard/index";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { stubRpc } from "@/test/msw/server";
import { NAV_MODULES } from "@/constants/navigation";
import { getPermissionContext } from "@/utils/permissions";

/**
 * The Purchasing Dashboard (#322): the five groups with counts, one SOR shown
 * in every group it has work in, each record opening the place that owns it.
 * The grouping rules are the database's and purchasingDashboard.js's.
 */

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/services/orderMonitoringService", () => ({
  orderMonitoringService: { list: async () => [{ id: "ip-late", late: true }, { id: "ip-fine", late: false }] },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false, logout: vi.fn() }),
}));

const row = (over) => ({
  opportunity_id: "sor-1",
  sales_reference: "S07983",
  project_title: "Ambulance",
  target_label: null,
  no_canvass_count: 0,
  buyer_id: null,
  canvasser_id: null,
  since: new Date().toISOString(),
  request_id: null,
  ...over,
});

const ROWS = [
  row({ grp: "to_source", target_kind: "purchase_request", target_id: "pr-1", request_id: "pr-1", item_count: 4, target_label: "Ambulance kit" }),
  row({ grp: "to_price", target_kind: "costing_matrix", target_id: "sor-1", item_count: 1 }),
  row({ grp: "on_order", target_kind: "purchase_request", target_id: "pr-1", request_id: "pr-1", item_count: 2, no_canvass_count: 1 }),
  row({ grp: "to_check", target_kind: "transmittal", target_id: "tr-1", target_label: "TG03-12", item_count: 1 }),
];

function Where() {
  const location = useLocation();
  return <p>At {location.pathname}{location.search}</p>;
}

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/purchasing/dashboard"]}>
      <Routes>
        <Route path="/purchasing/dashboard" element={<PurchasingDashboardPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

describe("Purchasing Dashboard page", () => {
  beforeEach(() => {
    mockUser.current = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    stubRpc("purchasing_dashboard_rows", () => ROWS);
  });

  it("opens an order on its IPAS and narrows to IPAS late by the ageing rules", async () => {
    stubRpc("purchasing_dashboard_rows", () => [
      row({ grp: "on_order", target_kind: "ipas", target_id: "ip-late", target_label: "TGIPAS_1", item_count: 2 }),
      row({ grp: "on_order", target_kind: "ipas", target_id: "ip-fine", target_label: "TGIPAS_2", item_count: 5 }),
      row({ opportunity_id: null, sales_reference: null, project_title: "Direct request", grp: "to_source", target_kind: "purchase_request", target_id: "pr-9", request_id: "pr-9", item_count: 1 }),
    ]);
    renderPage();
    expect(await screen.findByText("Direct request")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /IPAS TGIPAS_1 · 2 · 0d · late/ })).toBeInTheDocument();

    const user = setupUser();
    await user.click(screen.getByRole("button", { name: /Any age/ }));
    await user.click(await screen.findByRole("button", { name: "Late by the ageing rules" }));
    expect(await screen.findByRole("heading", { name: /On order \(2 items, 1 SOR\)/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /IPAS TGIPAS_1/ }));
    expect(await screen.findByText("At /purchasing/ipas/ip-late")).toBeInTheDocument();
  });


  it("shows the client's delivery deadline on the On order group only, marked near or late (#467)", async () => {
    const inDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
    stubRpc("sor_delivery_deadlines", () => [
      { opportunity_id: "sor-1", due_at: inDays(2), days: 15 },
      { opportunity_id: "sor-2", due_at: inDays(-3), days: 15 },
    ]);
    stubRpc("purchasing_dashboard_rows", () => [
      row({ grp: "on_order", target_kind: "purchase_request", target_id: "pr-1", request_id: "pr-1", item_count: 2 }),
      row({ grp: "to_source", target_kind: "purchase_request", target_id: "pr-1", request_id: "pr-1", item_count: 1 }),
      row({ opportunity_id: "sor-2", sales_reference: "S07984", grp: "on_order", target_kind: "purchase_request", target_id: "pr-2", request_id: "pr-2", item_count: 1 }),
      row({ opportunity_id: "sor-3", sales_reference: "S07985", grp: "on_order", target_kind: "purchase_request", target_id: "pr-3", request_id: "pr-3", item_count: 1 }),
    ]);
    renderPage();

    const near = await within(await screen.findByTestId("sor-on_order-sor-1")).findByText(/Client deadline/);
    expect(near).toHaveAttribute("data-deadline", "near");
    const late = await within(screen.getByTestId("sor-on_order-sor-2")).findByText(/Client deadline/);
    expect(late).toHaveAttribute("data-deadline", "late");
    expect(within(screen.getByTestId("sor-on_order-sor-3")).queryByText(/Client deadline/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId("sor-to_source-sor-1")).queryByText(/Client deadline/)).not.toBeInTheDocument();
  });

  it("shows the five groups with counts, and the SOR in all four of its groups", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: /purchasings*dashboard/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /To source \(4 items, 1 SOR\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /To order \(0 items, 0 SORs\)/ })).toBeInTheDocument();
    for (const grp of ["to_source", "to_price", "on_order", "to_check"]) {
      const entry = screen.getByTestId(`sor-${grp}-sor-1`);
      expect(within(entry).getByText("All outstanding: 4 to source, 1 to price, 2 on order, 1 to check")).toBeInTheDocument();
    }
    expect(screen.queryByTestId("sor-to_order-sor-1")).not.toBeInTheDocument();
  });

  it("opens the record that owns the work", async () => {
    renderPage();
    await setupUser().click(await screen.findByRole("button", { name: /Transmittal TG03-12/ }));
    expect(await screen.findByText("At /purchasing/transmittals/tr-1")).toBeInTheDocument();
  });

  it("narrows to items ordered with no canvass", async () => {
    renderPage();
    await setupUser().click(await screen.findByRole("button", { name: "Ordered with no canvass" }));
    expect(await screen.findByRole("heading", { name: /On order \(1 item, 1 SOR\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /To source \(0 items, 0 SORs\)/ })).toBeInTheDocument();
  });

  it("sends an employee with no Purchasing, Finance or Super Admin access home", async () => {
    mockUser.current = makeEmployee({ name: "Plain" });
    renderPage();
    expect(await screen.findByText("At /")).toBeInTheDocument();
  });

  it("shows the nav entry to Purchasing, Finance and Super Admins only", () => {
    const entry = NAV_MODULES.purchasing.links.find((link) => link.key === "purchasing.dashboard");
    const visible = (user) => entry.isPermitted(getPermissionContext(user));
    expect(visible(makeEmployee({ name: "Plain" }))).toBe(false);
    expect(visible(makeEmployee({ name: "Buyer", has_purchasing_flow: true }))).toBe(true);
    expect(visible(makeEmployee({ name: "Finance", has_finance_flow: true }))).toBe(true);
  });
});
