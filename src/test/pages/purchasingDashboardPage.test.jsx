import { screen, within } from "@testing-library/react";
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
 * The Purchasing Dashboard: one tracker, a row per SOR with a circle per stage
 * and the next move, replacing the Projects, What needs doing and Register tabs.
 * A SOR opens in a slide-over (`?sor=`); a Purchase Request opens here
 * (`?request=`); every other record opens the place that owns it. The tracker's
 * rules are purchasingTracker.js's; this covers the page around them.
 */

const mockUser = vi.hoisted(() => ({ current: null }));

// The request's own body has its tests (PurchaseRequestView); here it only has to open.
vi.mock("@/components/purchase-request/PurchaseRequestView", () => ({
  default: ({ requestId }) => <p>Request body {requestId}</p>,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false, logout: vi.fn() }),
}));

const DAY = 86_400_000;
const dateAgo = (days) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
const timeAgo = (days) => new Date(Date.now() - days * DAY).toISOString();
const inDays = (days) => new Date(Date.now() + days * DAY).toISOString();

let seq = 0;
/** An open order from a draft PO, so Purchasing owes the first step. */
function seedOrder({ filed = false } = {}) {
  seq += 1;
  return db.seed("ipas", {
    number: `TGIPAS_${800 + seq}`,
    po_number: `P0${8000 + seq}`,
    priority: "high",
    source: "local",
    purpose: "supplies",
    state: filed ? "filed" : "open",
    filed_at: filed ? timeAgo(1) : null,
    computation_status: filed ? "lc_odoo_done" : "encoding",
    odoo_copy: {
      po: { id: seq, name: `P0${8000 + seq}`, state: "draft", company: "T3ck Trading", currency: "Php" },
      supplier: { id: 553, name: "Scorpe Technologies" },
      lines: [{ line_id: 30000 + seq, product_id: 5350, name: "Cutter", quantity: 1, unit: "Unit", price_unit: 1000, price_subtotal: 1000, taxes: [], analytic: [] }],
      receipts: { status: "pending", done: 0, total: 1 },
      bills: { count: 0, draft: 0 },
    },
    odoo_fetched_at: timeAgo(0),
    created_at: timeAgo(20),
  });
}

const header = (ipas, opportunityId, ref = "S07983", title = "Ambulance") => ({
  ipas_id: ipas.id,
  opportunity_id: opportunityId,
  sales_reference: ref,
  project_title: title,
  current_stage_name: "Project Delivery",
});

const row = (over) => ({
  opportunity_id: "sor-1",
  sales_reference: "S07983",
  project_title: "Ambulance",
  target_label: null,
  no_canvass_count: 0,
  buyer_id: null,
  canvasser_id: null,
  since: timeAgo(5),
  request_id: null,
  ...over,
});

const PR_ROW = row({ grp: "to_source", target_kind: "purchase_request", target_id: "pr-1", request_id: "pr-1", item_count: 4, target_label: "Ambulance kit" });
const ipasRow = (ipas, over) => row({ grp: "on_order", target_kind: "ipas", target_id: ipas.id, target_label: ipas.number, item_count: 1, ...over });

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname}{location.search}</output>;
}

