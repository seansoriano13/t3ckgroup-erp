import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { renderWithProviders } from "../../test/support";
import OpportunitiesPage from "../../pages/opportunities/index";
import { opportunityService } from "../../services/opportunityService";

const MOCK_OPP_1 = {
  id: "opp-uuid-1",
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

const MOCK_OPP_2 = {
  id: "opp-uuid-2",
  opportunity_no: "SOR-2026-0002",
  serial_no: 2,
  sales_reference: "S01235",
  client_name: "Beta Industries",
  project_title: "Beta Network Upgrade",
  expected_value: 250000,
  status: "QUALIFIED",
  project_type: "CP",
  lead_source: "DIRECT",
  registration_date: "2026-08-02",
  deal_owner_id: "user-2",
  deal_owner: { id: "user-2", name: "Bob", avatar_path: null, department: "SALES" },
  registered_by: "user-2",
};

vi.mock("../../services/opportunityService", () => ({
  opportunityService: {
    getOpportunities: vi.fn(async () => [MOCK_OPP_1, MOCK_OPP_2]),
    getOpportunityById: vi.fn(async (id) => {
      if (id === "opp-uuid-1") return MOCK_OPP_1;
      if (id === "opp-uuid-2") return MOCK_OPP_2;
      return null;
    }),
    getItems: vi.fn(async () => []),
    getNotes: vi.fn(async () => []),
    getMembers: vi.fn(async () => []),
    getStageChecklist: vi.fn(async () => []),
    getBlockedDeals: vi.fn(async () => ({})),
  },
}));

vi.mock("../../services/employeeService", () => ({
  employeeService: {
    getAllEmployees: vi.fn(async () => [
      { id: "user-1", name: "Alice", department: "SALES", subDepartment: "" },
      { id: "user-2", name: "Bob", department: "SALES", subDepartment: "" },
    ]),
  },
}));

vi.mock("../../services/leadSourceService", () => ({
  leadSourceService: {
    getActiveLeadSources: vi.fn(async () => [
      { value: "LGU", label: "LGU" },
      { value: "DIRECT", label: "Direct" },
    ]),
  },
}));

vi.mock("../../services/procurementService", () => ({
  procurementService: {
    listForOpportunity: vi.fn(async () => []),
  },
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", name: "Alice", isSuperAdmin: true },
  }),
}));

describe("OpportunitiesPage Deep Linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens OpportunityDetailsModal immediately when navigated to with openOpportunityId state", async () => {
    renderWithProviders(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/opportunities",
            state: { openOpportunityId: "opp-uuid-1" },
          },
        ]}
      >
        <OpportunitiesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Acme CCTV Rollout").length).toBeGreaterThan(0);
    });
  });

  it("applies employee filter when navigated to with filterEmployeeId state", async () => {
    renderWithProviders(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/opportunities",
            state: { filterEmployeeId: "user-2" },
          },
        ]}
      >
        <OpportunitiesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Beta Network Upgrade")).toBeInTheDocument();
    });
  });
});

describe("Sales Director visibility — blocked deals (ticket 6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opportunityService.getOpportunities.mockResolvedValue([MOCK_OPP_1, MOCK_OPP_2]);
  });

  it("flags a blocked deal in the register with what it's missing", async () => {
    opportunityService.getBlockedDeals.mockResolvedValue({
      "opp-uuid-1": [{ id: "req-1", label: "Bid documents checked" }],
    });

    renderWithProviders(
      <MemoryRouter initialEntries={["/opportunities"]}>
        <OpportunitiesPage />
      </MemoryRouter>,
    );

    await screen.findByText("Acme CCTV Rollout");
    expect(await screen.findByTitle(/Blocked on: Bid documents checked/i)).toBeInTheDocument();
  });

  it("lets a Sales Director filter the register down to only blocked deals", async () => {
    opportunityService.getBlockedDeals.mockResolvedValue({
      "opp-uuid-1": [{ id: "req-1", label: "Bid documents checked" }],
    });
    const user = userEvent.setup();

    renderWithProviders(
      <MemoryRouter initialEntries={["/opportunities"]}>
        <OpportunitiesPage />
      </MemoryRouter>,
    );

    await screen.findByText("Beta Network Upgrade");
    await user.click(screen.getByRole("button", { name: /^blocked$/i }));

    expect(screen.getByText("Acme CCTV Rollout")).toBeInTheDocument();
    expect(screen.queryByText("Beta Network Upgrade")).toBeNull();
  });

  it("shows no blocked marker for a register with nothing outstanding", async () => {
    opportunityService.getBlockedDeals.mockResolvedValue({});

    renderWithProviders(
      <MemoryRouter initialEntries={["/opportunities"]}>
        <OpportunitiesPage />
      </MemoryRouter>,
    );

    await screen.findByText("Acme CCTV Rollout");
    expect(screen.queryByTitle(/Blocked on:/i)).toBeNull();
  });
});
