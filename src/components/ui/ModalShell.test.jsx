import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import ModalShell from "./ModalShell";

function shell(props) {
  return (
    <ModalShell open onOpenChange={() => {}} crumbs={["Transmittal", "TG03_0007"]} {...props}>
      <p>body</p>
    </ModalShell>
  );
}

describe("ModalShell record size", () => {
  it("has no footer bar and no Expand, even when asked, and keeps the X", () => {
    render(shell({ size: "record", expandable: true, actions: <button type="button">Save</button> }));

    expect(screen.getByRole("dialog")).toHaveAttribute("data-modal-shell", "record");
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand" })).not.toBeInTheDocument();
    expect(screen.queryByText("to cancel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close window" })).toBeInTheDocument();
  });

  it("fills the screen on a phone and is the RecordModal size elsewhere", () => {
    render(shell({ size: "record" }));
    const dialog = screen.getByRole("dialog");

    expect(dialog.className).toContain("max-w-[1400px]");
    expect(dialog.className).toContain("max-sm:!w-screen");
  });

  it("still gives the other sizes their footer and Expand", () => {
    render(shell({ size: "wide", expandable: true }));

    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    expect(screen.getByText("to cancel")).toBeInTheDocument();
  });
});
