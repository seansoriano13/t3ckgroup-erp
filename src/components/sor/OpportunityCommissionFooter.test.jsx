import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OpportunityCommissionFooter from "./OpportunityCommissionFooter";
import { commissionService } from "../../services/commissionService";
import { splitSalesShareForRoles } from "../../utils/commission";
import * as AuthContext from "../../context/AuthContext";

const mockNavigate = vi.fn();
vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../../services/commissionService", () => ({
  commissionService: {
    getCommissionBreakdownForOpportunity: vi.fn(),
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

const SALES_SHARE = 4107.14;

const CP_SPLITS = [
  { shareRole: "deal_owner", percent: 60 },
  { shareRole: "supporting_salesperson", percent: 30 },
  { shareRole: "sales_director", percent: 10 },
];

const ALICE = { id: "u1", name: "Alice Owner" };
const BOB = { id: "u2", name: "Bob Support" };
const DAVE = { id: "u3", name: "Dave Director" };

/**
 * The breakdown the real service returns, with `salesRoleShares` produced by
 * the real splitter rather than hand-written.
 *
 * Hand-written shares are how the percentage-masking path came to be tested
 * green while being unreachable in production: the fixture carried a
 * `percent` on each share that `splitSalesShareForRoles` did not yet emit, so
 * the test exercised a shape the app never actually received. Building the
 * fixture from the producer keeps the two honest about each other.
 */
function makeBreakdown(participants = {}) {
  return {
    rates: { vatPercent: 12, withholdingPercent: 8, poolPercent: 1 },
    commissionPool: 8214.29,
    commissionableRevenue: 821428.57,
    departmentShares: [
      { name: "Sales", allocationPercent: 50, amount: SALES_SHARE, isSales: true },
      { name: "Operations", allocationPercent: 25, amount: 2053.57 },
    ],
    salesRoleShares: splitSalesShareForRoles(SALES_SHARE, CP_SPLITS, {
      deal_owner: ALICE,
      supporting_salespeople: [BOB],
      sales_director: DAVE,
      ...participants,
    }),
  };
}

describe("OpportunityCommissionFooter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders unmasked figures for super admin and accounting users", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true, name: "Boss Admin" },
    });

    commissionService.getCommissionBreakdownForOpportunity.mockResolvedValue(makeBreakdown());

    render(
      <OpportunityCommissionFooter opportunity={{ id: "opp-123", opportunity_no: "SOR-001" }} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText(/Calculating commission estimate/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("₱8,214.29")).toBeInTheDocument();
    });
    expect(screen.getByText("₱821,428.57")).toBeInTheDocument();
    expect(screen.getByText("₱4,107.14")).toBeInTheDocument();

    // Deal Owner 60%, Support 30%, Director 10% of the ₱4,107.14 Sales share.
    expect(screen.getByText("Alice Owner")).toBeInTheDocument();
    expect(screen.getByText("₱2,464.28")).toBeInTheDocument();
    expect(screen.getByText("Bob Support")).toBeInTheDocument();
    expect(screen.getByText("₱1,232.14")).toBeInTheDocument();
    expect(screen.getByText("Dave Director")).toBeInTheDocument();
    expect(screen.getByText("₱410.71")).toBeInTheDocument();
  });

  it("masks pool and peer amounts for a regular sales employee while showing their own share", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: {
        id: "u1",
        name: "Alice Owner",
        is_super_admin: false,
        is_head: false,
        department: "Sales",
      },
    });

    commissionService.getCommissionBreakdownForOpportunity.mockResolvedValue(makeBreakdown());

    render(
      <OpportunityCommissionFooter opportunity={{ id: "opp-123", opportunity_no: "SOR-001" }} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText("₱821,428.57")).toBeInTheDocument();
    });

    // The company-wide pool is bulleted out entirely.
    expect(screen.queryByText("₱8,214.29")).not.toBeInTheDocument();
    expect(screen.getByText("••••••")).toBeInTheDocument();

    // The Sales department share degrades to its allocation percentage.
    expect(screen.getByText("50% Pool")).toBeInTheDocument();

    // Alice sees her own money.
    expect(screen.getByText("₱2,464.28")).toBeInTheDocument();

    // Peers' amounts are replaced by the percentage that produced them, which
    // is the whole point of masking rather than blanking.
    expect(screen.queryByText("₱1,232.14")).not.toBeInTheDocument();
    expect(screen.queryByText("₱410.71")).not.toBeInTheDocument();
    expect(screen.getByText("30% Share")).toBeInTheDocument();
    expect(screen.getByText("10% Share")).toBeInTheDocument();
  });

  it("splits the combined supporting percentage across both filled slots", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "u1", name: "Alice Owner", is_super_admin: false, is_head: false, department: "Sales" },
    });

    const carol = { id: "u4", name: "Carol Support" };
    commissionService.getCommissionBreakdownForOpportunity.mockResolvedValue(
      makeBreakdown({ supporting_salespeople: [BOB, carol] }),
    );

    render(
      <OpportunityCommissionFooter opportunity={{ id: "opp-123", opportunity_no: "SOR-001" }} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText("Bob Support")).toBeInTheDocument();
    });
    expect(screen.getByText("Carol Support")).toBeInTheDocument();

    // 30% combined, halved — each masked peer is shown 15%, not 30%.
    expect(screen.getAllByText("15% Share")).toHaveLength(2);
    expect(screen.queryByText("30% Share")).not.toBeInTheDocument();
  });

  it("labels the pool and Sales headings with the rates that actually applied", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true },
    });

    // A dated rate change: this opportunity was priced at a 1.5% pool and a
    // 45% Sales allocation, so the headings must say so rather than repeating
    // the values that were current when the screen was written.
    const breakdown = makeBreakdown();
    breakdown.rates.poolPercent = 1.5;
    breakdown.departmentShares[0].allocationPercent = 45;
    commissionService.getCommissionBreakdownForOpportunity.mockResolvedValue(breakdown);

    render(
      <OpportunityCommissionFooter opportunity={{ id: "opp-123", opportunity_no: "SOR-001" }} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText("Commission Pool (1.5%)")).toBeInTheDocument();
    });
    expect(screen.getByText("Sales Dept (45%)")).toBeInTheDocument();
  });

  // The Commission Dashboard drops CLOSED_LOST unconditionally
  // (aggregateOpportunityCommissions), so the same deal must not present a
  // full estimate and an attribution table here. A rep should not be shown
  // "their share" of a deal that was lost.
  it("does not present an estimate for a deal that was lost", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", isSuperAdmin: true, name: "Boss Admin" },
    });

    commissionService.getCommissionBreakdownForOpportunity.mockResolvedValue(makeBreakdown());

    render(
      <OpportunityCommissionFooter
        opportunity={{ id: "opp-123", sales_reference: "S01001", status: "CLOSED_LOST" }}
      />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText(/closed lost/i)).toBeInTheDocument();
    });

    // None of the money, and none of the per-person attribution.
    expect(screen.queryByText("₱8,214.29")).not.toBeInTheDocument();
    expect(screen.queryByText("₱2,464.28")).not.toBeInTheDocument();
    expect(screen.queryByText("Alice Owner")).not.toBeInTheDocument();
  });

  it("navigates to commission dashboard on click", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true },
    });

    commissionService.getCommissionBreakdownForOpportunity.mockResolvedValue({
      rates: { vatPercent: 12, withholdingPercent: 8, poolPercent: 1 },
      commissionPool: 5000,
      commissionableRevenue: 500000,
      departmentShares: [],
      salesRoleShares: [],
    });

    const onClose = vi.fn();
    render(
      <OpportunityCommissionFooter
        opportunity={{ id: "opp-123", opportunity_no: "SOR-001" }}
        onClose={onClose}
      />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText("₱5,000.00")).toBeInTheDocument();
    });

    const btn = screen.getByRole("button", { name: /View in Commission Dashboard/i });
    fireEvent.click(btn);

    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/opportunities/commission", {
      state: { openOpportunityId: "opp-123" },
    });
  });
});
