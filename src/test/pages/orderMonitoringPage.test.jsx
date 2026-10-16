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
