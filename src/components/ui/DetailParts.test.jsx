import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalChain, DetailRow, DetailSection, NotePresets } from "./DetailParts";

describe("DetailParts", () => {
  it("DetailRow shows a dash for an empty value", () => {
    render(<DetailRow label="Reason">{""}</DetailRow>);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("DetailSection renders title and body", () => {
    render(<DetailSection title="Details">inside</DetailSection>);
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("inside")).toBeInTheDocument();
  });

  it("NotePresets reports the picked preset", () => {
    const onPick = vi.fn();
    render(<NotePresets presets={["Looks good."]} onPick={onPick} />);
    fireEvent.click(screen.getByText("Looks good."));
    expect(onPick).toHaveBeenCalledWith("Looks good.");
  });

  it("ApprovalChain marks the current step Now", () => {
    render(
      <ApprovalChain
        chain={[
          { label: "Head", who: "Ana", state: "done" },
          { label: "HR", who: "Ben", state: "current" },
        ]}
      />,
    );
    expect(screen.getByText("Now")).toBeInTheDocument();
  });
});
