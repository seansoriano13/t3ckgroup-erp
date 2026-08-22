import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import toast from "react-hot-toast";

import CommissionAllocationManager from "./CommissionAllocationManager";
import { commissionService } from "../../services/commissionService";
import * as AuthContext from "../../context/AuthContext";

vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../services/commissionService", () => ({
  commissionService: {
    getDepartments: vi.fn(),
    saveDepartmentAllocations: vi.fn(),
    getPositions: vi.fn(),
    savePositionAllocations: vi.fn(),
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

// The regulation's department allocation, as migration 0028 seeds it.
const DEPARTMENTS = [
  { id: "d1", key: "sales", name: "Sales", allocationPercent: 50 },
  { id: "d2", key: "operations", name: "Operations", allocationPercent: 25 },
  { id: "d3", key: "administration", name: "Administration", allocationPercent: 15 },
  { id: "d4", key: "human_resources", name: "Human Resources", allocationPercent: 5 },
  { id: "d5", key: "finance_accounting", name: "Finance & Accounting", allocationPercent: 5 },
];

function signedInAsSuperAdmin() {
  vi.spyOn(AuthContext, "useAuth").mockReturnValue({
    user: { id: "admin-1", name: "Boss", isSuperAdmin: true },
  });
}

const rowFor = (name) => screen.getByText(name).closest("div.rounded-lg");

async function renderManager() {
  render(<CommissionAllocationManager />, { wrapper: createWrapper() });
  await waitFor(() => {
    expect(screen.getByText("Sales")).toBeInTheDocument();
  });
}

describe("CommissionAllocationManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commissionService.getDepartments.mockResolvedValue(DEPARTMENTS);
    commissionService.saveDepartmentAllocations.mockResolvedValue(DEPARTMENTS);
    commissionService.getPositions.mockResolvedValue([]);
    commissionService.savePositionAllocations.mockResolvedValue([]);
  });

  it("lists every department with its allocation, totalling 100%", async () => {
    signedInAsSuperAdmin();
    await renderManager();

    for (const dept of DEPARTMENTS) {
      expect(screen.getByText(dept.name)).toBeInTheDocument();
    }
    expect(screen.getByText("Total 100.00%")).toBeInTheDocument();
  });

  it("saves an edited allocation against the acting user, keeping the department id", async () => {
    signedInAsSuperAdmin();
    await renderManager();

    const salesInput = within(rowFor("Sales")).getByRole("spinbutton");
    fireEvent.change(salesInput, { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Departments/i }));

    await waitFor(() => {
      expect(commissionService.saveDepartmentAllocations).toHaveBeenCalled();
    });
    const [payload, actorId] = commissionService.saveDepartmentAllocations.mock.calls[0];
    expect(actorId).toBe("admin-1");
    // Updates go by id, never by name — a Super Admin may rename a department.
    expect(payload.find((d) => d.id === "d1")).toMatchObject({
      id: "d1",
      name: "Sales",
      allocationPercent: 45,
    });
    // Untouched departments must travel unchanged, not be dropped.
    expect(payload).toHaveLength(5);
    expect(payload.find((d) => d.id === "d2").allocationPercent).toBe(25);
  });

  it("flags a set that no longer totals 100%", async () => {
    signedInAsSuperAdmin();
    await renderManager();

    fireEvent.change(within(rowFor("Sales")).getByRole("spinbutton"), {
      target: { value: "45" },
    });

    // 45 + 25 + 15 + 5 + 5
    expect(screen.getByText("Total 95.00%")).toBeInTheDocument();
  });

  it("surfaces a rejected save rather than appearing to succeed", async () => {
    signedInAsSuperAdmin();
    commissionService.saveDepartmentAllocations.mockRejectedValue(
      new Error("Department allocations must sum to 100% (currently 95.00%)."),
    );
    await renderManager();

    fireEvent.change(within(rowFor("Sales")).getByRole("spinbutton"), {
      target: { value: "45" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Departments/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Department allocations must sum to 100% (currently 95.00%).",
      );
    });
  });

  it("loads a department's positions only once it is expanded", async () => {
    signedInAsSuperAdmin();
    commissionService.getPositions.mockResolvedValue([
      { id: "p1", name: "Operations Manager", allocationPercent: 25 },
      { id: "p2", name: "Purchasing & Procurement", allocationPercent: 75 },
    ]);
    await renderManager();

    expect(commissionService.getPositions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Operations"));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Operations Manager")).toBeInTheDocument();
    });
    expect(commissionService.getPositions).toHaveBeenCalledWith("d2");
  });

  it("saves a newly added position with the department it belongs to", async () => {
    signedInAsSuperAdmin();
    await renderManager();

    fireEvent.click(screen.getByText("Human Resources"));
    await waitFor(() => {
      expect(screen.getByText("No positions yet.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Add Position/i }));
    fireEvent.change(screen.getByPlaceholderText("Position name"), {
      target: { value: "HR Manager" },
    });
    const percentInput = screen
      .getByPlaceholderText("Position name")
      .parentElement.querySelector('input[type="number"]');
    fireEvent.change(percentInput, { target: { value: "100" } });

    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(commissionService.savePositionAllocations).toHaveBeenCalledWith(
        "d4",
        [{ name: "HR Manager", allocationPercent: 100 }],
        "admin-1",
      );
    });
  });

  it("lets a department's positions be cleared entirely", async () => {
    signedInAsSuperAdmin();
    commissionService.getPositions.mockResolvedValue([
      { id: "p1", name: "Sole Position", allocationPercent: 100 },
    ]);
    await renderManager();

    fireEvent.click(screen.getByText("Finance & Accounting"));
    await waitFor(() => {
      expect(screen.getByDisplayValue("Sole Position")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Remove Sole Position/i }));
    // Every department currently has no positions at all, so "none" has to be
    // a state the editor can actually save.
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(commissionService.savePositionAllocations).toHaveBeenCalledWith("d5", [], "admin-1");
    });
  });
});
