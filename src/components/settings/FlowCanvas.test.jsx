import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FlowCanvas from "./FlowCanvas";
import { salesFlowService } from "../../services/salesFlowService";
import * as AuthContext from "../../context/AuthContext";

vi.mock("../../services/salesFlowService", () => ({
  salesFlowService: {
    getSaleTypes: vi.fn(),
    getFlow: vi.fn(),
    createSaleType: vi.fn(),
    renameSaleType: vi.fn(),
    archiveSaleType: vi.fn(),
    addStage: vi.fn(),
    renameStage: vi.fn(),
    reorderStages: vi.fn(),
    setStageTerminal: vi.fn(),
    deleteStage: vi.fn(),
    addEdge: vi.fn(),
    removeEdge: vi.fn(),
    setWonStage: vi.fn(),
    lockFlow: vi.fn(),
    unlockFlow: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const SALE_TYPE = { id: "st-1", name: "Government Bidding" };

const stage = (id, name, sort_order, overrides = {}) => ({
  id,
  flow_id: "flow-1",
  name,
  sort_order,
  is_terminal: false,
  ...overrides,
});

/**
 * Issue #36 keeps canvas UI coverage deliberately minimal: the drawing
 * surface is scheduled to be hidden once the flow it produces is implemented,
 * and heavily testing the one genuinely disposable part of the project is
 * spending in the wrong place.
 *
 * So this proves only that the canvas reads and writes configuration
 * correctly. Everything about what a flow MEANS — legal moves, where deals
 * enter, why a flow cannot be locked — is constants/salesFlow.js's job and is
 * tested there against literals, not through a rendered component.
 */
describe("FlowCanvas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user: { id: "user-admin", is_super_admin: true, name: "Super Admin" },
    });
  });

  it("says the list starts empty rather than proposing Sale Types", async () => {
    salesFlowService.getSaleTypes.mockResolvedValue([]);

    render(<FlowCanvas />, { wrapper: createWrapper() });

    expect(await screen.findByText("No Sale Types yet")).toBeInTheDocument();
    expect(salesFlowService.getFlow).not.toHaveBeenCalled();
  });

  it("renders a flow's Stages, marking where deals enter and where they are won", async () => {
    salesFlowService.getSaleTypes.mockResolvedValue([SALE_TYPE]);
    salesFlowService.getFlow.mockResolvedValue({
      saleType: SALE_TYPE,
      flow: { id: "flow-1", sale_type_id: "st-1", state: "draft", won_stage_id: "s-won" },
      stages: [stage("s-lead", "Lead", 0), stage("s-won", "Awarded", 1)],
      edges: [{ id: "e-1", flow_id: "flow-1", from_stage_id: "s-lead", to_stage_id: "s-won" }],
    });

    render(<FlowCanvas />, { wrapper: createWrapper() });

    const rows = within(await screen.findByRole("list", { name: "Stages" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Deals enter here")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/Won/)).toBeInTheDocument();
  });

  it("draws a move by ticking a destination", async () => {
    const user = userEvent.setup();
    salesFlowService.getSaleTypes.mockResolvedValue([SALE_TYPE]);
    salesFlowService.getFlow.mockResolvedValue({
      saleType: SALE_TYPE,
      flow: { id: "flow-1", sale_type_id: "st-1", state: "draft", won_stage_id: null },
      stages: [stage("s-lead", "Lead", 0), stage("s-won", "Awarded", 1)],
      edges: [],
    });
    salesFlowService.addEdge.mockResolvedValue({ id: "e-1" });

    render(<FlowCanvas />, { wrapper: createWrapper() });

    // Every Stage name appears several times on this screen — as its own
    // heading, as a destination under each other Stage, and in the Won Stage
    // picker. The one being clicked is the destination inside Lead's own row.
    const [leadRow] = within(await screen.findByRole("list", { name: "Stages" })).getAllByRole(
      "listitem",
    );
    await user.click(within(leadRow).getByRole("button", { name: "Awarded" }));

    await waitFor(() =>
      expect(salesFlowService.addEdge).toHaveBeenCalledWith("flow-1", "s-lead", "s-won", "user-admin"),
    );
  });

  it("shows why a flow cannot be locked yet, and disables locking", async () => {
    salesFlowService.getSaleTypes.mockResolvedValue([SALE_TYPE]);
    salesFlowService.getFlow.mockResolvedValue({
      saleType: SALE_TYPE,
      flow: { id: "flow-1", sale_type_id: "st-1", state: "draft", won_stage_id: null },
      stages: [stage("s-lead", "Lead", 0)],
      edges: [],
    });

    render(<FlowCanvas />, { wrapper: createWrapper() });

    expect(
      await screen.findByText("This flow has no Won Stage — set where the deal is won."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lock this flow/ })).toBeDisabled();
  });

  it("hides every edit control once the flow is locked", async () => {
    salesFlowService.getSaleTypes.mockResolvedValue([SALE_TYPE]);
    salesFlowService.getFlow.mockResolvedValue({
      saleType: SALE_TYPE,
      flow: {
        id: "flow-1",
        sale_type_id: "st-1",
        state: "locked",
        won_stage_id: "s-won",
        locked_at: "2026-08-27T00:00:00Z",
      },
      stages: [stage("s-lead", "Lead", 0), stage("s-won", "Awarded", 1)],
      edges: [{ id: "e-1", flow_id: "flow-1", from_stage_id: "s-lead", to_stage_id: "s-won" }],
    });

    render(<FlowCanvas />, { wrapper: createWrapper() });

    expect(await screen.findByRole("button", { name: /Unlock/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Stage/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move up" })).not.toBeInTheDocument();
  });
});
