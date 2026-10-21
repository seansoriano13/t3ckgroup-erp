import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrderMonitoringRedirect from "@/pages/purchasing/order-monitoring/index";
import PurchasingDashboardPage from "@/pages/purchasing/dashboard/index";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubRpc } from "@/test/msw/server";
import { NAV_MODULES } from "@/constants/navigation";
import { getPermissionContext } from "@/utils/permissions";

/**
 * Order Monitoring (#263, spec #261), two tabs of the Purchasing Dashboard
 * since 2026-10-20. The old /purchasing/order-monitoring opens the dashboard on
 * What needs doing, with the four tiles, the three open groups and Filed
 * collapsed. Purchasing access, Finance access and Super Admins see it; a plain
 * employee is sent home. The list's rules are the service's
 * (orderMonitoringService).
 */

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false, logout: vi.fn() }),
}));

const DAY = 86_400_000;
const dateAgo = (days) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
const timeAgo = (days) => new Date(Date.now() - days * DAY).toISOString();

let seq = 0
function seedOrder({ source = "local", state = "open", poState = "purchase", arrivedInPh = null, filed = false } = {}) {
  seq += 1
  const ipas = db.seed("ipas", {
    number: `TGIPAS_${800 + seq}`,
    po_number: `P0${8000 + seq}`,
    priority: "high",
    source,
    purpose: "supplies",
    state,
    filed_at: filed ? timeAgo(1) : null,
    computation_status: filed ? "checked" : "encoding",
    arrived_in_ph_on: arrivedInPh,
    odoo_copy: {
      po: { id: seq, name: `P0${8000 + seq}`, state: poState, company: "T3ck Trading", currency: "Php" },
      supplier: { id: 553, name: "Scorpe Technologies" },
      lines: [{ line_id: 30000 + seq, product_id: 5350, name: "Cutter", quantity: 1, unit: "Unit", price_unit: 1000, price_subtotal: 1000, taxes: [], analytic: [] }],
      receipts: { status: "pending", done: 0, total: 1 },
      bills: { count: 0, draft: 0 },
    },
    odoo_fetched_at: timeAgo(0),
    created_at: timeAgo(20),
  });
  return ipas;
}

function seedProofPayment(ipas) {
  const method = db.seed("ipas_options", { list: "payment_method", label: "Bank transfer" });
  db.seed("ipas_payments", {
    ipas_id: ipas.id,
    kind: "full_payment",
    paid_on: dateAgo(15),
    amount: 1000,
    method_id: method.id,
    proof_url: "https://example.com/proof.pdf",
  });
}

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname}{location.search}</output>;
}

