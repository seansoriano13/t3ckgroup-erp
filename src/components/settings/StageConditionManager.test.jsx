import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import StageConditionManager from "./StageConditionManager";
import { renderWithProviders } from "@/test/support";
import { makeFlowStage, makeStageCondition, makeSuperAdmin } from "@/test/factories";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}));

describe("StageConditionManager", () => {
  beforeEach(() => {
    mockUser.current = makeSuperAdmin({ name: "Super Admin" });
  });

  it("renders a list of conditions and Add button", async () => {
    const stage = makeFlowStage();
    makeStageCondition({
      stage_id: stage.id,
      kind: "field",
      label: "Check amount",
      is_required: true,
      config: { column: "amount" },
    });

    renderWithProviders(<StageConditionManager stageId={stage.id} />);

    expect(await screen.findByText("Check amount")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Add$/i })).toBeInTheDocument();
  });

  it("does not render Add button if disabled", async () => {
    const stage = makeFlowStage();

    renderWithProviders(<StageConditionManager stageId={stage.id} disabled />);

    await screen.findByText(/Nothing gates this Stage/i);
    expect(screen.queryByRole("button", { name: /^Add$/i })).not.toBeInTheDocument();
  });

  it("toggles the Add Condition form", async () => {
    const stage = makeFlowStage();

    renderWithProviders(<StageConditionManager stageId={stage.id} />);

    const addBtn = await screen.findByRole("button", { name: /^Add$/i });
    fireEvent.click(addBtn);

    expect(screen.getByPlaceholderText(/Notice of Award attached/i)).toBeInTheDocument();
  });

  it("adds a condition with the trimmed label and entered column", async () => {
    const stage = makeFlowStage();

    renderWithProviders(<StageConditionManager stageId={stage.id} />);

    fireEvent.click(await screen.findByRole("button", { name: /^Add$/i }));

    fireEvent.change(screen.getByPlaceholderText(/Notice of Award attached/i), {
      target: { value: "  Must be signed  " },
    });
    fireEvent.change(screen.getByPlaceholderText("po_date"), {
      target: { value: "po_date" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Save condition/i }));

    await waitFor(() => {
      expect(screen.getByText("Must be signed")).toBeInTheDocument();
    });
  });
});
