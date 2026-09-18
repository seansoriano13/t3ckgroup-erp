import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import RetailPage from "../../pages/retail/index";
import * as AuthContext from "../../context/AuthContext";
import { getRetailQueue, getRetailQueuePendingCount } from "../../services/retailQueueService";
import { opportunityService } from "../../services/opportunityService";
import { commissionService } from "../../services/commissionService";

vi.mock("../../services/retailQueueService", () => ({
  getRetailQueue: vi.fn(),
  getRetailQueuePendingCount: vi.fn(),
  approveQueueItem: vi.fn(),
  dismissQueueItem: vi.fn(),
}));

vi.mock("../../services/opportunityService", () => ({
  opportunityService: { getRetailOpportunities: vi.fn() },
}));

vi.mock("../../services/commissionService", () => ({
  commissionService: { isSalesDirector: vi.fn() },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/retail"]}>
        <RetailPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function signedInAs(user) {
  vi.spyOn(AuthContext, "useAuth").mockReturnValue({ user, isAuthLoading: false });
}

const superAdmin = { id: "emp-sa", name: "Sean", is_super_admin: true };
const plainEmployee = { id: "emp-plain", name: "Rita", is_super_admin: false };

const pendingItem = {
  id: "q1",
  odoo_so_number: "S08286",
  odoo_partner_name: "Shopee T3ck Outdoor",
  odoo_person_name: "Juan Dela Cruz",
  odoo_amount: 1500,
  client_name: "Shopee T3ck Outdoor",
  contact_person: "Juan Dela Cruz",
  expected_value: 1500,
  project_title: "Retail: Shopee T3ck Outdoor",
  status: "pending",
  created_at: "2026-09-10T00:00:00Z",
  deal_owner: null,
  sales_director: null,
  reviewed_by: null,
};

const retailSor = {
  id: "sor-1",
  sales_reference: "S08286",
  client_name: "Shopee T3ck Outdoor",
  project_title: "Retail: Shopee T3ck Outdoor",
  expected_value: 1500,
  registration_date: "2026-09-10",
};

beforeEach(() => {
  getRetailQueue.mockResolvedValue([]);
  getRetailQueuePendingCount.mockResolvedValue(0);
  opportunityService.getRetailOpportunities.mockResolvedValue([]);
  commissionService.isSalesDirector.mockResolvedValue(false);
});

// Issue #170-#174 built these two surfaces as tabs inside the SOR register.
// They moved out to their own page because the register's tab strip was the
// crowded thing, not retail — the queue is a short, bursty list and the
// totals are what the page is actually opened for.
describe("Retail page", () => {
  it("shows the pending-review band above the totals when something is waiting", async () => {
    signedInAs(superAdmin);
    getRetailQueuePendingCount.mockResolvedValue(1);
    getRetailQueue.mockResolvedValue([pendingItem]);
    opportunityService.getRetailOpportunities.mockResolvedValue([retailSor]);

    renderPage();

    expect(await screen.findByRole("heading", { name: /retail orders queue/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /recorded orders/i })).toBeInTheDocument();
  });

  it("hides the band when nothing is pending, but still shows the totals", async () => {
    signedInAs(superAdmin);
    opportunityService.getRetailOpportunities.mockResolvedValue([retailSor]);

    renderPage();

    expect(await screen.findByRole("heading", { name: /recorded orders/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /retail orders queue/i })).not.toBeInTheDocument();
    });
  });

  // Issue #173's gate, carried over unchanged: a Super Admin, or a Sales
  // Director on a live opportunity. Nobody else, because approving a retail
  // order writes an SOR.
  it("refuses an employee who is neither Super Admin nor Sales Director", async () => {
    signedInAs(plainEmployee);
    getRetailQueuePendingCount.mockResolvedValue(1);
    getRetailQueue.mockResolvedValue([pendingItem]);
    opportunityService.getRetailOpportunities.mockResolvedValue([retailSor]);

    renderPage();

    expect(await screen.findByText(/don't have access to retail/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /retail orders queue/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /recorded orders/i })).not.toBeInTheDocument();
  });

  it("admits a Sales Director who is not a Super Admin", async () => {
    signedInAs(plainEmployee);
    commissionService.isSalesDirector.mockResolvedValue(true);
    opportunityService.getRetailOpportunities.mockResolvedValue([retailSor]);

    renderPage();

    expect(await screen.findByRole("heading", { name: /recorded orders/i })).toBeInTheDocument();
  });
});
