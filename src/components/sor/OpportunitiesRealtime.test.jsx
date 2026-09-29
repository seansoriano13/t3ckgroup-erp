import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { renderWithProviders } from "../../test/support";
import OpportunitiesPage from "../../pages/sors/index";
import { opportunityService } from "../../services/opportunityService";
import { supabase } from "../../lib/supabase";

/**
 * Two people can act on the same SOR; the register used to show whatever it
 * loaded until the next refresh. The fake Supabase has no WebSocket layer, so
 * the channel is stubbed and its broadcast callback invoked directly (the same
 * technique as hooks/useTableRealtime.test.jsx).
 */
const OPP = {
  id: "opp-1",
  opportunity_no: "SOR-2026-0001",
  serial_no: 1,
  client_name: "Acme",
  project_title: "Acme CCTV Rollout",
  expected_value: 100000,
  status: "LEAD",
  project_type: "SSP",
  lead_source: "LGU",
  registration_date: "2026-08-01",
  deal_owner_id: "user-1",
  deal_owner: { id: "user-1", name: "Alice", avatar_path: null, department: "SALES" },
  registered_by: "user-1",
};

vi.mock("../../services/opportunityService", () => ({
  opportunityService: {
    getOpportunities: vi.fn(async () => [OPP]),
    getOpportunityById: vi.fn(async () => null),
    getItems: vi.fn(async () => []),
    getNotes: vi.fn(async () => []),
    getMembers: vi.fn(async () => []),
    getStageChecklist: vi.fn(async () => []),
    getBlockedDeals: vi.fn(async () => ({})),
    getDeadlineStatuses: vi.fn(async () => ({})),
    checkDeadlineNotifications: vi.fn(async () => []),
  },
}));

vi.mock("../../services/employeeService", () => ({
  employeeService: {
    getAllEmployees: vi.fn(async () => [{ id: "user-1", name: "Alice", department: "SALES", subDepartment: "" }]),
  },
}));

vi.mock("../../services/leadSourceService", () => ({
  leadSourceService: { getActiveLeadSources: vi.fn(async () => [{ value: "LGU", label: "LGU" }]) },
}));

vi.mock("../../services/purchasingService", () => ({
  purchasingService: { listForOpportunity: vi.fn(async () => []) },
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", name: "Alice", isSuperAdmin: true } }),
}));

const broadcastHandlers = [];
const channelMock = {
  on: vi.fn((_type, _filter, handler) => {
    broadcastHandlers.push(handler);
    return channelMock;
  }),
  subscribe: vi.fn(() => channelMock),
};

describe("register live updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    broadcastHandlers.length = 0;
    vi.spyOn(supabase, "channel").mockReturnValue(channelMock);
    vi.spyOn(supabase, "removeChannel").mockImplementation(() => {});
    vi.spyOn(supabase.realtime, "setAuth").mockResolvedValue(undefined);
  });

  it("listens for changes to SORs on the private sales_opportunities channel", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={[{ pathname: "/sors", state: { filterEmployeeId: "ALL" } }]}>
        <OpportunitiesPage />
      </MemoryRouter>,
    );
    await screen.findByText("Acme CCTV Rollout");

    expect(supabase.channel).toHaveBeenCalledWith("sales_opportunities-changes", { config: { private: true } });
  });

  it("reloads the register once when another person's change is announced", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={[{ pathname: "/sors", state: { filterEmployeeId: "ALL" } }]}>
        <OpportunitiesPage />
      </MemoryRouter>,
    );
    await screen.findByText("Acme CCTV Rollout");
    const loadsBefore = opportunityService.getOpportunities.mock.calls.length;

    // A move that touches the row twice announces twice.
    broadcastHandlers[0]({ event: "UPDATE" });
    broadcastHandlers[0]({ event: "UPDATE" });

    await waitFor(
      () => expect(opportunityService.getOpportunities).toHaveBeenCalledTimes(loadsBefore + 1),
      { timeout: 3000 },
    );
  });
});
