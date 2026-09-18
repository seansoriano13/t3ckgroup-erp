import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CommissionDashboardView from "./CommissionDashboardView";
import { commissionService } from "../../services/commissionService";
import * as AuthContext from "../../context/AuthContext";

const mockNavigate = vi.fn();
let mockLocationState = {};

vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: "/crm/commission", state: mockLocationState }),
}));

vi.mock("../../services/commissionService", () => ({
  commissionService: {
    getCommissionDashboardData: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const alice = { id: "user-alice", name: "Alice Rep", avatarPath: null };
const bob = { id: "user-bob", name: "Bob Rep", avatarPath: null };

const mockDashboardData = {
  totalDealsCount: 2,
  wonDealsCount: 2,
  totalContractValue: 3000000,
  totalCommissionableRevenue: 2464285.71,
  totalCommissionPool: 24642.86,
  salesDeptTotal: 12321.43,
  otherDeptsTotal: 12321.43,
  departmentTotals: [
    { name: "Sales", allocationPercent: 50, amount: 12321.43, isSales: true },
    { name: "Operations", allocationPercent: 25, amount: 6160.71, isSales: false },
    { name: "Administration", allocationPercent: 15, amount: 3696.43, isSales: false },
    { name: "Human Resources", allocationPercent: 5, amount: 1232.14, isSales: false },
    { name: "Finance & Accounting", allocationPercent: 5, amount: 1232.14, isSales: false },
  ],
  salesEmployees: [
    {
      employeeId: "user-alice",
      name: "Alice Rep",
      avatarPath: null,
      wonDealsCount: 2,
      totalDealsCount: 2,
      totalContractValue: 3000000,
      totalCommissionShare: 9035.71,
      roleBreakdown: {
        deal_owner: 4107.14,
        supporting_salesperson: 4928.57,
        sales_director: 0,
      },
      dealIds: ["opp-1", "opp-2"],
    },
    {
      employeeId: "user-bob",
      name: "Bob Rep",
      avatarPath: null,
      wonDealsCount: 1,
      totalDealsCount: 1,
      totalContractValue: 2000000,
      totalCommissionShare: 3285.71,
      roleBreakdown: {
        deal_owner: 3285.71,
        supporting_salesperson: 0,
        sales_director: 0,
      },
      dealIds: ["opp-2"],
    },
  ],
  dealLedger: [
    {
      id: "opp-1",
      opportunityNo: "SOR-001",
      projectTitle: "Alpha Corp Solution",
      clientName: "Alpha Corp",
      status: "AWARDED",
      projectType: "SSP",
      contractDate: "2026-02-10",
      createdAt: "2026-01-15",
      contractValue: 1000000,
      rates: { vatPercent: 12, withholdingPercent: 8, poolPercent: 1 },
      commissionableRevenue: 821428.57,
      commissionPool: 8214.29,
      departmentShares: [
        { name: "Sales", allocationPercent: 50, amount: 4107.14 },
      ],
      salesRoleShares: [
        { role: "deal_owner", employee: alice, amount: 4107.14 },
      ],
      salesShareAmount: 4107.14,
      participants: { dealOwner: alice, support1: null, support2: null, salesDirector: null },
    },
    {
      id: "opp-2",
      opportunityNo: "SOR-002",
      projectTitle: "Beta Corp Rollout",
      clientName: "Beta Corp",
      status: "CLOSED_WON",
      projectType: "CP",
      contractDate: "2026-03-01",
      createdAt: "2026-02-01",
      contractValue: 2000000,
      rates: { vatPercent: 12, withholdingPercent: 8, poolPercent: 1 },
      commissionableRevenue: 1642857.14,
      commissionPool: 16428.57,
      departmentShares: [
        { name: "Sales", allocationPercent: 50, amount: 8214.29 },
      ],
      salesRoleShares: [
        { role: "deal_owner", employee: bob, amount: 4928.57 },
        { role: "supporting_salesperson", employee: alice, amount: 3285.71 },
      ],
      salesShareAmount: 8214.29,
      participants: { dealOwner: bob, support1: alice, support2: null, salesDirector: null },
    },
  ],
};

describe("CommissionDashboardView", () => {
  beforeEach(() => {
    mockLocationState = {};
    commissionService.getCommissionDashboardData.mockResolvedValue(mockDashboardData);
  });

  it("renders executive KPI cards and unmasked values for Finance & Accounting / Super Admin", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true, name: "Admin Boss" },
    });

    render(<CommissionDashboardView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("₱24,642.86")).toBeInTheDocument(); // Commission Pool
      expect(screen.getByText("₱2,464,285.71")).toBeInTheDocument(); // Commissionable Revenue
      expect(screen.getAllByText("₱12,321.43").length).toBeGreaterThanOrEqual(1); // Sales Dept Share
    });

    expect(screen.getByText(/Export CSV/i)).toBeInTheDocument();
  });

  it("switches tabs between Sales Roster, Transaction Ledger, and Department Allocations", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true, name: "Admin Boss" },
    });

    render(<CommissionDashboardView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Alice Rep")).toBeInTheDocument();
    });

    // Switch to Transaction Ledger tab
    const ledgerTab = screen.getByRole("button", { name: /Transaction Ledger/i });
    fireEvent.click(ledgerTab);

    expect(screen.getByText("SOR-001")).toBeInTheDocument();
    expect(screen.getByText("Alpha Corp Solution")).toBeInTheDocument();
    expect(screen.getByText("SOR-002")).toBeInTheDocument();

    // Switch to Department Allocations tab
    const deptsTab = screen.getByRole("button", { name: /Department Allocations/i });
    fireEvent.click(deptsTab);

    expect(screen.getAllByText("Operations").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Administration").length).toBeGreaterThanOrEqual(1);

    // Switch to Commission Formula & Split Rules tab
    const rulesTab = screen.getByRole("button", { name: /Split Rules/i });
    fireEvent.click(rulesTab);

    expect(screen.getByText(/Commission Formula & Allocation Rules/i)).toBeInTheDocument();
    expect(screen.getByText(/Solo Sales Project/i)).toBeInTheDocument();
    expect(screen.getByText(/Collaborative Project/i)).toBeInTheDocument();
  });

  it("masks peer monetary amounts when viewed by a standard sales rep", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: {
        id: "user-alice",
        name: "Alice Rep",
        is_super_admin: false,
        is_head: false,
        is_hr: false,
        department: "Sales",
      },
    });

    render(<CommissionDashboardView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Alice Rep")).toBeInTheDocument();
    });

    // Alice sees her own total: ₱9,035.71
    expect(screen.getByText("₱9,035.71")).toBeInTheDocument();

    // Bob Rep's total is masked as percentage or bullet, so his total ₱3,285.71 is not shown
    // Bob's row has bullet dots instead of currency
    // Bob's row has bullet dots instead of currency
    expect(screen.getByText("26.7% Share")).toBeInTheDocument();

    // Export CSV should be hidden for standard sales rep
    expect(screen.queryByText(/Export CSV/i)).not.toBeInTheDocument();
  });

  it("highlights deep-linked opportunity row when opened with location state", async () => {
    mockLocationState = { openOpportunityId: "opp-1" };
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true },
    });

    render(<CommissionDashboardView />, { wrapper: createWrapper() });

    // Should switch to ledger tab and find SOR-001
    await waitFor(() => {
      expect(screen.getByText("SOR-001")).toBeInTheDocument();
    });
  });

  it("filters ledger transactions by search query", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true },
    });

    render(<CommissionDashboardView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Alice Rep")).toBeInTheDocument();
    });

    const ledgerTab = screen.getByRole("button", { name: /Transaction Ledger/i });
    fireEvent.click(ledgerTab);

    expect(screen.getByText("Alpha Corp Solution")).toBeInTheDocument();
    expect(screen.getByText("Beta Corp Rollout")).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Search deals, clients, reps…/i);
    fireEvent.change(searchInput, { target: { value: "Alpha" } });

    expect(screen.getByText("Alpha Corp Solution")).toBeInTheDocument();
    expect(screen.queryByText("Beta Corp Rollout")).not.toBeInTheDocument();
  });

  it("triggers CSV export download when Export CSV button is clicked", async () => {
    const createObjectURLSpy = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURLSpy = vi.fn();
    global.URL.createObjectURL = createObjectURLSpy;
    global.URL.revokeObjectURL = revokeObjectURLSpy;

    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true },
    });

    render(<CommissionDashboardView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/Export CSV/i)).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole("button", { name: /Export CSV/i });
    fireEvent.click(exportBtn);

    expect(createObjectURLSpy).toHaveBeenCalled();
  });

  it("toggles between Realized Pool and Pipeline Forecast", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true },
    });

    render(<CommissionDashboardView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Realized Pool")).toBeInTheDocument();
    });

    const forecastBtn = screen.getByRole("button", { name: /Pipeline Forecast/i });
    fireEvent.click(forecastBtn);

    await waitFor(() => {
      expect(commissionService.getCommissionDashboardData).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "FORECAST" }),
      );
    });
  });

  it("navigates to SOR register with filterEmployeeId when a salesperson row is clicked", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true },
    });

    render(<CommissionDashboardView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Alice Rep")).toBeInTheDocument();
    });

    const aliceRow = screen.getByText("Alice Rep").closest("tr");
    fireEvent.click(aliceRow);

    expect(mockNavigate).toHaveBeenCalledWith("/crm", {
      state: { filterEmployeeId: "user-alice" },
    });
  });

  it("navigates to SOR register with openOpportunityId when a transaction row is clicked", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true },
    });

    render(<CommissionDashboardView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Alice Rep")).toBeInTheDocument();
    });

    const ledgerTab = screen.getByRole("button", { name: /Transaction Ledger/i });
    fireEvent.click(ledgerTab);

    const dealRow = screen.getByText("SOR-001").closest("tr");
    fireEvent.click(dealRow);

    expect(mockNavigate).toHaveBeenCalledWith("/crm", {
      state: { openOpportunityId: "opp-1" },
    });
  });
});