const renderPage = (entry = "/purchasing/dashboard") =>
  renderWithProviders(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/purchasing/order-monitoring" element={<OrderMonitoringRedirect />} />
        <Route path="/purchasing/dashboard" element={<PurchasingDashboardPage />} />
        <Route path="/purchasing/ipas/:id" element={<p>IPAS page</p>} />
        <Route path="/purchasing/transmittals/:id" element={<p>Slip page</p>} />
        <Route path="/sors" element={<p>SOR Register</p>} />
        <Route path="/" element={<p>Home page</p>} />
      </Routes>
      <Where />
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
    seq = 0;
    mockUser.current = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    stubRpc("purchasing_dashboard_rows", () => [PR_ROW]);
    stubRpc("ipas_sor_headers", () => []);
    stubRpc("sor_delivery_deadlines", () => []);
    stubRpc("purchase_request_queue", () => [QUEUE_ROW]);
    localStorage.clear();
  });

  it("is one tracker, with no tabs: stage totals, then a row per SOR with its next move", async () => {
    const ipas = seedOrder();
    stubRpc("ipas_sor_headers", () => [header(ipas, "sor-1")]);
    stubRpc("purchasing_dashboard_rows", () => [PR_ROW, ipasRow(ipas)]);
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: /purchasing\s*dashboard/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();

    const totals = await screen.findByRole("group", { name: "Stage totals" });
    for (const label of ["To source", "To price", "To order", "On order", "To check", "Filed", "Late orders"]) {
      expect(within(totals).getByText(label)).toBeInTheDocument();
    }

    // The money is beside the filters, not a cell of the stage row.
    expect(within(totals).queryByText("Value open")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Value of open orders, pre-tax")).toHaveTextContent(/Value open.*1,000/);

    const tracker = await screen.findByRole("row", { name: /S07983 — Ambulance, open/ });
    expect(within(tracker).getByRole("img", { name: "To source: 4 items" })).toBeInTheDocument();
    expect(within(tracker).getByRole("img", { name: "On order: 1 items" })).toBeInTheDocument();
    // Purchasing owes the first step on a draft PO, and it is the order's next move.
    expect(within(tracker).getByText("Purchase Order — no PO confirmed yet")).toBeInTheDocument();
  });

  it("opens a SOR in the slide-over, in the URL: what is next, then the stages with their records", async () => {
    const ipas = seedOrder();
    stubRpc("ipas_sor_headers", () => [header(ipas, "sor-1")]);
    stubRpc("purchasing_dashboard_rows", () => [PR_ROW, ipasRow(ipas)]);
    renderPage();

    await setupUser().click(await screen.findByRole("row", { name: /S07983 — Ambulance, open/ }));

    const panel = await screen.findByRole("dialog");
    expect(screen.getByTestId("where")).toHaveTextContent("sor=sor-1");
    expect(within(panel).getByRole("heading", { name: "What is next" })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Where it stands" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Ambulance kit/ })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: new RegExp(ipas.number) })).toBeInTheDocument();
  });

  it("opens an order from the panel on its IPAS", async () => {
    const ipas = seedOrder();
    stubRpc("ipas_sor_headers", () => [header(ipas, "sor-1")]);
    stubRpc("purchasing_dashboard_rows", () => [ipasRow(ipas)]);
    renderPage("/purchasing/dashboard?sor=sor-1");

    const panel = await screen.findByRole("dialog");
    await setupUser().click(await within(panel).findByRole("button", { name: new RegExp(ipas.number) }));

    expect(screen.getByTestId("where")).toHaveTextContent(`/purchasing/ipas/${ipas.id}`);
  });

  it("opens a Purchase Request from the panel in the record window, in the URL", async () => {
    renderPage("/purchasing/dashboard?sor=sor-1");

    const panel = await screen.findByRole("dialog");
    await setupUser().click(await within(panel).findByRole("button", { name: /Ambulance kit/ }));

    expect(await screen.findByText("Request body pr-1")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("request=pr-1");
  });

  it("opens a Transmittal from the panel", async () => {
    stubRpc("purchasing_dashboard_rows", () => [
      PR_ROW,
      row({ grp: "to_check", target_kind: "transmittal", target_id: "tr-1", target_label: "TG03-12", item_count: 1 }),
    ]);
    const user = setupUser();
    renderPage("/purchasing/dashboard?sor=sor-1");

    const panel = await screen.findByRole("dialog");
    await user.click(await within(panel).findByRole("button", { name: /Transmittal TG03-12/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/purchasing/transmittals/tr-1");
  });

  it("opens the SOR Register from the panel's footer", async () => {
    renderPage("/purchasing/dashboard?sor=sor-1");
    const panel = await screen.findByRole("dialog");
    await setupUser().click(await within(panel).findByRole("button", { name: "Open SOR" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/sors");
  });

  it("names the slip and the action on a Transmittal order's next move, and opens that slip (#588)", async () => {
    const ipas = seedOrder();
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
    db.seed("transmittal_lines", { transmittal_id: slip.id, position: 1, kind: "po_line", ipas_id: ipas.id, odoo_po_line_id: 30001, description: "Cutter", quantity: 1 });
    stubRpc("ipas_sor_headers", () => [header(ipas, "sor-1")]);
    stubRpc("purchasing_dashboard_rows", () => [ipasRow(ipas, { grp: "to_check" })]);
    renderPage("/purchasing/dashboard?sor=sor-1");

    const panel = await screen.findByRole("dialog");
    await setupUser().click(await within(panel).findByRole("button", { name: /warehouse checking/i }));
    expect(screen.getByTestId("where")).toHaveTextContent(`/purchasing/transmittals/${slip.id}`);
  });

  it("gives a Direct request its own row and opens its request from the footer", async () => {
    stubRpc("purchasing_dashboard_rows", () => [
      row({ opportunity_id: null, sales_reference: null, project_title: null, grp: "to_source", target_kind: "purchase_request", target_id: "pr-9", request_id: "pr-9", item_count: 1, target_label: "Spare tyres" }),
    ]);
    stubRpc("purchase_request_queue", () => [{ ...QUEUE_ROW, id: "pr-9", opportunity_id: null, sales_reference: null }]);
    renderPage();

    await setupUser().click(await screen.findByRole("row", { name: /Direct request, open/ }));
    const panel = await screen.findByRole("dialog");
    await setupUser().click(await within(panel).findByRole("button", { name: "Open the request" }));
    expect(screen.getByTestId("where")).toHaveTextContent("request=pr-9");
  });

  it("narrows to a stage from the totals, and by search", async () => {
    stubRpc("purchasing_dashboard_rows", () => [
      PR_ROW,
      row({ opportunity_id: "sor-2", sales_reference: "S07984", project_title: "Boat", grp: "to_order", target_kind: "canvass", target_id: "cv-1", target_label: "C-1", item_count: 2 }),
    ]);
    const user = setupUser();
    renderPage();

    expect(await screen.findByRole("row", { name: /S07983/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /S07984/ })).toBeInTheDocument();

    await user.click(within(screen.getByRole("group", { name: "Stage totals" })).getByRole("button", { name: /To order/ }));
    expect(await screen.findByRole("row", { name: /S07984/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /S07983/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Clear all/ }));
    await user.type(screen.getByRole("textbox", { name: /Search SOR, IPAS or PO/ }), "ambulance");
    expect(await screen.findByRole("row", { name: /S07983/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /S07984/ })).not.toBeInTheDocument();
  });

  it("finds a SOR by its order's PO number", async () => {
    const ipas = seedOrder();
    stubRpc("ipas_sor_headers", () => [header(ipas, "sor-1")]);
    stubRpc("purchasing_dashboard_rows", () => [
      PR_ROW,
      row({ opportunity_id: "sor-2", sales_reference: "S07984", project_title: "Boat", grp: "to_order", target_kind: "canvass", target_id: "cv-1", item_count: 2 }),
    ]);
    renderPage();

    await setupUser().type(await screen.findByRole("textbox", { name: /Search SOR, IPAS or PO/ }), ipas.po_number);
    expect(await screen.findByRole("row", { name: /S07983/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /S07984/ })).not.toBeInTheDocument();
  });

  it("narrows to items ordered with no canvass, a choice in the Filters popover", async () => {
    stubRpc("purchasing_dashboard_rows", () => [
      PR_ROW,
      row({ opportunity_id: "sor-2", sales_reference: "S07984", project_title: "Boat", grp: "on_order", target_kind: "purchase_request", target_id: "pr-2", request_id: "pr-2", item_count: 2, no_canvass_count: 1 }),
    ]);
    const user = setupUser();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Filters/ }));
    await user.click(await screen.findByRole("button", { name: /With or without a canvass/ }));
    await user.click(await screen.findByRole("button", { name: "Ordered with no canvass" }));

    expect(await screen.findByRole("row", { name: /S07984/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /S07983/ })).not.toBeInTheDocument();
  });

  describe("client delivery deadline (#467)", () => {
    it("marks a SOR near its date, late past it, and shows none without one", async () => {
      stubRpc("purchasing_dashboard_rows", () => [
        PR_ROW,
        row({ opportunity_id: "sor-2", sales_reference: "S07984", project_title: "Boat", grp: "to_source", target_kind: "purchase_request", target_id: "pr-2", request_id: "pr-2", item_count: 1 }),
        row({ opportunity_id: "sor-3", sales_reference: "S07985", project_title: "Van", grp: "to_source", target_kind: "purchase_request", target_id: "pr-3", request_id: "pr-3", item_count: 1 }),
      ]);
      stubRpc("sor_delivery_deadlines", () => [
        { opportunity_id: "sor-1", due_at: inDays(3), days: 15 },
        { opportunity_id: "sor-2", due_at: inDays(-2), days: 15 },
      ]);
      renderPage();

      const near = await within(await screen.findByRole("row", { name: /S07983/ })).findByText(/Client deadline/);
      expect(near).toHaveAttribute("data-deadline", "near");
      const late = await within(screen.getByRole("row", { name: /S07984/ })).findByText(/Client deadline/);
      expect(late).toHaveAttribute("data-deadline", "late");
      expect(within(screen.getByRole("row", { name: /S07985/ })).queryByText(/Client deadline/)).not.toBeInTheDocument();
    });

    it("honours the saved N: the same date reads fine under a smaller N", async () => {
      db.seed("order_deadline_setting", { id: true, near_days: 2 });
      stubRpc("sor_delivery_deadlines", () => [{ opportunity_id: "sor-1", due_at: inDays(3), days: 15 }]);
      renderPage();

      const line = await within(await screen.findByRole("row", { name: /S07983/ })).findByText(/Client deadline/);
      expect(line).toHaveAttribute("data-deadline", "ok");
    });
  });

  it("leaves fully filed SORs out until they are asked for", async () => {
    const filed = seedOrder({ filed: true });
    stubRpc("ipas_sor_headers", () => [header(filed, "sor-9", "S09999", "Old job")]);
    const user = setupUser();
    renderPage();

    expect(await screen.findByRole("row", { name: /S07983/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /S09999/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    await user.click(await screen.findByRole("button", { name: /SORs with something open/ }));
    await user.click(await screen.findByRole("button", { name: "Include fully filed SORs" }));
    expect(await screen.findByRole("row", { name: /S09999/ })).toBeInTheDocument();
  });

  describe("follows the shared list anatomy (#637)", () => {
    const DIRECT_ROW = row({ opportunity_id: null, sales_reference: null, project_title: null, grp: "to_source", target_kind: "purchase_request", target_id: "pr-9", request_id: "pr-9", item_count: 1, target_label: "Spare tyres", since: timeAgo(1) });

    it("keeps headings on one line, sorts all but the stage circles, and ends with the shared pager", async () => {
      renderPage();
      const table = await screen.findByRole("table");
      const headings = within(table).getAllByRole("columnheader");
      for (const heading of headings) expect(heading).not.toHaveClass("whitespace-normal");
      const circles = headings.filter((heading) => ["To source", "To price", "To order", "On order", "To check", "Filed"].includes(heading.textContent));
      expect(circles).toHaveLength(6);
      for (const heading of circles) expect(heading).not.toHaveAttribute("aria-sort");
      for (const name of ["SOR", "Next move", "Deadline"]) {
        expect(headings.find((heading) => heading.textContent === name)).toHaveAttribute("aria-sort");
      }
      expect(screen.getByText(/^Showing/)).toHaveTextContent("Showing 1 to 1 of 1 SORs");
    });

    it("puts Value open, Columns and Export at the right end of the bar, after Filters", async () => {
      const ipas = seedOrder();
      stubRpc("ipas_sor_headers", () => [header(ipas, "sor-1")]);
      stubRpc("purchasing_dashboard_rows", () => [PR_ROW, ipasRow(ipas)]);
      renderPage();

      const bar = await screen.findByTestId("page-toolbar");
      const value = await within(bar).findByLabelText("Value of open orders, pre-tax");
      const filters = within(bar).getByRole("button", { name: /Filters/ });
      const columns = within(bar).getByRole("button", { name: /Columns/ });
      const exportButton = within(bar).getByRole("button", { name: "Export to Excel" });
      const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(before(filters, value)).toBe(true);
      expect(before(value, columns)).toBe(true);
      expect(before(columns, exportButton)).toBe(true);
    });

    it("opens Filters as a grid of dropdowns", async () => {
      const user = setupUser();
      renderPage();
      await user.click(await screen.findByRole("button", { name: /Filters/ }));
      const canvass = await screen.findByRole("button", { name: /With or without a canvass/ });
      expect(canvass.closest(".grid")).not.toBeNull();
    });

    it("writes Direct request as a word, not mono", async () => {
      stubRpc("purchasing_dashboard_rows", () => [DIRECT_ROW]);
      renderPage();
      const tracker = await screen.findByRole("row", { name: /Direct request, open/ });
      expect(within(within(tracker).getAllByRole("cell")[0]).getByText("Direct request")).not.toHaveClass("font-mono");
    });

    it("writes No SOR as a word, not mono", async () => {
      seedOrder(); // no SOR header names it, so it sits on the "No SOR" row
      stubRpc("purchasing_dashboard_rows", () => []);
      renderPage();
      const tracker = await screen.findByRole("row", { name: /Orders with no SOR, open/ });
      expect(within(within(tracker).getAllByRole("cell")[0]).getByText("No SOR")).not.toHaveClass("font-mono");
    });

    it("reads every age as Nd, in the table and in the panel, never '1 day' or '0 days'", async () => {
      const ipas = seedOrder();
      stubRpc("ipas_sor_headers", () => [header(ipas, "sor-1")]);
      stubRpc("purchasing_dashboard_rows", () => [{ ...PR_ROW, since: timeAgo(1) }, ipasRow(ipas, { since: timeAgo(0) })]);
      renderPage("/purchasing/dashboard?sor=sor-1");

      const panel = await screen.findByRole("dialog");
      expect(within(panel).getAllByText(/\b\d+d\b/).length).toBeGreaterThan(0);
      expect(within(screen.getByRole("table", { hidden: true })).getAllByText(/\b\d+d\b/).length).toBeGreaterThan(0);
      expect(document.body).not.toHaveTextContent(/\b[01] days?\b/);
    });
  });

  it("keeps the old Order Monitoring URL working: it opens the dashboard", async () => {
    renderPage("/purchasing/order-monitoring");
    expect(await screen.findByRole("heading", { level: 1, name: /purchasing\s*dashboard/i })).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/purchasing/dashboard");
  });

  it("sends an employee with no Purchasing, Finance or Super Admin access home", async () => {
    mockUser.current = makeEmployee({ name: "Plain" });
    renderPage();
    expect(await screen.findByText("Home page")).toBeInTheDocument();
  });

  it("shows the nav entry to Purchasing, Finance and Super Admins only", () => {
    const entry = NAV_MODULES.purchasing.links.find((link) => link.key === "purchasing.dashboard");
    const visible = (user) => entry.isPermitted(getPermissionContext(user));
    expect(visible(makeEmployee({ name: "Plain" }))).toBe(false);
    expect(visible(makeEmployee({ name: "Buyer", has_purchasing_flow: true }))).toBe(true);
    expect(visible(makeEmployee({ name: "Finance", has_finance_flow: true }))).toBe(true);
  });
});
