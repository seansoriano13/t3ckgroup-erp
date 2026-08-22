import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CommissionDashboardView from "./CommissionDashboardView";
import { commissionService } from "../../services/commissionService";
import * as AuthContext from "../../context/AuthContext";
import {
  getSalesCycleRange,
  getSalesCycleStartYear,
} from "../../utils/dateRangePresets";

const mockNavigate = vi.fn();
let mockLocationState = {};

vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: "/opportunities/commission", state: mockLocationState }),
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
const dave = { id: "user-dave", name: "Dave Director", avatarPath: null };

// Regulation CCPR-2026-001 seed percentages, per supabase/migrations/0032.
const SPLITS_BY_PROJECT_TYPE = {
  SSP: [
    { shareRole: "deal_owner", percent: 80 },
    { shareRole: "sales_director", percent: 20 },
  ],
  CP: [
    { shareRole: "deal_owner", percent: 60 },
    { shareRole: "supporting_salesperson", percent: 20 },
    { shareRole: "sales_director", percent: 20 },
  ],
  STRATEGIC: [
    { shareRole: "deal_owner", percent: 40 },
    { shareRole: "supporting_salesperson", percent: 20 },
    { shareRole: "sales_director", percent: 40 },
  ],
};

const departmentSharesFor = (pool) => [
  { name: "Sales", allocationPercent: 50, amount: pool * 0.5, isSales: true },
  { name: "Operations", allocationPercent: 25, amount: pool * 0.25 },
  { name: "Administration", allocationPercent: 15, amount: pool * 0.15 },
  { name: "Human Resources", allocationPercent: 5, amount: pool * 0.05 },
  { name: "Finance & Accounting", allocationPercent: 5, amount: pool * 0.05 },
];

