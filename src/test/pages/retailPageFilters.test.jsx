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

let soSerial = 9000;
function retailOrder(overrides = {}) {
  soSerial += 1;
  return db.seed("retail_orders", {
    odoo_so_number: `S0${soSerial}`,
    odoo_so_id: soSerial,
    marketplace: "Shopee",
    partner_name: "Shopee T3ck Outdoor",
    buyer_name: "Juan Dela Cruz",
    odoo_salesperson_name: "Kyla Millan",
    amount: 1500,
    order_income: overrides.amount ?? 1500,
    ordered_at: new Date().toISOString(),
    odoo_state: "sale",
    is_excluded: false,
    ...overrides,
  });
}

// One set of controls drives the Retail report: Marketplace, Storefront,
// salesperson and income status narrow every figure, and a Marketplace Order ID
// finds its order. The filter maths is covered in utils/retailReport.test.js;
// this checks the screen is wired to it.
describe("Retail page filters", () => {
  beforeEach(() => {
    mockUser.current = makeEmployee({ name: "Sean", is_super_admin: true });
  });

  // The first render pays for loading the chart library, which is slow on a busy machine.
  // "Order Income" is also a breakdown and order-table column, so pin the headline label (a <p>).
  const ready = () => screen.findByText("Order Income", { selector: "p" }, { timeout: 5000 });
  /** The big figure under the "Order Income" label (not "This month", not a month group's total). */
  const headline = () => screen.getByText("Order Income", { selector: "p" }).nextElementSibling;

  /** Open the filter chip showing `current` and pick `option`. */
  async function choose(current, option) {
    await userEvent.click(screen.getByText(current));
    await userEvent.click(await screen.findByRole("button", { name: option }));
  }

  it("choosing a Marketplace narrows the headline figure", async () => {
    retailOrder({ amount: 1000 });
    retailOrder({ amount: 3000, marketplace: "Lazada", partner_name: "Lazada Store" });

    renderPage();
    await ready();
    await waitFor(() => expect(headline()).toHaveTextContent(formatPHP(4000)));

    await choose("All Marketplaces", "Lazada");

    await waitFor(() => expect(headline()).toHaveTextContent(formatPHP(3000)));
    // "This month" follows the filter too.
    expect(screen.queryByText(formatPHP(4000))).not.toBeInTheDocument();
    // The Shopee month group and its total are gone too.
    expect(screen.queryByText(formatPHP(1000))).not.toBeInTheDocument();
    expect(screen.queryByText("Shopee")).not.toBeInTheDocument();
  });

  it("narrows the Marketplace breakdown and the chase list with the same filters", async () => {
    retailOrder({ amount: 1000, odoo_salesperson_name: "Kyla Millan" });
    retailOrder({ amount: 700, order_income: null, odoo_salesperson_name: "Kyla Millan" });
    retailOrder({ amount: 3000, marketplace: "Lazada", partner_name: "Lazada Store", odoo_salesperson_name: "Shara Cadiz" });
    retailOrder({
      amount: 900,
      order_income: null,
      marketplace: "Lazada",
      partner_name: "Lazada Store",
      odoo_salesperson_name: "Shara Cadiz",
    });

    renderPage();
    await ready();
    const breakdown = await screen.findByRole("table", { name: "Marketplace breakdown" });
    const chase = screen.getByRole("region", { name: "Missing / Suspect income" });
    await waitFor(() => expect(within(breakdown).getByText("Shopee")).toBeInTheDocument());
    expect(within(breakdown).getByText("Lazada")).toBeInTheDocument();
    expect(within(chase).getByText("Kyla Millan")).toBeInTheDocument();
    expect(within(chase).getByText("Shara Cadiz")).toBeInTheDocument();

    await choose("All Marketplaces", "Lazada");

    await waitFor(() => expect(within(breakdown).queryByText("Shopee")).not.toBeInTheDocument());
    expect(within(breakdown).getByText("Lazada")).toBeInTheDocument();
    expect(within(chase).queryByText("Kyla Millan")).not.toBeInTheDocument();
    expect(within(chase).getByText("Shara Cadiz")).toBeInTheDocument();
    expect(within(chase).getByText(`1 to chase · ${formatPHP(900)} Order Amount`)).toBeInTheDocument();
  });

  it("choosing a salesperson narrows the figures", async () => {
    retailOrder({ amount: 1000, odoo_salesperson_name: "Kyla Millan" });
    retailOrder({ amount: 3000, odoo_salesperson_name: "Shara Cadiz" });

    renderPage();
    await ready();
    await waitFor(() => expect(headline()).toHaveTextContent(formatPHP(4000)));

    await choose("All Salespeople", "Shara Cadiz");

    await waitFor(() => expect(headline()).toHaveTextContent(formatPHP(3000)));
  });

  it("choosing a Storefront narrows the figures, and offers only the chosen Marketplace's Storefronts", async () => {
    retailOrder({ amount: 1000, partner_name: "Shopee T3ck Outdoor" });
    retailOrder({ amount: 2000, partner_name: "Shopee Koveaprestige" });
    retailOrder({ amount: 5000, marketplace: "Lazada", partner_name: "Lazada Store" });

    renderPage();
    await ready();
    await waitFor(() => expect(headline()).toHaveTextContent(formatPHP(8000)));

    await choose("All Marketplaces", "Shopee");
    await waitFor(() => expect(headline()).toHaveTextContent(formatPHP(3000)));
    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    await userEvent.click(await screen.findByText("All Storefronts"));
    expect(screen.queryByRole("button", { name: "Lazada Store" })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Shopee Koveaprestige" }));

    await waitFor(() => expect(headline()).toHaveTextContent(formatPHP(2000)));
  });

  it("choosing a status narrows the figures and the Missing line follows", async () => {
    retailOrder({ amount: 1000, order_income: 800 });
    retailOrder({ amount: 2000, order_income: null });
    retailOrder({ amount: 500, order_income: null });

    renderPage();
    await ready();
    expect(await screen.findByText(/Missing income: 2 orders/)).toBeInTheDocument();

    await choose("All Statuses", "OK");

    await waitFor(() => expect(screen.getByText(/Missing income: 0 orders/)).toBeInTheDocument());
    expect(screen.getAllByText(formatPHP(800)).length).toBeGreaterThan(0);
  });

  it("finds an order by its Marketplace Order ID, however old it is", async () => {
    retailOrder({ marketplace_order_id: "2609020BTB5E8F", buyer_name: "Ana Reyes" });
    retailOrder({ marketplace_order_id: "7700123456", buyer_name: "Ben Santos" });
    retailOrder({
      marketplace_order_id: "2301010OLDONE",
      buyer_name: "Old Buyer",
      ordered_at: "2023-01-01T04:00:00.000Z",
    });

    renderPage();
    await ready();
    expect(screen.queryByText("Ana Reyes")).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: /marketplace order id/i }), "2609020btb");

    // The matching order's month opens by itself, and the others are gone.
    expect(await screen.findByText("2609020BTB5E8F")).toBeInTheDocument();
    expect(screen.getByText("Ana Reyes")).toBeInTheDocument();
    expect(screen.queryByText("Ben Santos")).not.toBeInTheDocument();

    // An ID older than the default 3-month range is found too.
    await userEvent.clear(screen.getByRole("textbox", { name: /marketplace order id/i }));
    await userEvent.type(screen.getByRole("textbox", { name: /marketplace order id/i }), "2301010OLDONE");
    expect(await screen.findByText("Old Buyer")).toBeInTheDocument();
    expect(screen.queryByText("Ana Reyes")).not.toBeInTheDocument();
  });

  it("says so when nothing matches, and Clear all brings every order back", async () => {
    retailOrder({ amount: 1000, marketplace_order_id: "2609020BTB5E8F" });

    renderPage();
    await ready();
    expect((await screen.findAllByText(formatPHP(1000))).length).toBeGreaterThan(0);

    await userEvent.type(screen.getByRole("textbox", { name: /marketplace order id/i }), "nope");
    expect((await screen.findAllByText(/no retail orders match/i)).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: /clear all/i }));
    await waitFor(() => expect(screen.queryByText(/no retail orders match/i)).not.toBeInTheDocument());
    expect(screen.getAllByText(formatPHP(1000)).length).toBeGreaterThan(0);
  });
});
