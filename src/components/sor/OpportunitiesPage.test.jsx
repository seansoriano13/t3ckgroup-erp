import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { renderWithProviders, setupUser } from "../../test/support";
import OpportunitiesPage from "../../pages/sors/index";
import { opportunityService } from "../../services/opportunityService";
import { makeFlowSnapshot } from "../../test/factories";

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
    getDeadlineStatuses: vi.fn(async () => ({})),
    checkDeadlineNotifications: vi.fn(async () => []),
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

vi.mock("../../services/purchasingService", () => ({
  purchasingService: {
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
    const user = setupUser();

    renderWithProviders(
      <MemoryRouter initialEntries={["/opportunities"]}>
        <OpportunitiesPage />
      </MemoryRouter>,
    );

    await screen.findByText("Beta Network Upgrade");
    // Issue #206 — every filter lives inside the Filters popover now.
    await user.click(screen.getByText("Filters"));
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

describe("Deadline kind — countdown + notifications (ticket 7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opportunityService.getOpportunities.mockResolvedValue([MOCK_OPP_1, MOCK_OPP_2]);
  });

  it("marks a deal past its deadline in the register", async () => {
    opportunityService.getDeadlineStatuses.mockResolvedValue({
      "opp-uuid-1": {
        condition: { label: "Confirm receipt" },
        daysRemaining: -2,
        isBreached: true,
        isApproaching: false,
      },
    });

    renderWithProviders(
      <MemoryRouter initialEntries={["/opportunities"]}>
        <OpportunitiesPage />
      </MemoryRouter>,
    );

    await screen.findByText("Acme CCTV Rollout");
    expect(await screen.findByTitle('Deadline passed: "Confirm receipt"')).toBeInTheDocument();
  });

  it("checks for approach/breach notifications once, against the open deals loaded", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={["/opportunities"]}>
        <OpportunitiesPage />
      </MemoryRouter>,
    );

    await screen.findByText("Acme CCTV Rollout");

    await waitFor(() => expect(opportunityService.checkDeadlineNotifications).toHaveBeenCalledTimes(1));
    const [checked] = opportunityService.checkDeadlineNotifications.mock.calls[0];
    expect(checked.map((o) => o.id).sort()).toEqual(["opp-uuid-1", "opp-uuid-2"]);
  });
});