// The roster and the KPI cards are derived from this ledger, so the ledger is
// the single source of truth in this fixture. An earlier version declared a
// salesEmployees block its own dealLedger did not add up to, which meant the
// roster could be asserted against numbers the app would never produce.
const mockDashboardData = {
  totalDealsCount: 2,
  wonDealsCount: 2,
  totalContractValue: 3200000,
  totalCommissionableRevenue: 2628571.428571,
  totalCommissionPool: 26285.714286,
  salesDeptTotal: 13142.857143,
  otherDeptsTotal: 13142.857143,
  unattributedSalesAmount: 0,
  // Every role on both deals is filled, so the roster sums exactly to the
  // Sales department total — the property the dashboard is supposed to hold.
  salesEmployees: [
    {
      employeeId: "user-alice",
      name: "Alice Rep",
      avatarPath: null,
      wonDealsCount: 2,
      totalDealsCount: 2,
      totalContractValue: 3200000,
      totalCommissionShare: 5585.714286,
      roleBreakdown: { deal_owner: 3942.857143, supporting_salesperson: 1642.857143, sales_director: 0 },
      dealIds: ["opp-1", "opp-2"],
    },
    {
      employeeId: "user-bob",
      name: "Bob Rep",
      avatarPath: null,
      wonDealsCount: 1,
      totalDealsCount: 1,
      totalContractValue: 2000000,
      totalCommissionShare: 4928.571429,
      roleBreakdown: { deal_owner: 4928.571429, supporting_salesperson: 0, sales_director: 0 },
      dealIds: ["opp-2"],
    },
    {
      employeeId: "user-dave",
      name: "Dave Director",
      avatarPath: null,
      wonDealsCount: 2,
      totalDealsCount: 2,
      totalContractValue: 3200000,
      totalCommissionShare: 2628.571429,
      roleBreakdown: { deal_owner: 0, supporting_salesperson: 0, sales_director: 2628.571429 },
      dealIds: ["opp-1", "opp-2"],
    },
  ],
  departmentTotals: departmentSharesFor(26285.714286),
  splitsByProjectType: SPLITS_BY_PROJECT_TYPE,
  dealLedger: [
    {
      id: "opp-1",
      salesReference: "S01001",
      opportunityNo: null,
      projectTitle: "Alpha Corp Solution",
      clientName: "Alpha Corp",
      status: "AWARDED",
      projectType: "SSP",
      contractDate: "2026-02-10",
      createdAt: "2026-01-15",
      contractValue: 1200000,
      rates: { vatPercent: 12, withholdingPercent: 8, poolPercent: 1 },
      commissionableRevenue: 985714.285714,
      commissionPool: 9857.142857,
      departmentShares: departmentSharesFor(9857.142857),
      // SSP: 80% owner / 20% director of the ₱4,928.571 Sales share.
      salesRoleShares: [
        { role: "deal_owner", employee: alice, percent: 80, amount: 3942.857143 },
        { role: "sales_director", employee: dave, percent: 20, amount: 985.714286 },
      ],
      salesShareAmount: 4928.571429,
      participants: { dealOwner: alice, support1: null, support2: null, salesDirector: dave },
    },
    {
      id: "opp-2",
      // A row registered before migration 0025 retired opportunity_no; it
      // has no sales_reference, and must still identify itself.
      salesReference: null,
      opportunityNo: "S07233",
      projectTitle: "Beta Corp Rollout",
      clientName: "Beta Corp",
      status: "CLOSED_WON",
      projectType: "CP",
      contractDate: "2026-03-01",
      createdAt: "2026-02-01",
      contractValue: 2000000,
      rates: { vatPercent: 12, withholdingPercent: 8, poolPercent: 1 },
      commissionableRevenue: 1642857.142857,
      commissionPool: 16428.571429,
      departmentShares: departmentSharesFor(16428.571429),
      // CP: 60 / 20 / 20 of the ₱8,214.286 Sales share.
      salesRoleShares: [
        { role: "deal_owner", employee: bob, percent: 60, amount: 4928.571429 },
        { role: "supporting_salesperson", employee: alice, percent: 20, amount: 1642.857143 },
        { role: "sales_director", employee: dave, percent: 20, amount: 1642.857143 },
      ],
      salesShareAmount: 8214.285714,
      participants: { dealOwner: bob, support1: alice, support2: null, salesDirector: dave },
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
      expect(screen.getByText("₱26,285.71")).toBeInTheDocument(); // Commission Pool
      expect(screen.getByText("₱2,628,571.43")).toBeInTheDocument(); // Commissionable Revenue
      expect(screen.getAllByText("₱13,142.86").length).toBeGreaterThanOrEqual(1); // Sales Dept Share
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

    expect(screen.getByText("S01001")).toBeInTheDocument();
    expect(screen.getByText("Alpha Corp Solution")).toBeInTheDocument();
    expect(screen.getByText("S07233")).toBeInTheDocument();

    // Switch to Department Allocations tab
    const deptsTab = screen.getByRole("button", { name: /Department Allocations/i });
    fireEvent.click(deptsTab);

    expect(screen.getAllByText("Operations").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Administration").length).toBeGreaterThanOrEqual(1);

    // Switch to Commission Formula & Split Rules tab
    const rulesTab = screen.getByRole("button", { name: /Split Rules/i });
    fireEvent.click(rulesTab);

    expect(screen.getByText(/Commission Formula & Allocation Rules/i)).toBeInTheDocument();
    expect(screen.getByText(/Single Salesperson Project/i)).toBeInTheDocument();
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

    // Alice sees her own total.
    expect(screen.getByText("₱5,585.71")).toBeInTheDocument();

    // Peers' totals are replaced by their percentage of the Sales department
    // share: Bob 4,928.57 / 13,142.86 and Dave 2,628.57 / 13,142.86.
    expect(screen.queryByText("₱4,928.57")).not.toBeInTheDocument();
    expect(screen.getByText("37.5% Share")).toBeInTheDocument();
    expect(screen.getByText("20.0% Share")).toBeInTheDocument();

    // Export CSV should be hidden for standard sales rep
    expect(screen.queryByText(/Export CSV/i)).not.toBeInTheDocument();
  });

  it("highlights deep-linked opportunity row when opened with location state", async () => {
    mockLocationState = { openOpportunityId: "opp-1" };
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true },
    });

    render(<CommissionDashboardView />, { wrapper: createWrapper() });

    // Should switch to ledger tab and find the deal
    await waitFor(() => {
      expect(screen.getByText("S01001")).toBeInTheDocument();
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

    // The surviving row's title is now split around the highlighted match, so
    // it is matched on the row's text rather than as one node.
    const rows = [...document.querySelectorAll("tbody tr")];
    expect(rows.some((tr) => tr.textContent.includes("Alpha Corp Solution"))).toBe(true);
    expect(rows.some((tr) => tr.textContent.includes("Beta Corp Rollout"))).toBe(false);
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

    // Assert the file's contents, not merely that a download was started.
    const csv = await createObjectURLSpy.mock.calls[0][0].text();
    const [header, ...rows] = csv.replace(/^\uFEFF/, "").trim().split(/\r\n/);

    expect(header.split(",")).toContain("Unattributed Sales Share (PHP)");
    expect(header.split(",")[0]).toBe("Sales Reference");
    expect(rows).toHaveLength(2);

    // S01001 is a Single Salesperson Project with both split roles filled,
    // so its Sales share is fully attributed and nothing is left over.
    const sor001 = rows.find((row) => row.startsWith('"S01001"'));
    expect(sor001).toContain('"Alice Rep"');
    expect(sor001).toContain("3942.86");
    expect(sor001).toContain("985.71");
    expect(sor001.split(",").at(-1)).toBe("0.00");
  });

  it("reports a Sales share that no participant is credited with in the CSV", async () => {
    const createObjectURLSpy = vi.fn().mockReturnValue("blob:mock-url");
    global.URL.createObjectURL = createObjectURLSpy;
    global.URL.revokeObjectURL = vi.fn();

    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true },
    });

    // The ordinary case the folded-in SSP branch created: a solo deal with
    // nobody in the Sales Director slot, so that role's 20% goes to no one.
    const orphaned = structuredClone(mockDashboardData);
    orphaned.dealLedger = [
      {
        ...mockDashboardData.dealLedger[0],
        salesRoleShares: [
          { role: "deal_owner", employee: alice, percent: 80, amount: 3942.857143 },
        ],
        participants: { dealOwner: alice, support1: null, support2: null, salesDirector: null },
      },
    ];
    commissionService.getCommissionDashboardData.mockResolvedValue(orphaned);

    render(<CommissionDashboardView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/Export CSV/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));

    const csv = await createObjectURLSpy.mock.calls[0][0].text();
    const row = csv.trim().split(/\r\n/)[1];

    // ₱4,928.57 Sales share less Alice's 80% = ₱985.71 credited to nobody.
    expect(row.split(",").at(-1)).toBe("985.71");
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

    expect(mockNavigate).toHaveBeenCalledWith("/opportunities", {
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

    const dealRow = screen.getByText("S01001").closest("tr");
    fireEvent.click(dealRow);

    expect(mockNavigate).toHaveBeenCalledWith("/opportunities", {
      state: { openOpportunityId: "opp-1" },
    });
  });

  // The Sales Rep / Project Type / search controls are applied in the browser
  // after the service has aggregated everything. They used to narrow the
  // Transaction Ledger alone, leaving the KPI cards, the trend chart, the
  // roster and the department table showing company-wide totals next to a
  // filtered table — while the roster's own empty state claimed it was
  // filtered. Every panel now reads the same filtered set.
  describe("filters apply to every panel, not just the ledger", () => {
    beforeEach(() => {
      vi.spyOn(AuthContext, "useAuth").mockReturnValue({
        user: { id: "user-admin", is_super_admin: true, name: "Admin Boss" },
      });
    });

    async function renderAndSearch(query) {
      render(<CommissionDashboardView />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText("₱26,285.71")).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText(/Search deals, clients, reps…/i), {
        target: { value: query },
      });
    }

    it("narrows the KPI cards to the matching deals", async () => {
      // "Alpha" matches only S01001: pool ₱9,857.14, Sales share ₱4,928.57.
      await renderAndSearch("Alpha");

      expect(screen.getByText("₱9,857.14")).toBeInTheDocument();
      expect(screen.queryByText("₱26,285.71")).not.toBeInTheDocument();
      expect(screen.getByText("₱985,714.29")).toBeInTheDocument();
      expect(screen.getAllByText("₱4,928.57").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("1 / 1")).toBeInTheDocument();
    });

    it("narrows the Sales Roster to people credited on the matching deals", async () => {
      // S01001 is a Single Salesperson Project: Alice owns it, Dave directs
      // it, and Bob is not on it at all.
      await renderAndSearch("Alpha");

      expect(screen.getByText("Alice Rep")).toBeInTheDocument();
      expect(screen.getByText("Dave Director")).toBeInTheDocument();
      expect(screen.queryByText("Bob Rep")).not.toBeInTheDocument();
      expect(screen.getByText("2 personnel")).toBeInTheDocument();
    });

    it("narrows the Department Allocations to the matching deals", async () => {
      await renderAndSearch("Alpha");

      fireEvent.click(screen.getByRole("button", { name: /Department Allocations/i }));

      // Operations takes 25% of S01001's ₱9,857.14 pool; Sales takes 50%.
      const rowFor = (department) =>
        [...document.querySelectorAll("tr")].find((tr) =>
          tr.querySelector("td")?.textContent.trim() === department,
        );
      expect(rowFor("Operations")).toHaveTextContent("₱2,464.29");
      expect(rowFor("Sales")).toHaveTextContent("₱4,928.57");
    });

    it("empties every panel together when nothing matches", async () => {
      await renderAndSearch("nothing-matches-this");

      expect(screen.getByText("0 / 0")).toBeInTheDocument();
      expect(screen.getByText("0 personnel")).toBeInTheDocument();
      expect(screen.getByText(/No sales employee records found/i)).toBeInTheDocument();
    });
  });

  describe("split rules explainer", () => {
    it("states the percentages currently stored, not hard-coded ones", async () => {
      vi.spyOn(AuthContext, "useAuth").mockReturnValue({
        user: { id: "user-admin", is_super_admin: true },
      });

      render(<CommissionDashboardView />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText("₱26,285.71")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /Split Rules/i }));

      const ssp = screen.getByText("SSP — Single Salesperson Project").closest("div").parentElement;
      // 80 / 20 with no supporting-salesperson row — per migration 0032, not
      // the 100 / N/A / 0 this panel used to assert as a literal.
      expect(ssp).toHaveTextContent("80%");
      expect(ssp).toHaveTextContent("20%");
      expect(ssp).toHaveTextContent("N/A");
      expect(ssp).not.toHaveTextContent("100%");
    });

    it("follows an edited split instead of repeating the seed values", async () => {
      vi.spyOn(AuthContext, "useAuth").mockReturnValue({
        user: { id: "user-admin", is_super_admin: true },
      });

      // A Sales Director has since moved Strategic to 70 / 10 / 20.
      commissionService.getCommissionDashboardData.mockResolvedValue({
        ...mockDashboardData,
        splitsByProjectType: {
          ...SPLITS_BY_PROJECT_TYPE,
          STRATEGIC: [
            { shareRole: "deal_owner", percent: 70 },
            { shareRole: "supporting_salesperson", percent: 10 },
            { shareRole: "sales_director", percent: 20 },
          ],
        },
      });

      render(<CommissionDashboardView />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText("₱26,285.71")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /Split Rules/i }));

      const strategic = screen.getByText("Strategic Project").closest("div").parentElement;
      expect(strategic).toHaveTextContent("70%");
      expect(strategic).toHaveTextContent("10%");
      expect(strategic).not.toHaveTextContent("40%");
    });
  });

  it("keeps the figures and the filter bar on screen while a new range loads", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true, name: "Admin Boss" },
    });

    let release;
    commissionService.getCommissionDashboardData
      .mockResolvedValueOnce(mockDashboardData)
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));

    render(<CommissionDashboardView />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("₱26,285.71")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Pipeline Forecast"));

    // Mid-flight: the previous numbers stay put rather than collapsing into a
    // full-page spinner, and the controls remain operable.
    await waitFor(() => {
      expect(screen.getByText("Updating…")).toBeInTheDocument();
    });
    expect(screen.getByText("₱26,285.71")).toBeInTheDocument();
    expect(screen.queryByText(/Accumulating commission ledger/i)).not.toBeInTheDocument();

    release(mockDashboardData);
    await waitFor(() => {
      expect(screen.queryByText("Updating…")).not.toBeInTheDocument();
    });
  });

  // The collapsed ledger row masks the company-wide Commission Pool behind
  // canViewAllFinancials. The row also expands into an "Itemized Calculation
  // Sheet", and that sheet printed the same figures in full — so the mask was
  // one chevron click deep for anyone who found it.
  it("keeps company figures masked when a standard rep expands the calculation sheet", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: {
        id: "user-bob", // on the CP deal, but not the deal owner of S01001
        name: "Bob Rep",
        is_super_admin: false,
        is_head: false,
        department: "Sales",
      },
    });

    render(<CommissionDashboardView />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("Alice Rep")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Transaction Ledger/i }));

    // Collapsed: the pool for SOR S01001 is bulleted out.
    expect(screen.queryByText("₱9,857.14")).not.toBeInTheDocument();

    const row = screen.getByText("S01001").closest("tr");
    fireEvent.click(within(row).getByTitle("Toggle calculation sheet"));

    // Expanded: it must stay bulleted out.
    expect(screen.queryByText("₱9,857.14")).not.toBeInTheDocument();
    // The Sales department pool for that deal is likewise not Bob's to read.
    expect(screen.queryByText("₱4,928.57")).not.toBeInTheDocument();
  });

  it("shows the calculation sheet in full to someone entitled to it", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true, name: "Admin Boss" },
    });

    render(<CommissionDashboardView />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("Alice Rep")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Transaction Ledger/i }));

    const row = screen.getByText("S01001").closest("tr");
    fireEvent.click(within(row).getByTitle("Toggle calculation sheet"));

    // The pool shows in both the collapsed row and the sheet below it.
    expect(screen.getAllByText("₱9,857.14").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("₱4,928.57").length).toBeGreaterThanOrEqual(1);
    // Labels state this deal's own rates rather than a hard-coded 1% / 50%.
    expect(screen.getByText("Total Commission Pool (1%)")).toBeInTheDocument();
    expect(screen.getByText("Sales Dept Pool (50%)")).toBeInTheDocument();
  });

  // Client names and project titles are free text typed by sales staff, and
  // this export is opened in a spreadsheet by Finance. Quoting a value does
  // not stop a spreadsheet evaluating a cell that begins with = + - or @.
  it("neutralises a client name that a spreadsheet would treat as a formula", async () => {
    const createObjectURLSpy = vi.fn().mockReturnValue("blob:mock-url");
    global.URL.createObjectURL = createObjectURLSpy;
    global.URL.revokeObjectURL = vi.fn();

    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true },
    });

    const hostile = structuredClone(mockDashboardData);
    hostile.dealLedger = [
      {
        ...mockDashboardData.dealLedger[0],
        clientName: '=1+1',
        projectTitle: '@SUM(A1:A9)',
      },
    ];
    commissionService.getCommissionDashboardData.mockResolvedValue(hostile);

    render(<CommissionDashboardView />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText(/Export CSV/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));

    const csv = await createObjectURLSpy.mock.calls[0][0].text();
    const row = csv.trim().split(/\r\n/)[1];

    // Prefixed with an apostrophe so the cell is read as literal text.
    expect(row).toContain(`"'=1+1"`);
    expect(row).toContain(`"'@SUM(A1:A9)"`);
    expect(row).not.toContain('"=1+1"');
  });

  // HighlightText takes a `search` prop. This screen passed `query`, so the
  // component saw search === undefined, returned the text untouched, and the
  // ledger was the one search surface in the app that highlighted nothing.
  it("highlights the matched fragment in the ledger", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true },
    });

    render(<CommissionDashboardView />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("Alice Rep")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Transaction Ledger/i }));
    fireEvent.change(screen.getByPlaceholderText(/Search deals, clients, reps…/i), {
      target: { value: "Alpha" },
    });

    // Highlighting splits the cell, so the matched fragment becomes an
    // element of its own. Without it "Alpha Corp" stays a single text node
    // and there is no element whose exact text is "Alpha".
    await waitFor(() => {
      expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
    });
  });

  // CCPR-2026-001 runs the Sales Cycle from 1 April to 31 March, and splits it
  // into the two commission release periods. The date maths is pinned in
  // src/utils/dateRangePresets.test.js; what matters here is that the
  // dashboard offers those periods and passes the right window to the service.
  describe("Sales Cycle filter", () => {
    beforeEach(() => {
      vi.spyOn(AuthContext, "useAuth").mockReturnValue({
        user: { id: "user-admin", is_super_admin: true, name: "Admin Boss" },
      });
    });

    async function openDatePresets() {
      render(<CommissionDashboardView />, { wrapper: createWrapper() });
      await waitFor(() => {
        expect(screen.getByText("₱26,285.71")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("All Time"));
    }

    it("offers the cycle and each of its two release halves", async () => {
      await openDatePresets();

      expect(screen.getByText("Sales Cycle (Apr - Mar)")).toBeInTheDocument();
      expect(screen.getByText("1st Cycle (Apr - Sep)")).toBeInTheDocument();
      expect(screen.getByText("2nd Cycle (Oct - Mar)")).toBeInTheDocument();
      expect(screen.getByText("Previous Sales Cycle")).toBeInTheDocument();
    });

    it("asks the service for the cycle window when the cycle is selected", async () => {
      await openDatePresets();
      fireEvent.click(screen.getByText("Sales Cycle (Apr - Mar)"));

      const expected = getSalesCycleRange(getSalesCycleStartYear(new Date()));
      await waitFor(() => {
        expect(commissionService.getCommissionDashboardData).toHaveBeenCalledWith({
          scope: "REALIZED",
          dateFilter: expected,
        });
      });

      // The window is a full year, April to the following March.
      expect(expected.startDate.endsWith("-04-01")).toBe(true);
      expect(expected.endDate.endsWith("-03-31")).toBe(true);
    });

    it("asks for the October-to-March half, spanning the new year", async () => {
      await openDatePresets();
      fireEvent.click(screen.getByText("2nd Cycle (Oct - Mar)"));

      const startYear = getSalesCycleStartYear(new Date());
      await waitFor(() => {
        expect(commissionService.getCommissionDashboardData).toHaveBeenCalledWith({
          scope: "REALIZED",
          dateFilter: {
            startDate: `${startYear}-10-01`,
            endDate: `${startYear + 1}-03-31`,
          },
        });
      });
    });

    it("shows the selected cycle on the filter trigger", async () => {
      await openDatePresets();
      fireEvent.click(screen.getByText("1st Cycle (Apr - Sep)"));

      // The filter bar must survive the refetch — previously the whole
      // dashboard was replaced by a spinner and the control disappeared.
      await waitFor(() => {
        expect(screen.getByText("1st Cycle (Apr - Sep)")).toBeInTheDocument();
      });
      expect(screen.queryByText("All Time")).not.toBeInTheDocument();
    });
  });
});
