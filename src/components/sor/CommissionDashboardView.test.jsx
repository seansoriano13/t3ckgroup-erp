import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import CommissionDashboardView from "./CommissionDashboardView";
import { commissionService } from "../../services/commissionService";
import * as AuthContext from "../../context/AuthContext";

const mockNavigate = vi.fn();
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => mockNavigate,
}));

vi.mock("../../services/commissionService", () => ({
  commissionService: {
    getCommissionDashboardData: vi.fn(),
    listRateHistory: vi.fn(),
    getSplitsForProjectType: vi.fn(),
    isSalesDirector: vi.fn(),
    saveSplitsForProjectType: vi.fn(),
  },
}));

function renderView({ path = "/sors/commission", state } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: path.split("?")[0], search: path.includes("?") ? `?${path.split("?")[1]}` : "", state }]}>
        <CommissionDashboardView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const asUser = (user) => vi.spyOn(AuthContext, "useAuth").mockReturnValue({ user });
const superAdmin = { id: "user-admin", is_super_admin: true, name: "Admin Boss" };
const aliceUser = { id: "user-alice", name: "Alice Rep", is_super_admin: false, is_head: false, department: "Sales" };

const alice = { id: "user-alice", name: "Alice Rep", avatarPath: null };
const bob = { id: "user-bob", name: "Bob Rep", avatarPath: null };

function deal(overrides) {
  return {
    status: "AWARDED",
    projectType: "SSP",
    contractDate: "2026-02-10",
    createdAt: "2026-01-15",
    contractValue: 1000000,
    rates: { vatPercent: 12, withholdingPercent: 8, poolPercent: 1 },
    commissionableRevenue: 821428.57,
    commissionPool: 8214.29,
    salesShareAmount: 4107.14,
    unattributedSalesAmount: 0,
    salesRoleShares: [{ role: "deal_owner", employee: alice, amount: 4107.14, percent: 100 }],
    participants: { dealOwner: alice, support1: null, support2: null, salesDirector: null },
    ...overrides,
  };
}

const alpha = deal({ id: "opp-1", opportunityNo: "SOR-001", projectTitle: "Alpha Corp Solution", clientName: "Alpha Corp" });
const beta = deal({
  id: "opp-2",
  opportunityNo: "SOR-002",
  projectTitle: "Beta Corp Rollout",
  clientName: "Beta Corp",
  status: "CLOSED_WON",
  projectType: "CP",
  contractDate: "2026-03-01",
  contractValue: 2000000,
  commissionableRevenue: 1642857.14,
  commissionPool: 16428.57,
  salesShareAmount: 8214.29,
  salesRoleShares: [
    { role: "deal_owner", employee: bob, amount: 4928.57, percent: 60 },
    { role: "supporting_salesperson", employee: alice, amount: 3285.71, percent: 40 },
  ],
  participants: { dealOwner: bob, support1: alice, support2: null, salesDirector: null },
});

const dashboardData = (dealLedger = [alpha, beta]) => ({
  totalDealsCount: dealLedger.length,
  wonDealsCount: dealLedger.length,
  totalCommissionableRevenue: 2464285.71,
  totalCommissionPool: 24642.86,
  salesDeptTotal: 12321.43,
  departmentTotals: [
    { name: "Sales", allocationPercent: 50, amount: 12321.43, isSales: true },
    { name: "Operations", allocationPercent: 25, amount: 6160.71, isSales: false },
    { name: "Administration", allocationPercent: 15, amount: 3696.43, isSales: false },
    { name: "Human Resources", allocationPercent: 5, amount: 1232.14, isSales: false },
    { name: "Finance & Accounting", allocationPercent: 5, amount: 1232.14, isSales: false },
  ],
  salesEmployees: [
    { employeeId: "user-alice", name: "Alice Rep", avatarPath: null, wonDealsCount: 2, totalDealsCount: 2, totalCommissionShare: 9035.71, roleBreakdown: { deal_owner: 4107.14, supporting_salesperson: 4928.57, sales_director: 0 } },
    { employeeId: "user-bob", name: "Bob Rep", avatarPath: null, wonDealsCount: 1, totalDealsCount: 1, totalCommissionShare: 3285.71, roleBreakdown: { deal_owner: 3285.71, supporting_salesperson: 0, sales_director: 0 } },
  ],
  dealLedger,
});

