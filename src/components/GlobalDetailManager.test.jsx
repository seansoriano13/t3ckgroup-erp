import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import { renderWithProviders } from "../test/support";
import GlobalDetailManager from "./GlobalDetailManager";

const MOCK_OPP = {
  id: "opp-123",
  opportunity_no: "SOR-2026-0001",
  serial_no: 1,
  sales_reference: "S01234",
  client_name: "Acme Corp",
  project_title: "Acme CCTV Rollout",
  expected_value: 500000,
  status: "LEAD",
  project_type: "SSP",
  lead_source: "LGU",
  registration_date: "2026-08-01",
  deal_owner_id: "user-1",
  deal_owner: { id: "user-1", name: "Alice", avatar_path: null, department: "SALES" },
  registered_by: "user-1",
};

vi.mock("../services/opportunityService", () => ({
  opportunityService: {
    getOpportunityById: vi.fn(async (id) => {
      if (id === "opp-123") return MOCK_OPP;
      return null;
    }),
    // ADR 0021 / #297: GlobalDetailManager opens the SOR modal through this
    // now, not `getOpportunityById` directly — see the matching comment on
    // `getOpportunityForModal` in opportunityService.js.
    getOpportunityForModal: vi.fn(async (id) => {
      if (id !== "opp-123") return { accessLevel: "none", opportunity: null };
      return { accessLevel: "full", opportunity: MOCK_OPP };
    }),
    getAccessLevel: vi.fn(async () => "full"),
    getLockedSummary: vi.fn(async () => null),
    getItems: vi.fn(async () => []),
    getNotes: vi.fn(async () => []),
    getStageChecklist: vi.fn(async () => []),
  },
}));

vi.mock("../services/taskService", () => ({
  taskService: {
    getTaskById: vi.fn(async () => null),
    getMyOpenTasksForOpportunity: vi.fn(async () => []),
  },
}));

vi.mock("../services/groupTaskService", () => ({
  groupTaskService: {
    getGroupTaskById: vi.fn(async () => null),
  },
}));

vi.mock("../services/employeeService", () => ({
  employeeService: {
    getAllEmployees: vi.fn(async () => []),
  },
}));

vi.mock("../services/leadSourceService", () => ({
  leadSourceService: {
    getActiveLeadSources: vi.fn(async () => []),
  },
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", name: "Alice", isSuperAdmin: true },
  }),
}));

describe("GlobalDetailManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens OpportunityDetailsModal when OPEN_ENTITY_DETAILS is fired with type OPPORTUNITY", async () => {
    renderWithProviders(<GlobalDetailManager />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("OPEN_ENTITY_DETAILS", {
          detail: { id: "opp-123", type: "OPPORTUNITY" },
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Acme CCTV Rollout")).toBeInTheDocument();
      expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    });
  });

  it("opens Quick View, not the full modal, when OPEN_ENTITY_DETAILS is fired with type OPPORTUNITY_QUICK_VIEW", async () => {
    renderWithProviders(<GlobalDetailManager />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("OPEN_ENTITY_DETAILS", {
          detail: { id: "opp-123", type: "OPPORTUNITY_QUICK_VIEW" },
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("S01234")).toBeInTheDocument();
      expect(screen.getByText("Acme CCTV Rollout")).toBeInTheDocument();
    });
    // The full modal's expected-value field never renders in Quick View.
    expect(screen.queryByText("500000")).not.toBeInTheDocument();

    screen.getByRole("button", { name: "View Full Details" }).click();

    await waitFor(() => {
      expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    });
  });
});
