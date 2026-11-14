import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import EmployeeOpportunityMatrix from "./EmployeeOpportunityMatrix";
import { renderWithProviders, setupUser } from "@/test/support";
import { makePipelineStage } from "@/test/factories";

vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "a", isSuperAdmin: true } }) }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "a", isSuperAdmin: true } }) }));

const flowStages = [
  { id: "fs-lead", flow_id: "flow-1", name: "Lead", sort_order: 0 },
  { id: "fs-ntp", flow_id: "flow-1", name: "Notice to Proceed", sort_order: 1 },
  { id: "fs-po", flow_id: "flow-1", name: "PO Received", sort_order: 2 },
];
const snapshot = {
  wonStageId: "fs-ntp",
  stages: flowStages,
  edges: [
    { from_stage_id: "fs-lead", to_stage_id: "fs-ntp" },
    { from_stage_id: "fs-ntp", to_stage_id: "fs-po" },
  ],
};

vi.mock("../../services/salesFlowService", () => ({
  salesFlowService: {
    getAllStagesIndex: vi.fn(async () => ({
      flowsById: { "flow-1": { id: "flow-1", name: "Flow", won_stage_id: "fs-ntp" } },
      stagesById: Object.fromEntries(flowStages.map((s) => [s.id, s])),
      stagesByFlow: { "flow-1": flowStages },
    })),
    getSnapshotsByIds: vi.fn(async () => ({ "snap-1": { snapshot_data: snapshot } })),
  },
}));

const owner = { id: "u1", name: "Juan Dela Cruz", department: "Sales", sub_department: "Ent" };
const legacy = (id, status) => ({ id, status, expected_value: 100, deal_owner: owner });
const flowSor = (id, stageId) => ({
  id, status: "LEAD", sale_type_id: "st-1", flow_snapshot_id: "snap-1", flow_stage_id: stageId,
  expected_value: 100, deal_owner: owner,
});

describe("EmployeeOpportunityMatrix stage and Won", () => {
  beforeEach(() => {
    makePipelineStage({ code: "LEAD", label: "Lead", sort_order: 10, is_active: true });
    makePipelineStage({ code: "AWARDED", label: "Awarded", sort_order: 50, is_active: true, is_anchor: true });
    makePipelineStage({ code: "PO_RECEIVED", label: "PO Received", sort_order: 60, is_active: true });
  });

  it("counts a flow SOR under its flow stage, not its stale status", async () => {
    renderWithProviders(
      <EmployeeOpportunityMatrix opportunities={[flowSor("f1", "fs-ntp"), flowSor("f2", "fs-lead")]} />,
    );
    expect(await screen.findByTitle("1 Notice to Proceed")).toBeInTheDocument();
    expect(screen.getByTitle("1 Lead")).toBeInTheDocument();
  });

  it("win rate counts the Won Stage and later on flow SORs", async () => {
    const user = setupUser();
    renderWithProviders(
      <EmployeeOpportunityMatrix opportunities={[flowSor("f1", "fs-ntp"), flowSor("f2", "fs-po"), flowSor("f3", "fs-lead"), flowSor("f4", "fs-lead")]} />,
    );
    await user.click(screen.getByTitle("Leaderboard View"));
    await waitFor(() => expect(screen.getByText("2 won / 4 total")).toBeInTheDocument());
  });

  it("win rate counts Awarded and beyond on legacy SORs (4 Awarded + 1 PO of 12 = 42%)", async () => {
    const opps = [
      ...Array.from({ length: 4 }, (_, i) => legacy(`a${i}`, "AWARDED")),
      legacy("p1", "PO_RECEIVED"),
      ...Array.from({ length: 7 }, (_, i) => legacy(`l${i}`, "LEAD")),
    ];
    const user = setupUser();
    renderWithProviders(<EmployeeOpportunityMatrix opportunities={opps} />);
    await user.click(screen.getByTitle("Leaderboard View"));
    expect(await screen.findByText("5 won / 12 total")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });
});
