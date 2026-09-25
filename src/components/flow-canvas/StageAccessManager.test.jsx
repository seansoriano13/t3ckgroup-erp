import { screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import StageAccessManager from "./StageAccessManager";
import { renderWithProviders } from "@/test/support";
import { FlowDataProvider } from "./FlowDataContext";
import {
  makeEmployee,
  makeFlowStage,
  makeSalesFlow,
  makeStageAction,
  makeSuperAdmin,
} from "@/test/factories";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}));

/**
 * The Access tab used to end on "call-in data lands in a later ticket" — a
 * stub that survived the ticket which actually shipped the data. These cover
 * the question it now has to answer: who can see this Stage, and because of
 * what.
 */
describe("StageAccessManager", () => {
  beforeEach(() => {
    mockUser.current = makeSuperAdmin({ name: "Super Admin" });
  });

  const renderTab = (stage, flow) =>
    renderWithProviders(
      <FlowDataProvider>
        <StageAccessManager stageId={stage.id} flowId={flow?.id} />
      </FlowDataProvider>,
    );

  it("names the people an action calls in, and how far each window reaches", async () => {
    const flow = makeSalesFlow();
    const stage = makeFlowStage({ flow_id: flow.id, name: "SO Evaluation" });
    const maria = makeEmployee({ name: "Maria Daniella C. Duran" });
    const raquel = makeEmployee({ name: "Raquel Galacgac" });

    makeStageAction({
      stage_id: stage.id,
      kind: "create_group_task",
      config: {
        title: "PMS – Evaluation",
        members: [{ employeeId: maria.id }, { employeeId: raquel.id }],
      },
    });

    renderTab(stage, flow);

    expect(await screen.findByText("Maria Daniella C. Duran")).toBeInTheDocument();
    expect(screen.getByText("Raquel Galacgac")).toBeInTheDocument();
    // The action that put them there, so a wrong name says where to go fix it.
    expect(screen.getAllByText("PMS – Evaluation")).toHaveLength(2);
    expect(screen.getAllByText(/this Stage only/)).toHaveLength(2);
  });

  it("leads with the headline answer rather than the controls", async () => {
    const flow = makeSalesFlow();
    const stage = makeFlowStage({ flow_id: flow.id });
    const maria = makeEmployee({ name: "Maria Duran" });
    makeStageAction({
      stage_id: stage.id,
      kind: "create_group_task",
      config: { title: "Evaluate", members: [{ employeeId: maria.id }] },
    });

    renderTab(stage, flow);

    expect(
      await screen.findByText(/5 of 5 Deal Team roles, plus 1 called in here/),
    ).toBeInTheDocument();
  });

  it("teaches what to do when nobody is called in, instead of showing nothing", async () => {
    const flow = makeSalesFlow();
    const stage = makeFlowStage({ flow_id: flow.id });

    renderTab(stage, flow);

    expect(await screen.findByText("Nobody is called in here")).toBeInTheDocument();
    expect(screen.getByText(/Only the Deal Team sees this Stage/)).toBeInTheDocument();
  });

  it("points at the toolbar for Always sees rather than implying it is per Stage", async () => {
    const flow = makeSalesFlow();
    const stage = makeFlowStage({ flow_id: flow.id });

    renderTab(stage, flow);

    expect(
      await screen.findByText(/Set it in Access settings on the canvas toolbar/),
    ).toBeInTheDocument();
  });
});
