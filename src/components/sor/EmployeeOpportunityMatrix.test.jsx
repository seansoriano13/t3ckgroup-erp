import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import EmployeeOpportunityMatrix from "./EmployeeOpportunityMatrix";
import { renderWithProviders } from "@/test/support";
import { makePipelineStage } from "@/test/factories";

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}));
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}));

const mockOpportunities = [
  {
    id: "opp-1",
    title: "Enterprise ERP Upgrade",
    status: "PROPOSAL_SUBMITTED",
    expected_value: 1200000,
    deal_owner_id: "user-1",
    deal_owner: {
      id: "user-1",
      name: "Juan Dela Cruz",
      department: "Sales",
      sub_department: "Enterprise",
      avatar_path: "https://example.com/juan.png",
    },
  },
  {
    id: "opp-2",
    title: "Cloud Migration Phase 2",
    status: "CLOSED_WON",
    expected_value: 800000,
    deal_owner_id: "user-1",
    deal_owner: {
      id: "user-1",
      name: "Juan Dela Cruz",
      department: "Sales",
      sub_department: "Enterprise",
      avatar_path: "https://example.com/juan.png",
    },
  },
  {
    id: "opp-3",
    title: "Security Assessment",
    status: "QUALIFIED",
    expected_value: 450000,
    deal_owner_id: "user-2",
    deal_owner: {
      id: "user-2",
      name: "Maria Santos",
      department: "Sales",
      sub_department: "Commercial",
      avatar_path: "https://example.com/maria.png",
    },
  },
];

const adminUser = {
  id: "admin-1",
  name: "Super Admin",
  isSuperAdmin: true,
};

describe("EmployeeOpportunityMatrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.current = adminUser;
  });

  it("renders list view by default with layout switcher controls", () => {
    renderWithProviders(
      <EmployeeOpportunityMatrix opportunities={mockOpportunities} />,
    );

    expect(screen.getByText("Team Opportunity Radar")).toBeInTheDocument();
    expect(screen.getByText("2 salespeople")).toBeInTheDocument();
    expect(screen.getByText("Juan Dela Cruz")).toBeInTheDocument();
    expect(screen.getByText("Maria Santos")).toBeInTheDocument();

    // Verify 3 layout toggle buttons exist
    expect(screen.getByTitle("List View")).toBeInTheDocument();
    expect(screen.getByTitle("Leaderboard View")).toBeInTheDocument();
    expect(screen.getByTitle("Full Grid")).toBeInTheDocument();
  });

  it("still shows an opportunity sitting in a stage that was since deactivated", async () => {
    // Deactivating a stage is supposed to remove it from pickers only — an
    // opportunity already sitting there must keep showing up in the matrix.
    makePipelineStage({ code: "PROPOSAL_SUBMITTED", label: "Proposal Submitted", sort_order: 30, is_active: true })
    makePipelineStage({ code: "RETIRED_STAGE", label: "Retired Stage", sort_order: 35, is_active: false })

    const opportunitiesWithRetired = [
      ...mockOpportunities,
      {
        id: "opp-4",
        title: "Legacy Deal In Retired Stage",
        status: "RETIRED_STAGE",
        expected_value: 300000,
        deal_owner_id: "user-2",
        deal_owner: {
          id: "user-2",
          name: "Maria Santos",
          department: "Sales",
          sub_department: "Commercial",
          avatar_path: "https://example.com/maria.png",
        },
      },
    ];

    renderWithProviders(
      <EmployeeOpportunityMatrix opportunities={opportunitiesWithRetired} />,
    );

    expect(await screen.findByTitle("1 Retired Stage")).toBeInTheDocument();
  });

  it("switches to Leaderboard View and Full Grid layout modes", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(
      <EmployeeOpportunityMatrix opportunities={mockOpportunities} />,
    );

    // Click Leaderboard View
    await user.click(screen.getByTitle("Leaderboard View"));
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();

    // Click Full Grid
    await user.click(screen.getByTitle("Full Grid"));
    expect(container.querySelector(".grid-cols-1")).toBeInTheDocument();

    // Click List View again
    await user.click(screen.getByTitle("List View"));
    expect(container.querySelector(".flex-col")).toBeInTheDocument();
  });

  it("filters salespeople when typing into the search input and clears on reset", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <EmployeeOpportunityMatrix opportunities={mockOpportunities} />,
    );

    const searchInput = screen.getByPlaceholderText("Search employee...");
    await user.type(searchInput, "Maria");

    expect(screen.getByText((content, element) => element?.tagName.toLowerCase() === "h3" && element.textContent.includes("Maria Santos"))).toBeInTheDocument();
    expect(screen.queryByText("Juan Dela Cruz")).not.toBeInTheDocument();

    // Clear search
    await user.clear(searchInput);
    expect(screen.getByText((content, element) => element?.tagName.toLowerCase() === "h3" && element.textContent.includes("Juan Dela Cruz"))).toBeInTheDocument();
  });

  it("navigates to opportunities page with filter params on row and stage click", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <EmployeeOpportunityMatrix opportunities={mockOpportunities} />,
    );

    // Click row
    await user.click(screen.getByText("Juan Dela Cruz"));
    expect(mockNavigate).toHaveBeenCalledWith("/opportunities", {
      state: { filterEmployeeId: "user-1", filterStatus: undefined },
    });

    // Click stage segment or dot
    const proposalLabels = screen.getAllByText(/Proposal/i);
    expect(proposalLabels.length).toBeGreaterThan(0);
    await user.click(proposalLabels[0]);

    expect(mockNavigate).toHaveBeenCalledWith("/opportunities", {
      state: { filterEmployeeId: "user-1", filterStatus: "PROPOSAL_SUBMITTED" },
    });
  });

  it("renders pipeline value badge and win rate in Grid cards", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <EmployeeOpportunityMatrix opportunities={mockOpportunities} />,
    );

    // Switch to Grid view
    await user.click(screen.getByTitle("Full Grid"));

    // Check Win Rate footer
    expect(screen.getAllByText("Win Rate").length).toBe(2);
    // Juan has 1 won out of 2 deals = 50%
    expect(screen.getByText("50%")).toBeInTheDocument();
    // Maria has 0 won out of 1 deal = 0%
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("restricts displayed salespeople to department for Department Heads", () => {
    mockUser.current = {
      id: "head-1",
      name: "IT Head",
      isHead: true,
      isHr: false,
      isSuperAdmin: false,
      department: "IT",
    };

    const opps = [
      ...mockOpportunities,
      {
        id: "opp-4",
        title: "IT Infrastructure",
        status: "QUALIFIED",
        expected_value: 100000,
        deal_owner_id: "user-it",
        deal_owner: {
          id: "user-it",
          name: "Alex Rivera",
          department: "IT",
          sub_department: "Infrastructure",
          avatar_path: null,
        },
      },
    ];

    renderWithProviders(
      <EmployeeOpportunityMatrix opportunities={opps} />,
    );

    expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
    expect(screen.queryByText("Juan Dela Cruz")).not.toBeInTheDocument();
    expect(screen.queryByText("Maria Santos")).not.toBeInTheDocument();
  });
});
