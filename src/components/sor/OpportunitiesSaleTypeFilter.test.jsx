import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { renderWithProviders, setupUser } from "../../test/support";
import OpportunitiesPage from "../../pages/sors/index";
import { makeSaleType } from "../../test/factories";

/**
 * The register could only be filtered by Sales Division (SSP / CP / Strategic),
 * never by the Sale Type a deal was registered against — so with several flows
 * live there was no way to look at, say, only Government deals.
 */
let governmentId;

const opp = (overrides) => ({
  opportunity_no: "SOR-2026-0001",
  serial_no: 1,
  client_name: "Client",
  expected_value: 100000,
  status: "LEAD",
  project_type: "SSP",
  lead_source: "LGU",
  registration_date: "2026-08-01",
  deal_owner_id: "user-1",
  deal_owner: { id: "user-1", name: "Alice", avatar_path: null, department: "SALES" },
  registered_by: "user-1",
  ...overrides,
});

vi.mock("../../services/opportunityService", () => ({
  opportunityService: {
    getOpportunities: vi.fn(async () => [
      opp({ id: "opp-gov", serial_no: 1, project_title: "Government Deal", sale_type_id: governmentId }),
      opp({ id: "opp-old", serial_no: 2, project_title: "Legacy Deal", sale_type_id: null }),
    ]),
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

// The register's filters live in one "Filters" popover, each its own dropdown.
async function openSaleTypeFilter(user) {
  await user.click(await screen.findByText("Filters"));
  await user.click(await screen.findByText("All SORs"));
}

function renderRegister() {
  // A filterEmployeeId in router state opens the list view, which is the one with rows to assert on.
  return renderWithProviders(
    <MemoryRouter initialEntries={[{ pathname: "/sors", state: { filterEmployeeId: "ALL" } }]}>
      <OpportunitiesPage />
    </MemoryRouter>,
  );
}

describe("register Sale Type filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    governmentId = makeSaleType({ name: "Government" }).id;
    makeSaleType({ name: "Outright" });
    makeSaleType({ name: "Retired Flow", archived_at: "2026-01-01T00:00:00.000Z" });
  });

  it("offers every Sale Type — archived ones too — plus the legacy no-Sale-Type deals", async () => {
    renderRegister();
    await openSaleTypeFilter(setupUser());

    expect(await screen.findByText("Government")).toBeInTheDocument();
    expect(screen.getByText("Outright")).toBeInTheDocument();
    expect(screen.getByText("Retired Flow (archived)")).toBeInTheDocument();
    expect(screen.getByText("No Sale Type (legacy)")).toBeInTheDocument();
  });

  it("narrows the register to one Sale Type's deals", async () => {
    const user = setupUser();
    renderRegister();
    await screen.findByText("Legacy Deal");

    await openSaleTypeFilter(user);
    await user.click(await screen.findByText("Government"));

    await waitFor(() => expect(screen.queryByText("Legacy Deal")).not.toBeInTheDocument());
    expect(screen.getByText("Government Deal")).toBeInTheDocument();
  });

  it("finds deals registered before Sale Types existed", async () => {
    const user = setupUser();
    renderRegister();
    await screen.findByText("Government Deal");

    await openSaleTypeFilter(user);
    await user.click(await screen.findByText("No Sale Type (legacy)"));

    await waitFor(() => expect(screen.queryByText("Government Deal")).not.toBeInTheDocument());
    expect(screen.getByText("Legacy Deal")).toBeInTheDocument();
  });

  it("offers the filter on the Board inside the Filters popover", async () => {
    const user = setupUser();
    renderRegister();
    await screen.findByText("Government Deal");

    await user.click(screen.getByText("Board"));
    await user.click(await screen.findByText("Filters"));

    await screen.findByText("All Departments");
    // Appears on both the Board switcher and the Filters popover
    expect(screen.getAllByText("All SORs").length).toBeGreaterThanOrEqual(2);
  });
});
