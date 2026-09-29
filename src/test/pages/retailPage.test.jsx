import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import RetailPage from "@/pages/retail/index";
import { renderWithProviders } from "@/test/support";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { db } from "@/test/db/store";

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

function queueItem(overrides = {}) {
  return db.seed("odoo_retail_queue", {
    odoo_so_number: "S08286",
    odoo_so_id: 8286,
    odoo_partner_name: "Shopee T3ck Outdoor",
    odoo_person_name: "Juan Dela Cruz",
    odoo_amount: 1500,
    status: "pending",
    client_name: "Shopee T3ck Outdoor",
    contact_person: "Juan Dela Cruz",
    expected_value: 1500,
    project_title: "Retail: Shopee T3ck Outdoor",
    ...overrides,
  });
}

// Issues #170-#174 built these two surfaces as tabs inside the SOR register.
// They moved out to their own page because the register's tab strip was the
// crowded thing, not retail — the queue is a short, bursty list and the totals
// are what the page is actually opened for.
describe("Retail page", () => {
  let superAdmin;
  let plainEmployee;

  beforeEach(() => {
    superAdmin = makeEmployee({ name: "Sean", is_super_admin: true });
    plainEmployee = makeEmployee({ name: "Rita", is_super_admin: false });
    mockUser.current = superAdmin;
  });

  it("shows the pending-review band above the recorded totals", async () => {
    queueItem();
    makeOpportunity({ is_retail: true, client_name: "Shopee T3ck Outdoor", expected_value: 1500 });

    renderPage();

    expect(await screen.findByRole("heading", { name: /retail orders queue/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /recorded orders/i })).toBeInTheDocument();
  });

  // The queue carries a collapsible Dismissed history alongside the review
  // rows. Hiding the whole section when nothing is pending would put that
  // history out of reach exactly when somebody goes looking for it, so the
  // band stays mounted and shows its own empty state.
  it("keeps the queue section mounted when nothing is pending", async () => {
    makeOpportunity({ is_retail: true, client_name: "Lazada Store", expected_value: 900 });

    renderPage();

    expect(await screen.findByRole("heading", { name: /retail orders queue/i })).toBeInTheDocument();
    expect(await screen.findByText(/no pending retail orders/i)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /recorded orders/i })).toBeInTheDocument();
  });

  // The Retail access right (System Access Rights), on by default for SALES.
  // Nobody else, because approving a retail order writes an SOR.
  it("refuses an employee without the Retail access right", async () => {
    mockUser.current = plainEmployee;
    queueItem();

    renderPage();

    expect(await screen.findByText(/don't have access to retail/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /retail orders queue/i })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: /recorded orders/i })).not.toBeInTheDocument();
  });

  it("admits an employee who has the Retail access right", async () => {
    mockUser.current = { ...plainEmployee, has_retail_access: true };

    renderPage();

    expect(await screen.findByRole("heading", { name: /recorded orders/i })).toBeInTheDocument();
  });

  // Being named as a Sales Director no longer opens the screen by itself —
  // the right is what grants it.
  it("does not admit a Sales Director who lacks the right", async () => {
    mockUser.current = plainEmployee;
    makeOpportunity({ sales_director_id: plainEmployee.id, is_retail: false, is_scratch: false });

    renderPage();

    expect(await screen.findByText(/don't have access to retail/i)).toBeInTheDocument();
  });
});
