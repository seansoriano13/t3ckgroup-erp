import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import StageFieldManager from "./StageFieldManager";
import { renderWithProviders } from "@/test/support";
import { FlowDataProvider } from "./FlowDataContext";
import { makeFlowStage, makeStageField, makeSuperAdmin } from "@/test/factories";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}));

describe("StageFieldManager", () => {
  beforeEach(() => {
    mockUser.current = makeSuperAdmin({ name: "Super Admin" });
  });

  it("renders a Stage's fields and an Add button", async () => {
    const stage = makeFlowStage();
    makeStageField({ stage_id: stage.id, label: "Award amount", source: "custom", field_type: "text" });

    renderWithProviders(
      <FlowDataProvider>
        <StageFieldManager stageId={stage.id} />
      </FlowDataProvider>,
    );

    expect(await screen.findByText("Award amount")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Add$/i })).toBeInTheDocument();
  });

  it("says plainly when a Stage asks for nothing, with no Add button when disabled", async () => {
    const stage = makeFlowStage();

    renderWithProviders(
      <FlowDataProvider>
        <StageFieldManager stageId={stage.id} disabled />
      </FlowDataProvider>,
    );

    await screen.findByText(/asks for nothing/i);
    expect(screen.queryByRole("button", { name: /^Add$/i })).not.toBeInTheDocument();
  });

  it("adds an SOR-source field from the offered dropdown", async () => {
    const stage = makeFlowStage();

    renderWithProviders(
      <FlowDataProvider>
        <StageFieldManager stageId={stage.id} />
      </FlowDataProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /^Add$/i }));
    fireEvent.change(screen.getByPlaceholderText(/Award amount/i), {
      target: { value: "Expected award date" },
    });
    fireEvent.click(screen.getByRole("button", { name: "SOR field" }));

    fireEvent.click(screen.getByRole("button", { name: /Save field/i }));

    await waitFor(() => {
      expect(screen.getByText("Expected award date")).toBeInTheDocument();
    });
    expect(screen.getByText("Expected Award Date")).toBeInTheDocument();
  });

  it("shows a live preview of how the field looks on the SOR", async () => {
    const stage = makeFlowStage();

    renderWithProviders(
      <FlowDataProvider>
        <StageFieldManager stageId={stage.id} />
      </FlowDataProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /^Add$/i }));
    fireEvent.change(screen.getByPlaceholderText(/Award amount/i), {
      target: { value: "Contract Number" },
    });

    const previewHeading = screen.getByText("Preview — how this looks on the SOR");
    expect(previewHeading).toBeInTheDocument();
    const previewSection = previewHeading.closest("div");
    expect(within(previewSection).getByText("Contract Number")).toBeInTheDocument();
    expect(within(previewSection).getByText("Required")).toBeInTheDocument();
  });

  it("builds a custom choice field's options row by row", async () => {
    const stage = makeFlowStage();

    renderWithProviders(
      <FlowDataProvider>
        <StageFieldManager stageId={stage.id} />
      </FlowDataProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /^Add$/i }));
    fireEvent.change(screen.getByPlaceholderText(/Award amount/i), { target: { value: "Bid result" } });
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(screen.getByLabelText("Field type"), { target: { value: "choice" } });
    fireEvent.change(screen.getByLabelText("Option 1"), { target: { value: "Won" } });

    // One option is refused — field is not saved to the list
    fireEvent.click(screen.getByRole("button", { name: /Save field/i }));
    expect(screen.queryByRole("button", { name: /Edit Bid result/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Option 2"), { target: { value: "Lost" } });
    fireEvent.click(screen.getByRole("button", { name: /Save field/i }));
    await waitFor(() => expect(screen.getByText("Bid result")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Edit Bid result" }));
    expect(screen.getByLabelText("Option 1")).toHaveValue("Won");
    expect(screen.getByLabelText("Option 2")).toHaveValue("Lost");
  });

  it("edits a saved field's label without changing its source", async () => {
    const stage = makeFlowStage();
    makeStageField({ stage_id: stage.id, label: "Old label", source: "custom", field_type: "number" });

    renderWithProviders(
      <FlowDataProvider>
        <StageFieldManager stageId={stage.id} />
      </FlowDataProvider>,
    );

    const editBtn = await screen.findByRole("button", { name: /Edit Old label/i });
    fireEvent.click(editBtn);

    const labelInput = screen.getByDisplayValue("Old label");
    fireEvent.change(labelInput, { target: { value: "New label" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => {
      expect(screen.getByText("New label")).toBeInTheDocument();
    });
  });
});