const renderPage = (entry = "/purchasing/order-monitoring") =>
  renderWithProviders(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/purchasing/order-monitoring" element={<OrderMonitoringRedirect />} />
        <Route path="/purchasing/dashboard" element={<PurchasingDashboardPage />} />
        <Route path="/purchasing/transmittals/:id" element={<p>Slip page</p>} />
        <Route path="/" element={<p>Home page</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );

describe("Order Monitoring on the Purchasing Dashboard", () => {
  beforeEach(() => {
    seq = 0;
    mockUser.current = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    stubRpc("ipas_sor_headers", () => []);
  });

  it("the old URL opens the dashboard on what needs doing: the tiles, then the groups, with Filed collapsed", async () => {
    const late = seedOrder({ source: "import", arrivedInPh: dateAgo(6) });
    seedProofPayment(late);
    const waiting = seedOrder({ poState: "draft" });
    seedOrder({ state: "filed", filed: true, poState: "purchase" });
    db.seed("order_ageing_rules", { step: "import_clearance", days: 3 });

    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: /purchasing\s*dashboard/i })).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/purchasing/dashboard?tab=needs");
    expect(screen.getByRole("tab", { name: "What needs doing" })).toHaveAttribute("aria-selected", "true");

    const totals = await screen.findByRole("group", { name: "Totals" });
    expect(within(totals).getByText("Needs chasing")).toBeInTheDocument();
    expect(within(totals).getByText("Waiting on us")).toBeInTheDocument();
    expect(within(totals).getByText("Waiting on someone else")).toBeInTheDocument();
    expect(within(totals).getByText("Value open")).toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: /Needs chasing \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Waiting on us \(1\)/ })).toBeInTheDocument();
    expect(screen.getByText(`TGIPAS_${800 + 1}`)).toBeInTheDocument();
    expect(screen.getByText("Purchase Order — no PO confirmed yet")).toBeInTheDocument();
    expect(screen.getByText(`PO ${waiting.po_number}`)).toBeInTheDocument();
  });

  it("names the slip and the action on a Transmittal row, says who it waits on, and opens that slip (#588)", async () => {
    const ipas = seedOrder({ poState: "draft" });
    const slip = db.seed("transmittals", {
      number: "TG03-0012",
      prepared_on: dateAgo(3),
      origin: "purchasing",
      priority: "high",
      entity: "T3ck Trading",
      check_warehouse: true,
      check_technical: false,
      state: "warehouse_checking",
      prepared_by: makeEmployee({ name: "Preparer" }).id,
      submitted_at: timeAgo(3),
    });
    db.seed("transmittal_lines", {
      transmittal_id: slip.id,
      position: 1,
      kind: "po_line",
      ipas_id: ipas.id,
      odoo_po_line_id: 30001,
      description: "Cutter",
      quantity: 1,
    });
    const user = setupUser();

    renderPage("/purchasing/dashboard?tab=needs");

    const label = await screen.findByText("TG03-0012 needs Warehouse checking, waiting on Transmittal · Warehouse");
    await user.click(label);

    expect(screen.getByTestId("where")).toHaveTextContent(`/purchasing/transmittals/${slip.id}`);
  });

  it("narrows What needs doing by search, and the totals follow (#574)", async () => {
    const first = seedOrder({ poState: "draft" });
    const second = seedOrder({ poState: "draft" });

    renderPage();

    expect(await screen.findByText(first.number)).toBeInTheDocument();
    expect(screen.getByText(second.number)).toBeInTheDocument();

    await setupUser().type(screen.getByRole("textbox", { name: "Search IPAS, PO or S number" }), first.number);

    await waitFor(() => expect(screen.queryByText(second.number)).not.toBeInTheDocument());
    expect(screen.getByText(first.number)).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Totals" })).getByText("Waiting on us").nextElementSibling).toHaveTextContent("1");
  });

  it("opens What needs doing and the Register with the same top: a search box, the Filters button and a stat row (#574)", async () => {
    seedOrder({ poState: "draft" });
    const user = setupUser();

    renderPage("/purchasing/dashboard?tab=needs");
    expect(await screen.findByRole("group", { name: "Totals" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filters/ })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Register" }));
    expect(await screen.findByRole("group", { name: "Register totals" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filters/ })).toBeInTheDocument();
  });

  it("keeps the Filed group collapsed until it is opened", async () => {
    const filed = seedOrder({ state: "filed", filed: true })
    seedOrder({ poState: "draft" });

    renderPage();

    const toggle = await screen.findByRole("button", { name: /Filed \(1\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(filed.number)).not.toBeInTheDocument();

    await setupUser().click(toggle);

    await waitFor(() => expect(screen.getByRole("button", { name: /Filed \(1\)/ })).toHaveAttribute("aria-expanded", "true"));
    expect(await screen.findByText(filed.number)).toBeInTheDocument();
  });

  it("sends an employee with no Purchasing, Finance or Super Admin access home", async () => {
    mockUser.current = makeEmployee({ name: "Plain" });
    seedOrder({ poState: "draft" });

    renderPage();

    expect(await screen.findByText("Home page")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: /purchasing\s*dashboard/i })).not.toBeInTheDocument();
  });

  it("has no nav entry of its own: the Purchasing Dashboard's is shown to Purchasing, Finance and Super Admins", () => {
    expect(NAV_MODULES.purchasing.links.find((link) => link.link === "/purchasing/order-monitoring")).toBeUndefined();
    const entry = NAV_MODULES.purchasing.links.find((link) => link.key === "purchasing.dashboard");
    const visible = (user) => entry.isPermitted(getPermissionContext(user));

    expect(visible(makeEmployee({ name: "Plain" }))).toBe(false);
    expect(visible(makeEmployee({ name: "Buyer", has_purchasing_flow: true }))).toBe(true);
    expect(visible(makeEmployee({ name: "Finance", has_finance_flow: true }))).toBe(true);
    expect(visible(makeEmployee({ name: "Admin", is_super_admin: true }))).toBe(true);
  });
});

/**
 * The order register (#264): a dashboard tab beside What needs doing. The
 * dashboard always opens on What needs doing; the tab is kept in the URL.
 */
