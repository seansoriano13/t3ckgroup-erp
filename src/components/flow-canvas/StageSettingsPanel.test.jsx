import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import StageSettingsPanel from "./StageSettingsPanel";

// FollowUpCadenceEditor (issue #204 Part 3) reads the signed-in user via
// useAuth and the Follow-up service via useFlowData — neither provider is
// relevant to what these tests exercise (rename, delete, bracket, entry/won
// toggles), so it's stubbed out here rather than wrapping every render in
// both providers just to satisfy a section this file doesn't assert on.
vi.mock("./FollowUpCadenceEditor", () => ({
  default: () => null,
}));

describe("StageSettingsPanel", () => {
  const defaultStage = {
    id: "stage-1",
    name: "Initial Contact",
    bracket_label: null,
    is_terminal: false,
    color: null,
  };

  const defaultProps = {
    stage: defaultStage,
    isEntry: false,
    isWon: false,
    disabled: false,
    bracketOptions: ["Pre-Sales", "Closing"],
    activeTab: "settings",
    onTabChange: vi.fn(),
    onClose: vi.fn(),
    onRename: vi.fn(),
    onColorChange: vi.fn(),
    onBracketChange: vi.fn(),
    onDelete: vi.fn(),
    onToggleTerminal: vi.fn(),
    onSetEntry: vi.fn(),
    onSetWon: vi.fn(),
  };

  it("asks how deals end on a Terminal Stage, and sets Won", () => {
    const onSetTerminalOutcome = vi.fn();
    render(
      <StageSettingsPanel
        {...defaultProps}
        stage={{ ...defaultProps.stage, is_terminal: true }}
        onSetTerminalOutcome={onSetTerminalOutcome}
      />,
    );
    expect(screen.getByRole("button", { name: "Lost" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Won" }));
    expect(onSetTerminalOutcome).toHaveBeenCalledWith("won");
  });

  it("doesn't ask on a Stage that isn't terminal, or on the Won Stage", () => {
    const props = { ...defaultProps, onSetTerminalOutcome: vi.fn() };
    const { rerender } = render(<StageSettingsPanel {...props} />);
    expect(screen.queryByText("Deals here end as")).not.toBeInTheDocument();
    rerender(<StageSettingsPanel {...props} isWon stage={{ ...props.stage, is_terminal: true }} />);
    expect(screen.queryByText("Deals here end as")).not.toBeInTheDocument();
  });

  it("renders the stage name and bracket label", () => {
    render(<StageSettingsPanel {...defaultProps} />);
    expect(screen.getByRole("heading", { name: "Initial Contact" })).toBeInTheDocument();
  });

  it("calls onRename when saving a new name", () => {
    render(<StageSettingsPanel {...defaultProps} />);
    const headingBtn = screen.getByRole("button", { name: /Initial Contact/i });
    fireEvent.click(headingBtn);
    
    const input = screen.getByRole("textbox", { name: /Stage name/i });
    fireEvent.change(input, { target: { value: "First Contact" } });
    fireEvent.blur(input);

    expect(defaultProps.onRename).toHaveBeenCalledWith("First Contact");
  });

  it("does not call onRename when saving empty string", () => {
    const onRename = vi.fn();
    render(<StageSettingsPanel {...defaultProps} onRename={onRename} />);
    const headingBtn = screen.getByRole("button", { name: /Initial Contact/i });
    fireEvent.click(headingBtn);
    
    const input = screen.getByRole("textbox", { name: /Stage name/i });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);

    expect(onRename).not.toHaveBeenCalled();
  });

  it("disables all action buttons when disabled is true", () => {
    render(<StageSettingsPanel {...defaultProps} disabled={true} />);
    // Ensure all semantic interactive buttons are disabled except tabs which might not use disabled
    // Let's specifically check the delete, entry, won, terminal buttons
    const deleteBtn = screen.getByRole("button", { name: /Delete Stage/i });
    expect(deleteBtn).toBeDisabled();
    
    const entryBtn = screen.getByRole("button", { name: /Make it the entry/i });
    expect(entryBtn).toBeDisabled();

    const wonBtn = screen.getByRole("button", { name: /Make it the win/i });
    expect(wonBtn).toBeDisabled();
  });

  it("calls onBracketChange with null when bracket string is empty", () => {
    const onBracketChange = vi.fn();
    render(<StageSettingsPanel {...defaultProps} stage={{...defaultStage, bracket_label: "Hello"}} onBracketChange={onBracketChange} />);
    
    const bracketInput = screen.getByPlaceholderText("e.g. Pre-Sales");
    fireEvent.change(bracketInput, { target: { value: "   " } });
    fireEvent.blur(bracketInput);

    expect(onBracketChange).toHaveBeenCalledWith(null);
  });
});
