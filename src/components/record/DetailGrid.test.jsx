import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import DetailGrid from "./DetailGrid";

describe("DetailGrid", () => {
  it("puts an uppercase label above each value", () => {
    render(<DetailGrid items={[{ label: "PO", value: "PO-1", mono: true }, { label: "Serial numbers", value: "A1" }]} />);

    const label = screen.getByText("PO");
    expect(label.tagName).toBe("DT");
    expect(label).toHaveClass("uppercase");
    expect(label.nextElementSibling).toHaveTextContent("PO-1");
    expect(label.nextElementSibling).toHaveClass("font-mono");
    expect(screen.getByText("A1")).not.toHaveClass("font-mono");
  });

  it("reads a missing value as a dash, or leaves the field out with hideEmpty", () => {
    const items = [{ label: "SOR", value: null }, { label: "Boxes", value: 2 }];
    const { rerender } = render(<DetailGrid items={items} />);
    expect(screen.getByText("SOR").nextElementSibling).toHaveTextContent("—");

    rerender(<DetailGrid hideEmpty items={items} />);
    expect(screen.queryByText("SOR")).not.toBeInTheDocument();
    expect(screen.getByText("Boxes")).toBeInTheDocument();
  });

  it("keeps a zero as a value", () => {
    render(<DetailGrid hideEmpty items={[{ label: "Boxes", value: 0 }]} />);
    expect(screen.getByText("Boxes").nextElementSibling).toHaveTextContent("0");
  });
});
