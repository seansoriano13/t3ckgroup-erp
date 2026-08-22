import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import toast from "react-hot-toast";

import CommissionRatesManager from "./CommissionRatesManager";
import { commissionService } from "../../services/commissionService";
import { RATE_TYPES } from "../../utils/commission";
import * as AuthContext from "../../context/AuthContext";

vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../services/commissionService", () => ({
  commissionService: {
    listRateHistory: vi.fn(),
    createRate: vi.fn(),
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

// rate_type values the table actually accepts — the CHECK constraint in
// supabase/migrations/0028 allows only these three.
const HISTORY = [
  { id: "r3", rate_type: RATE_TYPES.POOL, percent: 1, effective_from: "2026-01-01" },
  { id: "r2", rate_type: RATE_TYPES.WITHHOLDING, percent: 8, effective_from: "2026-01-01" },
  { id: "r1", rate_type: RATE_TYPES.VAT, percent: 12, effective_from: "2026-01-01" },
];

function signedInAsSuperAdmin() {
  // employeeService.getEmployeeByEmail returns camelCase role flags, so this
  // is the shape the component actually receives in production.
  vi.spyOn(AuthContext, "useAuth").mockReturnValue({
    user: { id: "admin-1", name: "Boss", isSuperAdmin: true },
  });
}

async function openAddForm() {
  render(<CommissionRatesManager />, { wrapper: createWrapper() });
  await waitFor(() => {
    expect(screen.getByText("VAT")).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole("button", { name: /Add Rate/i }));
}

describe("CommissionRatesManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commissionService.listRateHistory.mockResolvedValue(HISTORY);
    commissionService.createRate.mockResolvedValue({ id: "new" });
  });

  it("lists every recorded rate with its human label, percentage and date", async () => {
    signedInAsSuperAdmin();
    render(<CommissionRatesManager />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("VAT")).toBeInTheDocument();
    });
    expect(screen.getByText("Withholding (ITR)")).toBeInTheDocument();
    expect(screen.getByText("Pool")).toBeInTheDocument();
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.getAllByText(/effective 2026-01-01/)).toHaveLength(3);
  });

  it("offers exactly the three rate types the table accepts", async () => {
    signedInAsSuperAdmin();
    await openAddForm();

    const options = [...screen.getByRole("combobox").options].map((o) => o.value);
    expect(options).toEqual([RATE_TYPES.VAT, RATE_TYPES.WITHHOLDING, RATE_TYPES.POOL]);
  });

  it("submits the chosen type, percent and date against the acting user", async () => {
    signedInAsSuperAdmin();
    await openAddForm();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: RATE_TYPES.VAT } });
    fireEvent.change(screen.getByPlaceholderText("e.g. 12"), { target: { value: "14" } });
    fireEvent.change(document.querySelector('input[type="date"]'), {
      target: { value: "2027-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(commissionService.createRate).toHaveBeenCalledWith(
        { rateType: RATE_TYPES.VAT, percent: 14, effectiveFrom: "2027-01-01" },
        "admin-1",
      );
    });
    // Sent as a number: the service range-checks it, and numeric(6,3) would
    // otherwise be handed a string.
    expect(typeof commissionService.createRate.mock.calls[0][0].percent).toBe("number");
  });

  it("surfaces a rejected rate rather than failing silently", async () => {
    signedInAsSuperAdmin();
    commissionService.createRate.mockRejectedValue(
      new Error("Percent must be a number between 0 and 100."),
    );
    await openAddForm();

    fireEvent.change(screen.getByPlaceholderText("e.g. 12"), { target: { value: "120" } });
    fireEvent.change(document.querySelector('input[type="date"]'), {
      target: { value: "2027-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Percent must be a number between 0 and 100.");
    });
    // The form stays open so the value can be corrected.
    expect(screen.getByPlaceholderText("e.g. 12")).toBeInTheDocument();
  });

  it("closes and clears the form once a rate is accepted", async () => {
    signedInAsSuperAdmin();
    await openAddForm();

    fireEvent.change(screen.getByPlaceholderText("e.g. 12"), { target: { value: "2" } });
    fireEvent.change(document.querySelector('input[type="date"]'), {
      target: { value: "2027-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
    expect(screen.queryByPlaceholderText("e.g. 12")).not.toBeInTheDocument();

    // Reopening must not still hold the previous entry.
    fireEvent.click(screen.getByRole("button", { name: /Add Rate/i }));
    expect(screen.getByPlaceholderText("e.g. 12")).toHaveValue(null);
    expect(document.querySelector('input[type="date"]')).toHaveValue("");
  });

  it("does not submit an empty form", async () => {
    signedInAsSuperAdmin();
    await openAddForm();

    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    expect(commissionService.createRate).not.toHaveBeenCalled();
  });
});
