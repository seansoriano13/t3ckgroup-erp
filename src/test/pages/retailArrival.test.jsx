import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import RetailPage from "@/pages/retail/index";
import { renderWithProviders } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

let serial = 9000;
function retailOrder(overrides = {}) {
  serial += 1;
  return db.seed("retail_orders", {
    odoo_so_number: `S0${serial}`,
    odoo_so_id: serial,
    marketplace: "Shopee",
    partner_name: "Shopee T3ck Outdoor",
    buyer_name: "Juan Dela Cruz",
    amount: 1500,
    order_income: 1200,
    ordered_at: new Date().toISOString(),
    odoo_state: "sale",
    is_excluded: false,
    ...overrides,
  });
}

// The realtime socket is inert under test (docs/realtime-policy.md "Testing"),
// so the broadcast is stood in for by invalidating the query the hook would.
describe("Retail page: a new order arriving", () => {
  beforeEach(() => {
    mockUser.current = makeEmployee({ name: "Sean", is_super_admin: true });
  });

  it("highlights the month it lands in, and not what was already on screen", async () => {
    retailOrder();
    const { client } = renderWithProviders(
      <MemoryRouter initialEntries={["/retail"]}>
        <RetailPage />
      </MemoryRouter>,
    );

    const header = await screen.findByRole("button", { name: /1 order/i }, { timeout: 5000 });
    expect(header).not.toHaveAttribute("data-arrived");

    retailOrder();
    await act(() => client.invalidateQueries({ queryKey: ["retailOrders"] }));

    await waitFor(() => expect(screen.getByRole("button", { name: /2 orders/i })).toHaveAttribute("data-arrived"));

    await userEvent.click(screen.getByRole("button", { name: /2 orders/i }));
    const rows = screen.getAllByRole("row").filter((row) => row.hasAttribute("data-arrived"));
    expect(rows).toHaveLength(1);
  });
});
