import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChecklistTaskRenderer from "./ChecklistTaskRenderer";

describe("ChecklistTaskRenderer", () => {
  it("renders plain text description cleanly when not a checklist", () => {
    render(<ChecklistTaskRenderer description="This is a simple note" />);
    expect(screen.getByText("This is a simple note")).toBeInTheDocument();
  });

  it("renders flat checklist with no section accordions or progress bars", () => {
    const flatItems = [
      { text: "Item 1", checked: false },
      { text: "Item 2", checked: true },
    ];
    render(<ChecklistTaskRenderer description={flatItems} isOwner={true} />);

    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(screen.getByText("Item 2")).toBeInTheDocument();

    // No stepper bar or phase indicators
    expect(screen.queryByText(/Phase \d of \d/)).not.toBeInTheDocument();
    expect(screen.queryByText("Hide")).not.toBeInTheDocument();
    expect(screen.queryByText("Show")).not.toBeInTheDocument();
  });

  it("renders single-group titled checklist with clean heading and no accordion triggers", () => {
    const titledGroup = [
      {
        id: "g-1",
        title: "Initial Setup",
        items: [
          { id: "i-1", text: "Configure server", checked: false },
          { id: "i-2", text: "Install dependencies", checked: true },
        ],
      },
    ];
    render(<ChecklistTaskRenderer description={titledGroup} isOwner={true} />);

    expect(screen.getByText("Initial Setup")).toBeInTheDocument();
    expect(screen.getByText("Configure server")).toBeInTheDocument();
    expect(screen.getByText("Install dependencies")).toBeInTheDocument();

    // No stepper bar or accordion triggers since there is only 1 phase
    expect(screen.queryByText(/Phase \d of \d/)).not.toBeInTheDocument();
    expect(screen.queryByText("Hide")).not.toBeInTheDocument();
    expect(screen.queryByText("Show")).not.toBeInTheDocument();
  });

  it("renders multi-phase checklist with progressive disclosure stepper and collapsible sections", () => {
    const multiPhase = [
      {
        id: "g-1",
        title: "Phase 1: Planning",
        items: [
          { id: "i-1", text: "Gather requirements", checked: true },
        ],
      },
      {
        id: "g-2",
        title: "Phase 2: Execution",
        items: [
          { id: "i-2", text: "Write code", checked: false },
        ],
      },
    ];
    render(<ChecklistTaskRenderer description={multiPhase} isOwner={true} />);

    // Multi-phase stepper header exists
    expect(screen.getByText(/Phase 2 of 2/)).toBeInTheDocument();
    expect(screen.getByText("Phase 1: Planning")).toBeInTheDocument();
    expect(screen.getByText("Phase 2: Execution")).toBeInTheDocument();

    // Phase 1 is completed so it defaults to collapsed
    expect(screen.queryByText("Gather requirements")).not.toBeInTheDocument();

    // Phase 2 is active so it defaults to expanded
    expect(screen.getByText("Write code")).toBeInTheDocument();

    // Clicking Phase 1 Show button expands Phase 1 items
    const showButtons = screen.getAllByRole("button", { name: /Phase 1: Planning/i });
    fireEvent.click(showButtons[0]);
    expect(screen.getByText("Gather requirements")).toBeInTheDocument();
  });

  it("calls onInlineCheck when owner clicks an item", () => {
    const handleCheck = vi.fn();
    const flatItems = [{ id: "i-1", text: "Task to check", checked: false }];

    render(
      <ChecklistTaskRenderer
        description={flatItems}
        isOwner={true}
        onInlineCheck={handleCheck}
      />,
    );

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(handleCheck).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(handleCheck.mock.calls[0][0]);
    expect(parsed[0].checked).toBe(true);
  });
});
