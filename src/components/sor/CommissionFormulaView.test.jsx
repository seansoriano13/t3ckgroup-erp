import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CommissionFormulaView from "./CommissionFormulaView";
import { commissionService } from "../../services/commissionService";
import * as AuthContext from "../../context/AuthContext";

vi.mock("../../services/commissionService", () => ({
  commissionService: {
    listRateHistory: vi.fn(),
    getDepartments: vi.fn(),
    getSplitsForProjectType: vi.fn(),
    isSalesDirector: vi.fn(),
    saveSplitsForProjectType: vi.fn(),
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

describe("CommissionFormulaView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders rates, departments, and split editors for SSP, CP, and STRATEGIC project types", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true, name: "Boss Admin" },
    });

    commissionService.listRateHistory.mockResolvedValue([
      { rate_type: "vat", percent: 12 },
      { rate_type: "withholding_tax", percent: 8 },
      { rate_type: "commission_pool", percent: 1 },
    ]);

    commissionService.getDepartments.mockResolvedValue([
      { id: "d1", name: "Sales", allocationPercent: 50 },
      { id: "d2", name: "Operations", allocationPercent: 25 },
    ]);

    commissionService.getSplitsForProjectType.mockImplementation((projectType) => {
      if (projectType === "SSP") {
        return Promise.resolve([
          { shareRole: "deal_owner", percent: 100 },
          { shareRole: "supporting_salesperson", percent: 0 },
          { shareRole: "sales_director", percent: 0 },
        ]);
      }
      if (projectType === "CP") {
        return Promise.resolve([
          { shareRole: "deal_owner", percent: 60 },
          { shareRole: "supporting_salesperson", percent: 30 },
          { shareRole: "sales_director", percent: 10 },
        ]);
      }
      return Promise.resolve([
        { shareRole: "deal_owner", percent: 60 },
        { shareRole: "supporting_salesperson", percent: 30 },
        { shareRole: "sales_director", percent: 10 },
      ]);
    });

    render(<CommissionFormulaView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/Current Commission Rates/i)).toBeInTheDocument();
      expect(screen.getByText(/Department Allocation/i)).toBeInTheDocument();
      expect(screen.getByText("SSP — Solo Sales Project")).toBeInTheDocument();
      expect(screen.getByText("CP — Collaborative Project")).toBeInTheDocument();
      expect(screen.getByText("Strategic Project")).toBeInTheDocument();
    });
  });
});