// Issue #199 — Open pipeline value follows the glossary: no Contract Date and
// not on a Terminal Stage, each flow SOR judged against its own snapshot.
describe("Open Pipeline value", () => {
  const snapshotData = {
    wonStageId: "stage-won",
    stages: [
      { id: "stage-lead", name: "Lead", is_terminal: false },
      { id: "stage-won", name: "Won", is_terminal: false },
      { id: "stage-delivery", name: "Delivery", is_terminal: false },
      { id: "stage-lost", name: "Lost", is_terminal: true },
    ],
  }
  const row = (id, title, value, extra) => ({
    ...MOCK_OPP_1,
    id,
    serial_no: value,
    project_title: title,
    expected_value: value,
    contract_date: null,
    ...extra,
  })
  let openFlow, wonFlow, lostFlow, openLegacy, wonLegacy

  beforeEach(() => {
    vi.clearAllMocks()
    const snapshot = makeFlowSnapshot({ snapshot_data: snapshotData })
    const flow = { sale_type_id: "st-1", flow_snapshot_id: snapshot.id, status: "LEAD" }
    openFlow = row("o-open-flow", "Open flow deal", 1000, { ...flow, flow_stage_id: "stage-lead" })
    wonFlow = row("o-won-flow", "Won flow deal", 20000, { ...flow, flow_stage_id: "stage-delivery", contract_date: "2026-08-10" })
    lostFlow = row("o-lost-flow", "Lost flow deal", 300000, { ...flow, flow_stage_id: "stage-lost" })
    openLegacy = row("o-open-legacy", "Open legacy deal", 4000, { status: "NEGOTIATION" })
    wonLegacy = row("o-won-legacy", "Won legacy deal", 50000, { status: "AWARDED", contract_date: "2026-08-11" })
    opportunityService.getOpportunities.mockResolvedValue([openFlow, wonFlow, lostFlow, openLegacy, wonLegacy])
  })

  const renderPage = (state) =>
    renderWithProviders(
      <MemoryRouter initialEntries={[{ pathname: "/opportunities", state }]}>
        <OpportunitiesPage />
      </MemoryRouter>,
    )

  it("adds up only SORs with no Contract Date on a non-terminal Stage", async () => {
    renderPage()

    expect(await screen.findByText("₱5,000.00")).toBeInTheDocument()
  })

  it("lists exactly those SORs under the Open filter", async () => {
    renderPage({ filterStatus: "OPEN" })

    expect(await screen.findByText("Open flow deal")).toBeInTheDocument()
    expect(await screen.findByText("Open legacy deal")).toBeInTheDocument()
    expect(screen.queryByText("Won flow deal")).toBeNull()
    expect(screen.queryByText("Lost flow deal")).toBeNull()
    expect(screen.queryByText("Won legacy deal")).toBeNull()
    expect(screen.getByText("₱5,000.00")).toBeInTheDocument()
  })

  it("still flags a won SOR working through a post-award Stage as Blocked, and leaves the lost one out", async () => {
    opportunityService.getBlockedDeals.mockResolvedValue({
      "o-won-flow": [{ id: "req-1", label: "Delivery receipt" }],
    })

    renderPage()

    expect(await screen.findByTitle(/Blocked on: Delivery receipt/i)).toBeInTheDocument()
    await waitFor(() => {
      const scoped = opportunityService.getBlockedDeals.mock.calls.at(-1)[0].map((o) => o.id)
      expect(scoped).toEqual(expect.arrayContaining(["o-won-flow", "o-open-flow", "o-won-legacy"]))
      expect(scoped).not.toContain("o-lost-flow")
    })
  })

  // Issue #206 — Won sits beside Open pipeline in the toolbar.
  it("shows the Won total for Realized SORs alongside Open pipeline", async () => {
    renderPage()

    expect(await screen.findByText("₱5,000.00")).toBeInTheDocument()
    expect(screen.getByText("₱70,000.00")).toBeInTheDocument()
  })
})

// Issue #206 — the register's default order sinks a Terminal Stage SOR to
// the bottom; an explicit column sort overrides it.
describe("default sort sinks Terminal Stage SORs", () => {
  const row = (id, serialNo, extra) => ({
    ...MOCK_OPP_1,
    id,
    serial_no: serialNo,
    client_name: `Company ${serialNo}`,
    project_title: `Project ${serialNo}`,
    ...extra,
  })
  let notTerminal, terminal

  beforeEach(() => {
    vi.clearAllMocks()
    // Terminal (CLOSED_WON) has the higher serial_no — under the untouched
    // "SOR" sort it would render first, but it must sink below the
    // still-moving one instead.
    notTerminal = row("o-open", 1, { status: "NEGOTIATION" })
    terminal = row("o-terminal", 2, { status: "CLOSED_WON" })
    opportunityService.getOpportunities.mockResolvedValue([notTerminal, terminal])
  })

  const renderPage = () =>
    renderWithProviders(
      <MemoryRouter initialEntries={["/opportunities"]}>
        <OpportunitiesPage />
      </MemoryRouter>,
    )

  const rowOrder = () =>
    screen
      .getAllByText(/^Company \d$/)
      .map((el) => el.textContent)

  it("sinks the Terminal Stage SOR below the still-moving one by default", async () => {
    renderPage()

    await screen.findByText("Company 1")
    expect(rowOrder()).toEqual(["Company 1", "Company 2"])
  })

  it("lets an explicit column sort override the sink", async () => {
    const user = setupUser()
    renderPage()

    await screen.findByText("Company 1")
    // Sorting by No. is an explicit choice even though it happens to be the
    // same field the default order reads — clicking the header is what
    // flips hasExplicitSort. Ascending first (ties the sink's own order),
    // then descending — which the sink would never produce, since it always
    // sinks the terminal SOR regardless of column direction.
    await user.click(screen.getByText("SOR"))
    await user.click(screen.getByText("SOR"))

    expect(rowOrder()).toEqual(["Company 2", "Company 1"])
  })
})
