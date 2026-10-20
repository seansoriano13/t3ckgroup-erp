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
 * The Purchasing Dashboard (#322): three tabs, opening on What needs doing.
 * Its Projects tab shows the five groups with counts, one SOR in every group it
 * has work in; a Purchase Request opens in the slide-over here, every other
 * record in the place that owns it. The grouping rules are the database's and
 * purchasingDashboard.js's; What needs doing and Register are covered in
 * orderMonitoringPage.test.jsx.
 */

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/services/orderMonitoringService", () => ({
  orderMonitoringService: {
    list: async () => [{ id: "ip-late", late: true }, { id: "ip-fine", late: false }],
    counts: async () => null,
  },
}));

// The request's own body has its tests (PurchaseRequestView, RequestBuyer); here it only has to open.
vi.mock("@/components/purchase-request/PurchaseRequestView", () => ({
  default: ({ requestId }) => <p>Request body {requestId}</p>,
}));
vi.mock("@/components/purchase-request/RequestBuyer", () => ({ default: () => null }));

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

function DashboardAt() {
  const location = useLocation();
  return (
    <>
      <PurchasingDashboardPage />
      <output data-testid="url">{location.search}</output>
    </>
  );
}

const renderPage = (entry = "/purchasing/dashboard?tab=projects") =>
  renderWithProviders(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/purchasing/dashboard" element={<DashboardAt />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

const QUEUE_ROW = {
  id: "pr-1",
  opportunity_id: "sor-1",
  sales_reference: "S07983",
  project_title: "Ambulance",
  stage_name: null,
  sor_closed: null,
  buyer_id: null,
  item_count: 6,
  open_count: 6,
  title: null,
};

describe("Purchasing Dashboard page", () => {
  beforeEach(() => {
    mockUser.current = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    stubRpc("purchasing_dashboard_rows", () => ROWS);
    stubRpc("purchase_request_queue", () => [QUEUE_ROW]);
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("opens on What needs doing, with Projects and Register beside it", async () => {
    renderPage("/purchasing/dashboard");
    expect(await screen.findByRole("tab", { name: "What needs doing" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Register" })).toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { level: 1, name: /purchasing\s*dashboard/i })).toBeInTheDocument();
    const counts = await screen.findByRole("group", { name: "Group counts" });
    expect(within(counts).getByText("To source")).toBeInTheDocument();
    expect(within(counts).getByText("On order")).toBeInTheDocument();
    expect(within(counts).getAllByText("1 SOR").length).toBeGreaterThan(0);
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

  it("opens a Purchase Request in the slide-over on the dashboard, in the URL", async () => {
    renderPage();
    await setupUser().click(await screen.findByRole("button", { name: /Ambulance kit/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Ambulance")).toBeInTheDocument();
    expect(await within(sheet).findByText("Request body pr-1")).toBeInTheDocument();
    expect(screen.getByTestId("url")).toHaveTextContent("request=pr-1");
  });

  it("opens the request full screen from the slide-over, and the next one opens full too", async () => {
    const user = setupUser();
    const first = renderPage();
    await user.click(await screen.findByRole("button", { name: /Ambulance kit/ }));
    await user.click(await screen.findByRole("button", { name: "Open full" }));
    expect(await screen.findByRole("button", { name: "Show in side panel" })).toBeInTheDocument();
    first.unmount();

    renderPage("/purchasing/dashboard?tab=projects&request=pr-1");
    const back = await screen.findByRole("button", { name: "Show in side panel" });
    await user.click(back);
    expect(await screen.findByRole("button", { name: "Open full" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show in side panel" })).not.toBeInTheDocument();
  }, 20_000);

  it("still opens the slide-over when browser storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    renderPage("/purchasing/dashboard?tab=projects&request=pr-1");
    expect(await screen.findByRole("button", { name: "Open full" })).toBeInTheDocument();
  });

  it("narrows to items ordered with no canvass, a choice in the Filters popover", async () => {
    renderPage();
    const user = setupUser();
    await user.click(await screen.findByRole("button", { name: /Filters/ }));
    await user.click(await screen.findByRole("button", { name: /With or without a canvass/ }));
    await user.click(await screen.findByRole("button", { name: "Ordered with no canvass" }));
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