const SPLITS = {
  SSP: [{ shareRole: "deal_owner", percent: 80 }, { shareRole: "sales_director", percent: 20 }],
  CP: [{ shareRole: "deal_owner", percent: 60 }, { shareRole: "supporting_salesperson", percent: 20 }, { shareRole: "sales_director", percent: 20 }],
  STRATEGIC: [{ shareRole: "deal_owner", percent: 40 }, { shareRole: "closing_salesperson", percent: 20 }, { shareRole: "supporting_salesperson", percent: 20 }, { shareRole: "sales_director", percent: 20 }],
};

describe("CommissionDashboardView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commissionService.getCommissionDashboardData.mockResolvedValue(dashboardData());
    commissionService.listRateHistory.mockResolvedValue([
      { rate_type: "VAT", percent: 12 },
      { rate_type: "WITHHOLDING", percent: 8 },
      { rate_type: "POOL", percent: 1 },
    ]);
    commissionService.getSplitsForProjectType.mockImplementation((pt) => Promise.resolve(SPLITS[pt]));
    commissionService.isSalesDirector.mockResolvedValue(false);
  });

  describe("on PageShell (Report page)", () => {
    it("puts the time range in the header and the tabs in the tabs slot", async () => {
      asUser(superAdmin);
      renderView();

      const header = (await screen.findByRole("heading", { name: /Commission\s*Pool/ })).closest("div.border-b");
      expect(within(header).getByRole("combobox", { name: /period/i })).toBeInTheDocument();
      expect(within(screen.getByTestId("page-tabs")).getByRole("tab", { name: "Formula" })).toBeInTheDocument();
    });

    it("shows the headline figure without a gradient card", async () => {
      asUser(superAdmin);
      const { container } = renderView();

      await screen.findByText("₱24,642.86");
      expect(container.innerHTML).not.toMatch(/bg-linear|bg-gradient/);
    });
  });

  describe("Pool tab", () => {
    it("shows the pool, the Sales fund and the CSV export to Finance & Accounting / Super Admin", async () => {
      asUser(superAdmin);
      renderView();

      expect(await screen.findByText("₱24,642.86")).toBeInTheDocument();
      expect(screen.getByText("₱12,321.43")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Export CSV/i })).toBeInTheDocument();
    });

    it("masks the pool and peers' amounts for a standard sales rep, but shows their own", async () => {
      asUser(aliceUser);
      renderView();

      await screen.findByText("SOR-001");
      expect(screen.queryByText("₱24,642.86")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Export CSV/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("tab", { name: /People/ }));
      expect(screen.getByText("₱9,035.71")).toBeInTheDocument();
      expect(screen.queryByText("₱3,285.71")).not.toBeInTheDocument();
    });

    it("filters SORs by search", async () => {
      asUser(superAdmin);
      renderView();

      await screen.findByText("SOR-001");
      fireEvent.change(screen.getByPlaceholderText(/Search SORs/i), { target: { value: "Beta" } });

      expect(screen.queryByText("SOR-001")).not.toBeInTheDocument();
      expect(screen.getByText("SOR-002")).toBeInTheDocument();
    });

    it("pages the SOR list ten at a time", async () => {
      const many = Array.from({ length: 12 }, (_, i) => deal({ id: `opp-${i}`, opportunityNo: `SOR-1${String(i).padStart(2, "0")}`, clientName: `Client ${i}` }));
      commissionService.getCommissionDashboardData.mockResolvedValue(dashboardData(many));
      asUser(superAdmin);
      renderView();

      await screen.findByText("SOR-100");
      expect(screen.getByText("1–10")).toBeInTheDocument();
      expect(screen.queryByText("SOR-111")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      expect(screen.getByText("11–12")).toBeInTheDocument();
      expect(screen.getByText("SOR-111")).toBeInTheDocument();
    });

    it("downloads the ledger as CSV", async () => {
      const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
      global.URL.createObjectURL = createObjectURL;
      global.URL.revokeObjectURL = vi.fn();
      asUser(superAdmin);
      renderView();

      fireEvent.click(await screen.findByRole("button", { name: /Export CSV/i }));
      expect(createObjectURL).toHaveBeenCalled();
    });

    it("refetches for the Projected scope", async () => {
      asUser(superAdmin);
      renderView();

      fireEvent.click(await screen.findByRole("button", { name: "Projected" }));
      await waitFor(() => {
        expect(commissionService.getCommissionDashboardData).toHaveBeenCalledWith(expect.objectContaining({ scope: "FORECAST" }));
      });
    });

    it("opens a SOR's receipt from its row, and the receipt opens the SOR", async () => {
      asUser(superAdmin);
      renderView();

      fireEvent.click((await screen.findByText("SOR-002")).closest("tr"));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("Beta Corp")).toBeInTheDocument();
      expect(within(dialog).getByText("How the pool is worked out")).toBeInTheDocument();
      expect(within(dialog).getByText("Bob Rep")).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole("button", { name: /Open SOR/ }));
      expect(mockNavigate).toHaveBeenCalledWith("/sors", { state: { openOpportunityId: "opp-2" } });
    });

    it("opens the linked SOR's receipt when arriving from a SOR", async () => {
      asUser(superAdmin);
      renderView({ state: { openOpportunityId: "opp-1" } });

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("Alpha Corp")).toBeInTheDocument();
    });

    it("sends a person's row to the SOR Register filtered to them", async () => {
      asUser(superAdmin);
      renderView();

      await screen.findByText("SOR-001");
      fireEvent.click(screen.getByRole("tab", { name: /People/ }));
      fireEvent.click(screen.getByText("Alice Rep").closest("tr"));
      expect(mockNavigate).toHaveBeenCalledWith("/sors", { state: { filterEmployeeId: "user-alice" } });
    });
  });

  describe("Formula tab", () => {
    it("shows the rates, the departments and each Project Type's split", async () => {
      asUser(aliceUser);
      renderView({ path: "/sors/commission?tab=formula" });

      expect((await screen.findAllByText("Pool rate")).length).toBeGreaterThan(0);
      expect(screen.getByText("Operations")).toBeInTheDocument();

      fireEvent.click(await screen.findByRole("button", { name: /Collaborative Project/ }));
      await waitFor(() => expect(screen.getAllByText("60%").length).toBeGreaterThan(0));
      expect(screen.queryByRole("button", { name: /Save split/ })).not.toBeInTheDocument();
    });

    it("lets a Sales Director change and save a split", async () => {
      commissionService.isSalesDirector.mockResolvedValue(true);
      commissionService.saveSplitsForProjectType.mockResolvedValue(SPLITS.SSP);
      asUser(aliceUser);
      renderView({ path: "/sors/commission?tab=formula" });

      fireEvent.click(await screen.findByRole("button", { name: /Single Salesperson Project/ }));
      const owner = await screen.findByLabelText("Deal Owner percent");
      fireEvent.change(owner, { target: { value: "70" } });
      fireEvent.change(screen.getByLabelText("Sales Director percent"), { target: { value: "30" } });
      fireEvent.click(screen.getByRole("button", { name: /Save split/ }));

      await waitFor(() => {
        expect(commissionService.saveSplitsForProjectType).toHaveBeenCalledWith(
          "SSP",
          [{ shareRole: "deal_owner", percent: 70 }, { shareRole: "sales_director", percent: 30 }],
          "user-alice",
        );
      });
    });

    it("works the formula through for a typed contract value", async () => {
      asUser(aliceUser);
      renderView({ path: "/sors/commission?tab=formula" });

      const input = await screen.findByLabelText("Contract value");
      fireEvent.change(input, { target: { value: "1120000" } });
      // 1,120,000 ÷ 1.12 = 1,000,000; less 8% = 920,000 commissionable; 1% = 9,200 pool.
      expect(await screen.findByText("₱920,000.00")).toBeInTheDocument();
      expect(screen.getByText("₱9,200.00")).toBeInTheDocument();
    });
  });
});
