import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import StageActionManager from "./StageActionManager";
import { renderWithProviders } from "@/test/support";
import { makeFlowStage, makeStageAction, makeSuperAdmin } from "@/test/factories";

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

    renderWithProviders(<StageActionManager stageId={stage.id} />);

    expect(await screen.findByText("Send email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Action/i })).toBeInTheDocument();
  });

  it("does not render Add button if disabled", async () => {
    const stage = makeFlowStage();

    renderWithProviders(<StageActionManager stageId={stage.id} disabled />);

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

    renderWithProviders(<StageActionManager stageId={stage.id} />);

    const title = await screen.findByText("Send email");
    fireEvent.click(title.closest("button"));

    expect(screen.getByTestId("stage-action-detail")).toBeInTheDocument();
  });
});
