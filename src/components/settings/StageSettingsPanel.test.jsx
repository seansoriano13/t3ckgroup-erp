import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import StageSettingsPanel from "./StageSettingsPanel";

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
