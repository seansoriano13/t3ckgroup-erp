import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import RetailPage from "@/pages/retail/index";
import { renderWithProviders } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { formatPHP } from "@/constants/sor";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

function renderPage() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/retail"]}>
      <RetailPage />
    </MemoryRouter>
  );
}

let soSerial = 8000;
function retailOrder(overrides = {}) {
  soSerial += 1;
  return db.seed("retail_orders", {
    odoo_so_number: `S0${soSerial}`,
    odoo_so_id: soSerial,
    storefront: "Shopee",
    partner_name: "Shopee T3ck Outdoor",
    buyer_name: "Juan Dela Cruz",
    amount: 1500,
    ordered_at: new Date().toISOString(),
    odoo_state: "sale",
    is_excluded: false,
    ...overrides,
  });
}

// Retail is a report: orders synced from Odoo into `retail_orders`, read-only.
// The approval queue that used to sit above the totals is hidden.
describe("Retail page", () => {
  let superAdmin;
  let plainEmployee;

  beforeEach(() => {
    superAdmin = makeEmployee({ name: "Sean", is_super_admin: true });
    plainEmployee = makeEmployee({ name: "Rita", is_super_admin: false });
    mockUser.current = superAdmin;
  });

  it("totals the orders in range", async () => {
    retailOrder({ amount: 1000 });
    retailOrder({ amount: 3000, storefront: "Lazada", partner_name: "Lazada Store" });

    renderPage();

    // The first render pays for loading the chart library, which is slow on a busy machine.
    expect(await screen.findByRole("heading", { name: /retail overview/i }, { timeout: 5000 })).toBeInTheDocument();
    // Total sales and This month both read 4,000; the average order is 2,000.
    expect((await screen.findAllByText(formatPHP(4000))).length).toBeGreaterThan(0);
    expect(screen.getByText(formatPHP(2000))).toBeInTheDocument();
    expect(screen.getByText("Total sales")).toBeInTheDocument();
    expect(screen.getByText("Orders")).toBeInTheDocument();
  });

  it("leaves out a quotation, a cancelled order and one dismissed in the old queue", async () => {
    retailOrder({ amount: 1000 });
    retailOrder({ amount: 7000, odoo_state: "cancel" });
    retailOrder({ amount: 9000, is_excluded: true });
    retailOrder({ amount: 5000, odoo_state: "draft" });

    renderPage();

    expect((await screen.findAllByText(formatPHP(1000))).length).toBeGreaterThan(0);
    expect(screen.queryByText(formatPHP(7000))).not.toBeInTheDocument();
    expect(screen.queryByText(formatPHP(9000))).not.toBeInTheDocument();
    expect(screen.queryByText(formatPHP(5000))).not.toBeInTheDocument();
    expect(screen.queryByText(formatPHP(22000))).not.toBeInTheDocument();
  });

  it("shows an empty state when nothing has been synced", async () => {
    renderPage();

    expect((await screen.findAllByText(/no retail orders in this range/i)).length).toBeGreaterThan(0);
  });

  it("no longer offers approvals", async () => {
    db.seed("odoo_retail_queue", {
      odoo_so_number: "S08286",
      odoo_so_id: 8286,
      odoo_partner_name: "Shopee T3ck Outdoor",
      odoo_amount: 1500,
      status: "pending",
    });
    retailOrder();

    renderPage();

    expect(await screen.findByRole("heading", { name: /retail overview/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /retail orders queue/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
  });

  // The Retail access right (System Access Rights), on by default for SALES.
  it("refuses an employee without the Retail access right", async () => {
    mockUser.current = plainEmployee;
    retailOrder();

    renderPage();

    expect(await screen.findByText(/don't have access to retail/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /retail overview/i })).not.toBeInTheDocument();
    });
  });

  it("admits an employee who has the Retail access right", async () => {
    mockUser.current = { ...plainEmployee, has_retail_access: true };

    renderPage();

    expect(await screen.findByRole("heading", { name: /retail overview/i })).toBeInTheDocument();
  });

  // Being named as a Sales Director no longer opens the screen by itself —
  // the right is what grants it.
  it("does not admit a Sales Director who lacks the right", async () => {
    mockUser.current = plainEmployee;

    renderPage();

    expect(await screen.findByText(/don't have access to retail/i)).toBeInTheDocument();
  });
});
