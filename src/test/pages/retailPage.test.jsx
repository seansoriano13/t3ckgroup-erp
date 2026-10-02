import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    marketplace: "Shopee",
    partner_name: "Shopee T3ck Outdoor",
    buyer_name: "Juan Dela Cruz",
    amount: 1500,
    order_income: overrides.amount ?? 1500,
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
    retailOrder({ amount: 3000, marketplace: "Lazada", partner_name: "Lazada Store" });

    renderPage();

    // The first render pays for loading the chart library, which is slow on a busy machine.
    expect(await screen.findByText("Order Income", { selector: "p" }, { timeout: 5000 })).toBeInTheDocument();
    // Order Income and This month both read 4,000; the average is 2,000.
    expect((await screen.findAllByText(formatPHP(4000))).length).toBeGreaterThan(0);
    expect(screen.getByText(formatPHP(2000))).toBeInTheDocument();
    expect(screen.getByText("Orders", { selector: "dt" })).toBeInTheDocument();
  });

  it("headlines Order Income from OK orders and reports the Missing line", async () => {
    retailOrder({ amount: 1000, order_income: 800 });
    retailOrder({ amount: 2000, order_income: null });
    retailOrder({ amount: 500, order_income: null });

    renderPage();

    expect(await screen.findByText("Order Income", { selector: "p" }, { timeout: 5000 })).toBeInTheDocument();
    expect((await screen.findAllByText(formatPHP(800))).length).toBeGreaterThan(0);
    expect(screen.getByText(/Missing income: 2 orders · .*2,500.* Order Amount/)).toBeInTheDocument();
    expect(screen.queryByText("Total sales")).not.toBeInTheDocument();
  });

  it("badges Suspect differently from Missing", async () => {
    retailOrder({ amount: 1000, order_income: 1200 });
    retailOrder({ amount: 700, order_income: null });
    retailOrder({ amount: 600, order_income: 500 });

    renderPage();

    const toggles = await screen.findAllByRole("button", { name: /order/i }, { timeout: 5000 });
    await userEvent.click(toggles[0]);
    const suspect = screen.getByText("Suspect");
    const missing = screen.getByText("Missing");
    const ok = screen.getByText("OK");
    expect(suspect.className).not.toBe(missing.className);
    expect(ok.className).not.toBe(missing.className);
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

  it("shows Marketplace Order ID, Salesperson, Fee and Order Income in an order table", async () => {
    retailOrder({
      amount: 1500,
      odoo_salesperson_name: "Rita Reyes",
      marketplace_order_id: "2609020BTB5E8F",
      marketplace_fee: 123.45,
      order_income: 1376.55,
    });
    retailOrder({ amount: 900, marketplace_order_id: null, marketplace_fee: null, order_income: null });

    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /order/i }, { timeout: 5000 }));
    // The Marketplace breakdown has its own Order Income / Marketplace Fees, so read the order table alone.
    const orderTable = within(screen.getByRole("columnheader", { name: "Marketplace Order ID" }).closest("table"));
    for (const heading of ["Marketplace Order ID", "Salesperson", "Marketplace Fee", "Order Income", "Order Amount"]) {
      expect(orderTable.getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }
    expect(orderTable.getByText("2609020BTB5E8F")).toBeInTheDocument();
    expect(orderTable.getByText("Rita Reyes")).toBeInTheDocument();
    expect(orderTable.getByText(formatPHP(123.45))).toBeInTheDocument();
    expect(orderTable.getAllByText(formatPHP(1376.55)).length).toBeGreaterThan(0);
  });

  it("breaks Order Income down by Marketplace, rolling a Marketplace's Storefronts into one row", async () => {
    retailOrder({ partner_name: "Shopee T3ck Outdoor", amount: 1000, marketplace_fee: 100, order_income: 900 });
    retailOrder({ partner_name: "Shopee Koveaprestige", amount: 2000, marketplace_fee: 300, order_income: 1700 });
    retailOrder({ marketplace: "Lazada", partner_name: "Lazada Store", amount: 500, marketplace_fee: null, order_income: 450 });
    retailOrder({ marketplace: "Lazada", partner_name: "Lazada Store", amount: 800, order_income: null });

    renderPage();

    const table = await screen.findByRole("table", { name: /marketplace breakdown/i }, { timeout: 5000 });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Marketplace",
      "Order Income",
      "Orders",
      "Average order income",
      "Marketplace Fees",
      "Fee rate",
      "Missing Income",
    ]);
    const cells = (name) =>
      within(within(table).getByRole("row", { name }))
        .getAllByRole("cell")
        .map((c) => c.textContent);
    // Two Shopee Storefronts, one Shopee row; 400 ÷ (400 + 2,600) is 13.3%.
    expect(cells(/^Shopee/)).toEqual([
      "Shopee",
      formatPHP(2600),
      "2",
      formatPHP(1300),
      formatPHP(400),
      "13.3%",
      "0",
    ]);
    // No Lazada order has both a fee and an income, so no rate; one is Missing.
    expect(cells(/^Lazada/)).toEqual(["Lazada", formatPHP(450), "2", formatPHP(450), formatPHP(0), "—", "1"]);
  });

  it("shows no Marketplace breakdown rows when nothing is in range", async () => {
    renderPage();

    expect(await screen.findByText("No orders to break down in this range")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /marketplace breakdown/i })).not.toBeInTheDocument();
  });

  describe("Missing / Suspect income chase list", () => {
    const findChase = async () =>
      within(await screen.findByRole("region", { name: "Missing / Suspect income" }, { timeout: 5000 }));

    it("groups the flagged orders by salesperson, with a count and total per group and a grand total", async () => {
      retailOrder({ amount: 1000, order_income: null, odoo_salesperson_name: "Rita Reyes" });
      retailOrder({ amount: 500, order_income: 600, odoo_salesperson_name: "Rita Reyes" });
      retailOrder({ amount: 250, order_income: null, odoo_salesperson_name: "Ben Cruz" });
      // Not chased: income is in, and a cancelled order is not a sale.
      retailOrder({ amount: 4000, order_income: 3000, odoo_salesperson_name: "Rita Reyes" });
      retailOrder({ amount: 777, order_income: null, odoo_salesperson_name: "Ben Cruz", odoo_state: "cancel" });

      renderPage();

      const chase = await findChase();
      expect(chase.getByText(`3 to chase · ${formatPHP(1750)} Order Amount`)).toBeInTheDocument();
      const [first, second] = chase.getAllByRole("button");
      expect(first).toHaveTextContent("Rita Reyes");
      expect(first).toHaveTextContent("2 to chase");
      expect(first).toHaveTextContent(formatPHP(1500));
      expect(second).toHaveTextContent("Ben Cruz");
      expect(second).toHaveTextContent("1 to chase");
      expect(second).toHaveTextContent(formatPHP(250));
    });

    it("shows each flagged order with its details, its status and a link to that order in Odoo", async () => {
      retailOrder({
        odoo_so_number: "S08501",
        odoo_so_id: 501,
        odoo_salesperson_name: "Rita Reyes",
        buyer_name: "Juan Dela Cruz",
        marketplace_order_id: "2609020BTB5E8F",
        amount: 1000,
        order_income: null,
      });
      retailOrder({
        odoo_so_number: "S08502",
        odoo_so_id: 502,
        odoo_salesperson_name: "Rita Reyes",
        buyer_name: "Maria Santos",
        amount: 500,
        marketplace_fee: 40,
        order_income: 600,
      });

      renderPage();

      const chase = await findChase();
      await userEvent.click(chase.getByRole("button", { name: /Rita Reyes/ }));

      const missingRow = chase.getByRole("row", { name: /S08501/ });
      expect(within(missingRow).getByText("2609020BTB5E8F")).toBeInTheDocument();
      expect(within(missingRow).getByText("Juan Dela Cruz")).toBeInTheDocument();
      expect(within(missingRow).getByText(formatPHP(1000))).toBeInTheDocument();
      const missingBadge = within(missingRow).getByText("Missing");

      const suspectRow = chase.getByRole("row", { name: /S08502/ });
      expect(within(suspectRow).getByText("Maria Santos")).toBeInTheDocument();
      expect(within(suspectRow).getByText(formatPHP(500))).toBeInTheDocument();
      expect(within(suspectRow).getByText(formatPHP(40))).toBeInTheDocument();
      expect(within(suspectRow).getByText(formatPHP(600))).toBeInTheDocument();
      const suspectBadge = within(suspectRow).getByText("Suspect");
      expect(suspectBadge.className).not.toBe(missingBadge.className);

      // Each order opens its own sale order, in a new tab.
      const missingLink = within(missingRow).getByRole("link", { name: /open in odoo/i });
      expect(missingLink).toHaveAttribute(
        "href",
        "https://t3ckgrouponline.odoo.com/web#id=501&model=sale.order&view_type=form",
      );
      expect(missingLink).toHaveAttribute("target", "_blank");
      expect(within(suspectRow).getByRole("link", { name: /open in odoo/i })).toHaveAttribute(
        "href",
        "https://t3ckgrouponline.odoo.com/web#id=502&model=sale.order&view_type=form",
      );
    });

    it("offers no link for an order the sync has not given an Odoo id", async () => {
      retailOrder({
        odoo_so_number: "S08503",
        odoo_so_id: null,
        odoo_salesperson_name: "Rita Reyes",
        order_income: null,
      });

      renderPage();

      const chase = await findChase();
      await userEvent.click(chase.getByRole("button", { name: /Rita Reyes/ }));
      expect(within(chase.getByRole("row", { name: /S08503/ })).queryByRole("link")).not.toBeInTheDocument();
    });

    it("gathers orders with no salesperson into their own group", async () => {
      retailOrder({ amount: 300, order_income: null, odoo_salesperson_name: null });

      renderPage();

      const chase = await findChase();
      expect(chase.getByRole("button", { name: /No salesperson/ })).toHaveTextContent(formatPHP(300));
    });

    it("follows the time range", async () => {
      const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
      retailOrder({ amount: 100, order_income: null, odoo_salesperson_name: "Rita Reyes" });
      retailOrder({ amount: 900, order_income: null, odoo_salesperson_name: "Rita Reyes", ordered_at: daysAgo(40) });

      renderPage();

      const chase = await findChase();
      expect(chase.getByText(`2 to chase · ${formatPHP(1000)} Order Amount`)).toBeInTheDocument();

      await userEvent.click(screen.getByRole("tab", { name: "30 days" }));
      expect(chase.getByText(`1 to chase · ${formatPHP(100)} Order Amount`)).toBeInTheDocument();
    });

    it("says so when every order has its income", async () => {
      retailOrder({ amount: 1000, order_income: 900 });

      renderPage();

      const chase = await findChase();
      expect(chase.getByText(/nothing to chase/i)).toBeInTheDocument();
      expect(chase.queryByRole("button")).not.toBeInTheDocument();
    });
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

    expect(await screen.findByText("Order Income", { selector: "p" })).toBeInTheDocument();
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
      expect(screen.queryByText("Order Income")).not.toBeInTheDocument();
    });
  });

  it("admits an employee who has the Retail access right", async () => {
    mockUser.current = { ...plainEmployee, has_retail_access: true };

    renderPage();

    expect(await screen.findByText("Order Income", { selector: "p" })).toBeInTheDocument();
  });

  // Being named as a Sales Director no longer opens the screen by itself —
  // the right is what grants it.
  it("does not admit a Sales Director who lacks the right", async () => {
    mockUser.current = plainEmployee;

    renderPage();

    expect(await screen.findByText(/don't have access to retail/i)).toBeInTheDocument();
  });
});
