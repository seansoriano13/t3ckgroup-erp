import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OpportunityCommissionFooter from "./OpportunityCommissionFooter";
import { commissionService } from "../../services/commissionService";
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

describe("OpportunityCommissionFooter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders unmasked figures for super admin and accounting users", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true, name: "Boss Admin" },
    });

    commissionService.getCommissionBreakdownForOpportunity.mockResolvedValue({
      commissionPool: 8214.29,
      commissionableRevenue: 821428.57,
      departmentShares: [{ name: "Sales", allocationPercent: 50, amount: 4107.14 }],
      salesRoleShares: [
        { role: "deal_owner", percent: 60, employee: { id: "u1", name: "Alice Owner" }, amount: 2464.29 },
        { role: "supporting_salesperson", percent: 30, employee: { id: "u2", name: "Bob Support" }, amount: 1232.14 },
        { role: "sales_director", percent: 10, employee: { id: "u3", name: "Dave Director" }, amount: 410.71 },
      ],
    });

    render(
      <OpportunityCommissionFooter
        opportunity={{ id: "opp-123", opportunity_no: "SOR-001" }}
      />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByText(/Calculating commission estimate/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("₱8,214.29")).toBeInTheDocument();
      expect(screen.getByText("₱821,428.57")).toBeInTheDocument();
      expect(screen.getByText("₱4,107.14")).toBeInTheDocument();
    });

    // Verify Deal Owner and supporting cast amounts
    expect(screen.getByText("Alice Owner")).toBeInTheDocument();
    expect(screen.getByText("₱2,464.29")).toBeInTheDocument();
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

    commissionService.getCommissionBreakdownForOpportunity.mockResolvedValue({
      commissionPool: 8214.29,
      commissionableRevenue: 821428.57,
      departmentShares: [{ name: "Sales", allocationPercent: 50, amount: 4107.14 }],
      salesRoleShares: [
        { role: "deal_owner", percent: 60, employee: { id: "u1", name: "Alice Owner" }, amount: 2464.29 },
        { role: "supporting_salesperson", percent: 30, employee: { id: "u2", name: "Bob Support" }, amount: 1232.14 },
        { role: "sales_director", percent: 10, employee: { id: "u3", name: "Dave Director" }, amount: 410.71 },
      ],
    });

    render(
      <OpportunityCommissionFooter
        opportunity={{ id: "opp-123", opportunity_no: "SOR-001" }}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText("₱821,428.57")).toBeInTheDocument();
    });

    // Commission Pool total should be masked with bullets
    expect(screen.queryByText("₱8,214.29")).not.toBeInTheDocument();
    expect(screen.getByText("••••••")).toBeInTheDocument();

    // Sales Dept pool should show "50.00% Pool"
    expect(screen.getByText("50.00% Pool")).toBeInTheDocument();

    // Alice sees her own money: ₱2,464.29
    expect(screen.getByText("₱2,464.29")).toBeInTheDocument();

    // Peers Bob & Dave amounts are masked (showing percentage share instead of raw ₱)
    expect(screen.queryByText("₱1,232.14")).not.toBeInTheDocument();
    expect(screen.queryByText("₱410.71")).not.toBeInTheDocument();
    expect(screen.getByText("30% Share")).toBeInTheDocument();
    expect(screen.getByText("10% Share")).toBeInTheDocument();
  });

  it("navigates to commission dashboard on click", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true },
    });

    commissionService.getCommissionBreakdownForOpportunity.mockResolvedValue({
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
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText("₱5,000.00")).toBeInTheDocument();
    });

    const btn = screen.getByRole("button", { name: /View in Commission Dashboard/i });
    fireEvent.click(btn);

    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/sors/commission", {
      state: { openOpportunityId: "opp-123" },
    });
  });
});
