import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import StageActionManager from "./StageActionManager";
import { renderWithProviders, setupUser } from "@/test/support";
import { FlowDataProvider } from "./FlowDataContext";
import { makeFlowStage, makeStageAction, makeSuperAdmin } from "@/test/factories";
import { db } from "@/test/db/store";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}));

// Heavy, unrelated modal/detail UI — not what these list-rendering tests exercise.
vi.mock("../../pages/group-tasks/_components/CreateGroupTaskModal", () => ({
  default: () => <div data-testid="create-group-task-modal" />,
}));
vi.mock("../LogTaskModal", () => ({
  default: () => <div data-testid="log-task-modal" />,
}));
vi.mock("./StageActionDetail", () => ({
  default: () => <div data-testid="stage-action-detail" />,
}));

describe("StageActionManager", () => {
  beforeEach(() => {
    mockUser.current = makeSuperAdmin({ name: "Super Admin" });
  });

  it("renders a list of actions and Add button", async () => {
    const stage = makeFlowStage();
    makeStageAction({
      stage_id: stage.id,
      kind: "create_individual_task",
      config: { title: "Send email" },
    });

    renderWithProviders(
      <FlowDataProvider>
        <StageActionManager stageId={stage.id} />
      </FlowDataProvider>,
    );

    expect(await screen.findByText("Send email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Action/i })).toBeInTheDocument();
  });

  it("does not render Add button if disabled", async () => {
    const stage = makeFlowStage();

    renderWithProviders(
      <FlowDataProvider>
        <StageActionManager stageId={stage.id} disabled />
      </FlowDataProvider>,
    );

    await screen.findByText(/Nothing runs here/i);
    expect(screen.queryByRole("button", { name: /Add Action/i })).not.toBeInTheDocument();
  });

  it("can toggle action details", async () => {
    const stage = makeFlowStage();
    makeStageAction({
      stage_id: stage.id,
      kind: "create_individual_task",
      config: { title: "Send email" },
    });

    renderWithProviders(
      <FlowDataProvider>
        <StageActionManager stageId={stage.id} />
      </FlowDataProvider>,
    );

    const title = await screen.findByText("Send email");
    fireEvent.click(title.closest("button"));

    expect(screen.getByTestId("stage-action-detail")).toBeInTheDocument();
  });
  describe("Request Packing List", () => {
    it("is offered in the Add Action menu and saves with an empty notify list and the default window", async () => {
      const user = setupUser();
      const stage = makeFlowStage();

      renderWithProviders(
        <FlowDataProvider>
          <StageActionManager stageId={stage.id} />
        </FlowDataProvider>,
      );

      await screen.findByText(/Nothing runs here/i);
      await user.click(screen.getByRole("button", { name: /Add Action/i }));
      await user.click(await screen.findByRole("button", { name: /Request Packing List/i }));
      await user.click(await screen.findByRole("button", { name: "Save" }));

      const saved = await vi.waitFor(() => {
        const rows = db.internal.rowsOf("flow_stage_actions").filter((a) => a.stage_id === stage.id);
        expect(rows).toHaveLength(1);
        return rows[0];
      });
      expect(saved.kind).toBe("request_packing_list");
      expect(saved.config.access).toBeTruthy();
      expect(saved.config.notify).toEqual([]);
    });
  });

  describe("Open S0 Evaluation", () => {
    it("is offered in the Add Action menu and saves its config with the default window", async () => {
      const user = setupUser();
      const stage = makeFlowStage();

      renderWithProviders(
        <FlowDataProvider>
          <StageActionManager stageId={stage.id} />
        </FlowDataProvider>,
      );

      await screen.findByText(/Nothing runs here/i);
      await user.click(screen.getByRole("button", { name: /Add Action/i }));
      await user.click(await screen.findByRole("button", { name: /Open S0 Evaluation/i }));
      await user.click(await screen.findByRole("button", { name: "Save" }));

      const saved = await vi.waitFor(() => {
        const rows = db.internal.rowsOf("flow_stage_actions").filter((a) => a.stage_id === stage.id);
        expect(rows).toHaveLength(1);
        return rows[0];
      });
      expect(saved.kind).toBe("open_costing_matrix");
      expect(saved.config.access).toBeTruthy();
      expect(saved.config.extras).toEqual([]);
    });

    it("lists a saved one by its label and opens its modal to edit", async () => {
      const user = setupUser();
      const stage = makeFlowStage();
      makeStageAction({
        stage_id: stage.id,
        kind: "open_costing_matrix",
        config: { purchasingIncharge: { type: "employee", id: "nobody" } },
      });

      renderWithProviders(
        <FlowDataProvider>
          <StageActionManager stageId={stage.id} />
        </FlowDataProvider>,
      );

      expect(await screen.findByText("Open S0 Evaluation")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Edit Open S0 Evaluation/i }));
      expect(await screen.findByRole("combobox", { name: "Sales Incharge" })).toBeInTheDocument();
    });
  });
});