describe("Order Monitoring on the Purchasing Dashboard: the Register tab", () => {
  beforeEach(() => {
    seq = 0;
    mockUser.current = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    stubRpc("ipas_sor_headers", () => []);
  });

  it("opens on What needs doing and switches to the Register, which lists filed orders too", async () => {
    seedOrder({ poState: "draft" });
    const filed = seedOrder({ state: "filed", filed: true });

    renderPage();

    const needs = await screen.findByRole("tab", { name: "What needs doing" });
    expect(needs).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("table", { name: /register/i })).not.toBeInTheDocument();

    await setupUser().click(screen.getByRole("tab", { name: "Register" }));

    const register = await screen.findByRole("region", { name: "Order register" });
    expect(within(register).getByText(filed.number)).toBeInTheDocument();
    expect(within(register).getAllByText("No Transmittal").length).toBeGreaterThan(0);
  });

  it("shows a row of totals above the register", async () => {
    seedOrder({ poState: "draft" });
    seedOrder({ state: "filed", filed: true });

    renderPage("/purchasing/dashboard?tab=register");

    const totals = await screen.findByRole("group", { name: "Register totals" });
    for (const label of ["Orders shown", "Open", "Filed", "Late"]) {
      expect(within(totals).getByText(label)).toBeInTheDocument();
    }
  });

  it("draws the seven-step track and the hand-off in the register", async () => {
    const ipas = seedOrder({ source: "import", arrivedInPh: dateAgo(6) });
    seedProofPayment(ipas);

    renderPage();
    await setupUser().click(await screen.findByRole("tab", { name: "Register" }));

    const register = await screen.findByRole("region", { name: "Order register" });
    const track = await within(register).findByRole("list", { name: `Buyer track for ${ipas.number}` });
    expect(within(track).getAllByRole("listitem")).toHaveLength(7);
    expect(within(track).getByRole("listitem", { name: /Purchase Order, stamped/ })).toBeInTheDocument();
    expect(within(track).getByRole("listitem", { name: /Delivered, pending/ })).toBeInTheDocument();
  });

  it("keeps the tab in the URL, so a reload or a shared link reopens the Register", async () => {
    seedOrder({ poState: "draft" });

    const first = renderPage();
    await setupUser().click(await screen.findByRole("tab", { name: "Register" }));
    await screen.findByRole("region", { name: "Order register" });
    expect(screen.getByTestId("where")).toHaveTextContent("tab=register");
    first.unmount();

    renderPage("/purchasing/dashboard?tab=register");
    expect(await screen.findByRole("tab", { name: "Register" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("region", { name: "Order register" })).toBeInTheDocument();
  });

  it("opens on What needs doing when no tab is named", async () => {
    seedOrder({ poState: "draft" });

    renderPage("/purchasing/dashboard");

    expect(await screen.findByRole("tab", { name: "What needs doing" })).toHaveAttribute("aria-selected", "true");
  });

  it("narrows the register by search", async () => {
    const wanted = seedOrder({ source: "import", arrivedInPh: dateAgo(2) });
    const other = seedOrder({ source: "local" });

    renderPage();
    const user = setupUser();
    await user.click(await screen.findByRole("tab", { name: "Register" }));
    const register = await screen.findByRole("region", { name: "Order register" });
    expect(await within(register).findByText(other.number)).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: /search/i }), wanted.po_number);

    await waitFor(() => expect(within(register).queryByText(other.number)).not.toBeInTheDocument());
    expect(within(register).getByText(wanted.number)).toBeInTheDocument();
  });
  describe("client delivery deadline (#467)", () => {
    const headerFor = (ipas, opportunityId, ref = "S07983") => ({
      ipas_id: ipas.id,
      opportunity_id: opportunityId,
      sales_reference: ref,
      project_title: "Ambulance",
      current_stage_name: "Project Delivery",
    });
    const inDays = (days) => new Date(Date.now() + days * DAY).toISOString();

    it("shows the due date beside an unreceived order and marks it near", async () => {
      const ipas = seedOrder({ poState: "draft" });
      stubRpc("ipas_sor_headers", () => [headerFor(ipas, "sor-1")]);
      stubRpc("sor_delivery_deadlines", () => [{ opportunity_id: "sor-1", due_at: inDays(3), days: 15 }]);

      renderPage();

      const line = await screen.findByText(/Client deadline/);
      expect(line).toHaveAttribute("data-deadline", "near");
      expect(line).toHaveTextContent("near");
    });

    it("honours the saved N: the same date reads fine under a smaller N", async () => {
      const ipas = seedOrder({ poState: "draft" });
      db.seed("order_deadline_setting", { id: true, near_days: 2 });
      stubRpc("ipas_sor_headers", () => [headerFor(ipas, "sor-1")]);
      stubRpc("sor_delivery_deadlines", () => [{ opportunity_id: "sor-1", due_at: inDays(3), days: 15 }]);

      renderPage();

      expect(await screen.findByText(/Client deadline/)).toHaveAttribute("data-deadline", "ok");
    });

    it("marks an unreceived order late once past the date", async () => {
      const ipas = seedOrder({ poState: "draft" });
      stubRpc("ipas_sor_headers", () => [headerFor(ipas, "sor-1")]);
      stubRpc("sor_delivery_deadlines", () => [{ opportunity_id: "sor-1", due_at: inDays(-2), days: 15 }]);

      renderPage();

      const line = await screen.findByText(/Client deadline/);
      expect(line).toHaveAttribute("data-deadline", "late");
      expect(line).toHaveTextContent("late");
    });

    it("shows no deadline for an SOR without one", async () => {
      const ipas = seedOrder({ poState: "draft" });
      stubRpc("ipas_sor_headers", () => [headerFor(ipas, "sor-1")]);
      stubRpc("sor_delivery_deadlines", () => []);

      renderPage();

      expect(await screen.findByText(ipas.number)).toBeInTheDocument();
      expect(screen.queryByText(/Client deadline/)).not.toBeInTheDocument();
    });

    it("shows it in the register too", async () => {
      const ipas = seedOrder({ poState: "draft" });
      stubRpc("ipas_sor_headers", () => [headerFor(ipas, "sor-1")]);
      stubRpc("sor_delivery_deadlines", () => [{ opportunity_id: "sor-1", due_at: inDays(-1), days: 15 }]);

      renderPage();
      await setupUser().click(await screen.findByRole("tab", { name: "Register" }));

      const register = await screen.findByRole("region", { name: "Order register" });
      expect(await within(register).findByText(/Client deadline/)).toHaveAttribute("data-deadline", "late");
    });
  });
});
