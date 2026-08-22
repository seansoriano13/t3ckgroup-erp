import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CommissionFormulaView from "./CommissionFormulaView";
import { commissionService } from "../../services/commissionService";
import { RATE_TYPES } from "../../utils/commission";
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

// The rate_type values the table actually stores — see the CHECK constraint in
// supabase/migrations/0028. An earlier fixture here used "vat" /
// "withholding_tax" / "commission_pool", which no row can ever hold, so the
// rate rows silently rendered nothing and the test still passed.
const RATE_HISTORY = [
  { id: "r1", rate_type: RATE_TYPES.VAT, percent: 12, effective_from: "2026-01-01" },
  { id: "r2", rate_type: RATE_TYPES.WITHHOLDING, percent: 8, effective_from: "2026-01-01" },
  { id: "r3", rate_type: RATE_TYPES.POOL, percent: 1, effective_from: "2026-01-01" },
];

// Regulation CCPR-2026-001 seed values, per supabase/migrations/0032.
const SPLITS_BY_TYPE = {
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

function mockService() {
  commissionService.listRateHistory.mockResolvedValue(RATE_HISTORY);
  commissionService.getDepartments.mockResolvedValue([
    { id: "d1", key: "sales", name: "Sales", allocationPercent: 50 },
    { id: "d2", key: "operations", name: "Operations", allocationPercent: 25 },
  ]);
  commissionService.getSplitsForProjectType.mockImplementation((projectType) =>
    Promise.resolve(SPLITS_BY_TYPE[projectType] ?? []),
  );
}

describe("CommissionFormulaView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService();
  });

  it("renders rates, departments, and split editors for every project type", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true, name: "Boss Admin" },
    });

    render(<CommissionFormulaView />, { wrapper: createWrapper() });

    // Each split editor renders only once its own query resolves.
    await waitFor(() => {
      expect(screen.getByText("SSP — Single Salesperson Project")).toBeInTheDocument();
    });
    expect(screen.getByText(/Current Commission Rates/i)).toBeInTheDocument();
    expect(screen.getByText(/Department Allocation/i)).toBeInTheDocument();

    // Split editors exist for all three project types, named the way the rest
    // of the app names them.
    expect(screen.getByText("CP — Collaborative Project")).toBeInTheDocument();
    expect(screen.getByText("Strategic Project")).toBeInTheDocument();
  });

  it("renders each stored rate with its human label and percentage", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true, name: "Boss Admin" },
    });

    render(<CommissionFormulaView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("VAT")).toBeInTheDocument();
    });
    // RATE_TYPE_LABELS maps WITHHOLDING to this; a raw enum leaking through
    // would read "WITHHOLDING" instead.
    expect(screen.getByText("Withholding (ITR)")).toBeInTheDocument();
    expect(screen.getByText("Pool")).toBeInTheDocument();
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.getByText("8%")).toBeInTheDocument();
  });

  // Dated rates exist so a change can be scheduled ahead of time — an
  // Opportunity is priced by the rate in force on its Contract Date, and
  // getEffectiveRates filters with `.lte(effective_from, asOfDate)`. The
  // "Current Commission Rates" panel has to agree with that, or an admin who
  // schedules next year's VAT sees it announced as today's while every peso
  // on the screen is still computed from the real one.
  it("shows the rate in force today, not one scheduled for the future", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true, name: "Boss Admin" },
    });

    const nextYear = new Date().getFullYear() + 1;
    commissionService.listRateHistory.mockResolvedValue([
      // listRateHistory returns newest-first, so the scheduled row leads.
      { id: "r9", rate_type: RATE_TYPES.VAT, percent: 14, effective_from: `${nextYear}-01-01` },
      ...RATE_HISTORY,
    ]);

    render(<CommissionFormulaView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("VAT")).toBeInTheDocument();
    });

    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.queryByText("14%")).not.toBeInTheDocument();
  });

  it("shows a Single Salesperson Project's split as read-only text for a non-editor", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-rep", is_super_admin: false, name: "Rank And File" },
    });
    commissionService.isSalesDirector.mockResolvedValue(false);

    render(<CommissionFormulaView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("SSP — Single Salesperson Project")).toBeInTheDocument();
    });

    // No editable inputs and no Save controls for someone who may not edit.
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();

    // SSP is 80 / 20 with no supporting salesperson, which renders as 0%.
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("gives a Sales Director editable inputs for the split percentages", async () => {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-director", is_super_admin: false, name: "Dana Director" },
    });
    commissionService.isSalesDirector.mockResolvedValue(true);

    render(<CommissionFormulaView />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.queryAllByRole("spinbutton").length).toBeGreaterThan(0);
    });

    // Three roles per editor, across three project types.
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(9);
    expect(screen.queryAllByRole("button", { name: /save/i })).toHaveLength(3);
  });
});
