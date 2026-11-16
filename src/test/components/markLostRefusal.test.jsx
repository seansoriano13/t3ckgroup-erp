import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/opportunityService", () => ({
  opportunityService: { markLost: vi.fn() },
}));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import MarkLostDialogHost from "@/components/sor/MarkLostDialogHost";
import { opportunityService } from "@/services/opportunityService";
import toast from "react-hot-toast";
import { LOST_REASONS } from "@/constants/sor";

const renderHost = (props = {}) => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MarkLostDialogHost opportunity={{ id: "o1" }} isOpen onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
};

describe("Mark as Lost dialog (#1045)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("labels the reason list with a required mark", () => {
    renderHost();
    expect(screen.getByText("Reason")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /reason/i })).toBeInTheDocument();
  });

  it("keeps a server refusal inside the dialog instead of a toast", async () => {
    opportunityService.markLost.mockRejectedValue(new Error("This flow has no Lost Stage. Add one in Flow Canvas."));
    const onClose = vi.fn();
    renderHost({ onClose });
    await userEvent.click(screen.getByRole("radio", { name: LOST_REASONS[0].label }));
    await userEvent.click(screen.getByRole("button", { name: "Mark as Lost" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This flow has no Lost Stage");
    await waitFor(() => expect(opportunityService.markLost).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

import { noLostStageOnFlow, NO_LOST_STAGE_REASON } from "@/components/sor/markLostAvailability";

describe("Mark as Lost availability (#1045)", () => {
  const canvas = {};
  it("is off on an Outright flow with no Lost Stage", () => {
    expect(noLostStageOnFlow({ isFlowDeal: true, flowCanvas: canvas, lostStages: [] })).toBe(true);
    expect(NO_LOST_STAGE_REASON).toBe("This Sales Flow has no Lost Stage yet.");
  });
  it("stays on with a Lost Stage, with no canvas yet, or on a legacy SOR", () => {
    expect(noLostStageOnFlow({ isFlowDeal: true, flowCanvas: canvas, lostStages: [{ id: 1 }] })).toBe(false);
    expect(noLostStageOnFlow({ isFlowDeal: true, flowCanvas: null, lostStages: [] })).toBe(false);
    expect(noLostStageOnFlow({ isFlowDeal: false, flowCanvas: null, lostStages: [] })).toBe(false);
  });
});
