import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import StageConditionManager from "./StageConditionManager";
import { renderWithProviders } from "@/test/support";
import { FlowDataProvider } from "./FlowDataContext";
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

    renderWithProviders(
      <FlowDataProvider>
        <StageConditionManager stageId={stage.id} />
      </FlowDataProvider>,
    );

    expect(await screen.findByText("Check amount")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Add$/i })).toBeInTheDocument();
  });

  it("does not render Add button if disabled", async () => {
    const stage = makeFlowStage();

    renderWithProviders(
      <FlowDataProvider>
        <StageConditionManager stageId={stage.id} disabled />
      </FlowDataProvider>,
    );

    await screen.findByText(/Nothing gates this Stage/i);
    expect(screen.queryByRole("button", { name: /^Add$/i })).not.toBeInTheDocument();
  });

  it("toggles the Add Condition form", async () => {
    const stage = makeFlowStage();

    renderWithProviders(
      <FlowDataProvider>
        <StageConditionManager stageId={stage.id} />
      </FlowDataProvider>,
    );

    const addBtn = await screen.findByRole("button", { name: /^Add$/i });
    fireEvent.click(addBtn);

    expect(screen.getByPlaceholderText(/Notice of Award attached/i)).toBeInTheDocument();
  });

  // Issue #203: the default new-condition kind is Attachment (Field on
  // record is removed), configured through the Accepts picker rather than a
  // typed document type.
  it("adds an attachment condition with the trimmed label and a chosen Accepts group", async () => {
    const stage = makeFlowStage();

    renderWithProviders(
      <FlowDataProvider>
        <StageConditionManager stageId={stage.id} />
      </FlowDataProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /^Add$/i }));

    fireEvent.change(screen.getByPlaceholderText(/Notice of Award attached/i), {
      target: { value: "  Must be signed  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));

    fireEvent.click(screen.getByRole("button", { name: /Save condition/i }));

    await waitFor(() => {
      expect(screen.getByText("Must be signed")).toBeInTheDocument();
    });
  });

  it("offers Costing settled as a kind for a new condition (#272)", async () => {
    const stage = makeFlowStage();

    renderWithProviders(
      <FlowDataProvider>
        <StageConditionManager stageId={stage.id} />
      </FlowDataProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /^Add$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Attachment/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Costing settled/ }));

    expect(screen.getByRole("button", { name: /Costing settled/ })).toBeInTheDocument();
  });

  // Issue #203, story 1/3: Kind comes first in the form, and the live
  // preview renders the same row the SOR's checklist shows — so typing a
  // label updates the exact same component the salesperson will see.
  it("puts Kind first and shows a preview row identical to the checklist row", async () => {
    const stage = makeFlowStage();

    renderWithProviders(
      <FlowDataProvider>
        <StageConditionManager stageId={stage.id} />
      </FlowDataProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /^Add$/i }));

    const form = screen.getByPlaceholderText(/Notice of Award attached/i).closest("form");
    const fieldLabels = Array.from(form.querySelectorAll("span")).map((el) => el.textContent);
    const kindIdx = fieldLabels.indexOf("Kind");
    expect(kindIdx).toBeGreaterThan(-1);

    fireEvent.change(screen.getByPlaceholderText(/Notice of Award attached/i), {
      target: { value: "Signed contract" },
    });

    // The preview section renders a StageChecklistRow fed the draft, which
    // shows the same label and kind badge the checklist row would.
    const previewHeading = screen.getByText("Preview — how this looks on the SOR");
    expect(previewHeading).toBeInTheDocument();
    const previewSection = previewHeading.closest("div");
    expect(within(previewSection).getByText("Signed contract")).toBeInTheDocument();
    expect(within(previewSection).getByText("Attachment")).toBeInTheDocument();
  });

  // Issue #203, story 4/6: a saved condition gets an Edit control while the
  // flow is a draft, and none at all once it's published.
  it("edits an existing condition in a draft, and offers no Edit control once published", async () => {
    const draftStage = makeFlowStage();
    makeStageCondition({
      stage_id: draftStage.id,
      kind: "attachment",
      label: "Original label",
      is_required: true,
      config: { accepts: [] },
    });

    const { unmount } = renderWithProviders(
      <FlowDataProvider>
        <StageConditionManager stageId={draftStage.id} />
      </FlowDataProvider>,
    );

    const editBtn = await screen.findByRole("button", { name: /Edit Original label/i });
    fireEvent.click(editBtn);

    const labelInput = screen.getByDisplayValue("Original label");
    fireEvent.change(labelInput, { target: { value: "Updated label" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => {
      expect(screen.getByText("Updated label")).toBeInTheDocument();
    });
    unmount();

    // `disabled` is how the panel tells this component a flow is published
    // (see StageSettingsPanel) — read-only everywhere, no Edit control.
    const publishedStage = makeFlowStage();
    makeStageCondition({
      stage_id: publishedStage.id,
      kind: "attachment",
      label: "Locked condition",
      config: { accepts: [] },
    });

    renderWithProviders(
      <FlowDataProvider>
        <StageConditionManager stageId={publishedStage.id} disabled />
      </FlowDataProvider>,
    );

    await screen.findByText("Locked condition");
    expect(screen.queryByRole("button", { name: /Edit Locked condition/i })).not.toBeInTheDocument();
  });
});
