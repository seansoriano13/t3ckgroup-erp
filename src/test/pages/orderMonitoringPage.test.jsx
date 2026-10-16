import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrderMonitoringPage from "@/pages/purchasing/order-monitoring/index";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubRpc } from "@/test/msw/server";
import { NAV_MODULES } from "@/constants/navigation";
import { getPermissionContext } from "@/utils/permissions";

/**
 * Order Monitoring (#263, spec #261): the page opens on What needs doing, with
 * the four tiles, the three open groups and Filed collapsed. Purchasing access,
 * Finance access and Super Admins see it; a plain employee is sent home and
 * has no nav entry. The list's rules are the service's (orderMonitoringService).
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

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/purchasing/order-monitoring"]}>
      <Routes>
        <Route path="/purchasing/order-monitoring" element={<OrderMonitoringPage />} />
        <Route path="/" element={<p>Home page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe("Order Monitoring page", () => {
  beforeEach(() => {
    seq = 0;
    mockUser.current = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    stubRpc("ipas_sor_headers", () => []);
  });

  it("opens on what needs doing: the tiles, then the groups, with Filed collapsed", async () => {
    const late = seedOrder({ source: "import", arrivedInPh: dateAgo(6) });
    seedProofPayment(late);
    const waiting = seedOrder({ poState: "draft" });
    seedOrder({ state: "filed", filed: true, poState: "purchase" });
    db.seed("order_ageing_rules", { step: "import_clearance", days: 3 });

    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: /order\s*monitoring/i })).toBeInTheDocument();

    const totals = await screen.findByRole("region", { name: "Totals" });
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
    expect(screen.queryByRole("heading", { level: 1, name: /order\s*monitoring/i })).not.toBeInTheDocument();
  });

  it("shows the nav entry to Purchasing, Finance and Super Admins, and not to a plain employee", () => {
    const entry = NAV_MODULES.purchasing.links.find((link) => link.key === "purchasing.order_monitoring");
    const visible = (user) => entry.isPermitted(getPermissionContext(user));

    expect(visible(makeEmployee({ name: "Plain" }))).toBe(false);
    expect(visible(makeEmployee({ name: "Buyer", has_purchasing_flow: true }))).toBe(true);
    expect(visible(makeEmployee({ name: "Finance", has_finance_flow: true }))).toBe(true);
    expect(visible(makeEmployee({ name: "Admin", is_super_admin: true }))).toBe(true);
  });
});

/**
 * The order register (#264): a switch between What needs doing and the Register,
 * remembered per person in the browser. Storage can be missing or throw, and
 * the page must still open on What needs doing.
 */
describe("Order Monitoring page: the register switch", () => {
  beforeEach(() => {
    seq = 0;
    mockUser.current = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    stubRpc("ipas_sor_headers", () => []);
    vi.restoreAllMocks();
    localStorage.clear();
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

  it("remembers the chosen view for this person across a reload", async () => {
    seedOrder({ poState: "draft" });

    const first = renderPage();
    await setupUser().click(await screen.findByRole("tab", { name: "Register" }));
    await screen.findByRole("region", { name: "Order register" });
    first.unmount();

    renderPage();

    expect(await screen.findByRole("tab", { name: "Register" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("region", { name: "Order register" })).toBeInTheDocument();
  });

  it("keeps each person's choice to themselves", async () => {
    seedOrder({ poState: "draft" });

    const first = renderPage();
    await setupUser().click(await screen.findByRole("tab", { name: "Register" }));
    await screen.findByRole("region", { name: "Order register" });
    first.unmount();

    mockUser.current = makeEmployee({ name: "Other Buyer", has_purchasing_flow: true });
    renderPage();

    expect(await screen.findByRole("tab", { name: "What needs doing" })).toHaveAttribute("aria-selected", "true");
  });

  it("still renders, on What needs doing, when browser storage throws", async () => {
    seedOrder({ poState: "draft" });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    renderPage();

    expect(await screen.findByRole("tab", { name: "What needs doing" })).toHaveAttribute("aria-selected", "true");
    await setupUser().click(screen.getByRole("tab", { name: "Register" }));
    expect(await screen.findByRole("region", { name: "Order register" })).toBeInTheDocument();
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
});
