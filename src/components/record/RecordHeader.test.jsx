import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import RecordHeader from "./RecordHeader";

describe("RecordHeader", () => {
  it("reads reference and name as the title, with one badge and one quiet line", () => {
    render(<RecordHeader reference="TG03_0007" name="Store CDO" badge={{ label: "Draft", theme: "mauve" }} line="Prepared Oct 22 by Pat" />);

    expect(screen.getByRole("heading", { name: /^TG03_0007\s*·\s*Store CDO$/ })).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Prepared Oct 22 by Pat")).toBeInTheDocument();
  });

  it("sets a reference in mono and a word as plain text", () => {
    const { rerender } = render(<RecordHeader reference="TG03_0007" name="Store" />);
    expect(screen.getByText("TG03_0007")).toHaveClass("font-mono");

    rerender(<RecordHeader reference="Direct" mono={false} name="Store" />);
    expect(screen.getByText("Direct")).not.toHaveClass("font-mono");
  });

  it("leaves out the badge and line when there are none", () => {
    render(<RecordHeader reference="TG03_0007" />);

    expect(screen.getByRole("heading", { name: "TG03_0007" })).toBeInTheDocument();
    expect(screen.queryByText("·")).not.toBeInTheDocument();
  });
});
