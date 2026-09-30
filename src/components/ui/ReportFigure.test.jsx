import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportFigure from "./ReportFigure";

describe("ReportFigure", () => {
  it("shows the headline figure with its note, supporting stats and chart", () => {
    render(
      <ReportFigure
        label="Total sales"
        figure="₱4,000.00"
        note="In the selected range"
        stats={[
          { label: "Orders", value: "2" },
          { label: "Average order", value: "₱2,000.00", sub: "Total ÷ orders" },
        ]}
        chart={<div>chart-slot</div>}
      />,
    );

    expect(screen.getByText("Total sales")).toBeInTheDocument();
    expect(screen.getByText("₱4,000.00")).toBeInTheDocument();
    expect(screen.getByText("In the selected range")).toBeInTheDocument();
    expect(screen.getByText("Average order")).toBeInTheDocument();
    expect(screen.getByText("Total ÷ orders")).toBeInTheDocument();
    expect(screen.getByText("chart-slot")).toBeInTheDocument();
  });

  it("puts the chart after the figure and stats", () => {
    render(<ReportFigure label="Pool" figure="1" chart={<div>chart-slot</div>} />);
    const figure = screen.getByText("Pool");
    const chart = screen.getByText("chart-slot");
    expect(Boolean(figure.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("renders stats alone, without a headline figure or chart", () => {
    render(<ReportFigure stats={[{ label: "Incomplete", value: 3, sub: "In progress" }]} />);
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("makes a stat with onClick a button", async () => {
    const onClick = vi.fn();
    render(<ReportFigure stats={[{ label: "Won", value: 4, onClick }, { label: "Value", value: "₱1" }]} />);

    await userEvent.click(screen.getByRole("button", { name: /won/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /value/i })).toBeNull();
  });

  it("is quiet: no gradient card, no uppercase micro-label on the figure", () => {
    const { container } = render(
      <ReportFigure label="Pool" figure="1" stats={[{ label: "Orders", value: 2 }]} />,
    );
    expect(container.innerHTML).not.toMatch(/bg-linear|bg-gradient|from-.*-a4|blur-/);
    expect(within(container).getByText("Pool").className).not.toContain("uppercase");
  });
});
