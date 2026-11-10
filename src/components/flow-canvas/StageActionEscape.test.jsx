import { screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import StageSettingsPanel from "./StageSettingsPanel";
import { renderWithProviders, setupUser } from "@/test/support";
import { FlowDataProvider } from "./FlowDataContext";
import { makeFlowStage, makeSuperAdmin } from "@/test/factories";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}));
vi.mock("./FollowUpCadenceEditor", () => ({ default: () => null }));

/**
 * Escape on the Stage panel (#555): pressing it inside an action dialog closes that dialog only.
 * The Stage panel stays open, so the settings typed in the dialog's neighbours are not lost.
 */
describe("Escape in an action dialog on the Stage panel", () => {
  beforeEach(() => {
    mockUser.current = makeSuperAdmin({ name: "Super Admin" });
  });

  it("closes the dialog and leaves the Stage panel open", async () => {
    const user = setupUser();
    const stage = makeFlowStage({ name: "Initial Contact" });
    const onClose = vi.fn();

    renderWithProviders(
      <FlowDataProvider>
        <StageSettingsPanel
          stage={stage}
          isEntry={false}
          isWon={false}
          disabled={false}
          bracketOptions={[]}
          activeTab="actions"
          onTabChange={vi.fn()}
          onClose={onClose}
          onRename={vi.fn()}
          onColorChange={vi.fn()}
          onBracketChange={vi.fn()}
          onDelete={vi.fn()}
          onToggleTerminal={vi.fn()}
          onSetEntry={vi.fn()}
          onSetWon={vi.fn()}
        />
      </FlowDataProvider>,
    );

    await screen.findByText(/Nothing runs here/i);
    await user.click(screen.getByRole("button", { name: /Add Action/i }));
    await user.click(await screen.findByRole("button", { name: /Request Packing List/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Initial Contact" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Action/i })).toBeInTheDocument();
  });
});
