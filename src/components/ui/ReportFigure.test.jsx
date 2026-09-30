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

  it("dims a zero and warns on an attention stat only while it is non-zero", () => {
    render(
      <ReportFigure
        stats={[
          { label: "Returned", value: 0 },
          { label: "Overdue", value: 12, tone: "attention" },
          { label: "Late", value: 0, tone: "attention" },
          { label: "Done", value: 5 },
        ]}
      />,
    );
    expect(screen.getAllByText("0").every((el) => el.className.includes("text-muted-foreground"))).toBe(true);
    expect(screen.getByText("12").className).toContain("text-amber-11");
    expect(screen.getByText("5").className).toContain("text-foreground");
  });

  it("gives a row of counts larger numerals than stats beside a headline figure", () => {
    const { rerender } = render(<ReportFigure stats={[{ label: "Won", value: 4 }]} />);
    expect(screen.getByText("4").className).toContain("text-2xl");
    rerender(<ReportFigure figure="₱1" stats={[{ label: "Won", value: 4 }]} />);
    expect(screen.getByText("4").className).not.toContain("text-2xl");
  });

  it("separates a row of counts with hairlines, not boxes", () => {
    const { container } = render(<ReportFigure stats={[{ label: "A", value: 1 }, { label: "B", value: 2 }]} />);
    expect(container.innerHTML).toContain("border-l");
    expect(container.innerHTML).not.toMatch(/rounded-(xl|2xl)|shadow/);
  });

  it("closes a row of counts on a bottom hairline", () => {
    const { container } = render(<ReportFigure stats={[{ label: "A", value: 1 }]} />);
    expect(container.firstChild.className).toContain("border-b");
  });

  it("shows a clickable stat's hover as a darker label, not a background or underline", () => {
    render(<ReportFigure stats={[{ label: "Won", value: 4, onClick: () => {} }]} />);
    const button = screen.getByRole("button", { name: /won/i });
    expect(button.className).toContain("hover:bg-transparent");
    const label = screen.getByText("Won");
    expect(label.className).toContain("group-hover/stat:text-foreground");
    expect(label.className).not.toContain("underline");
  });

  it("marks a clickable stat with an arrow that a plain one lacks", () => {
    const { container } = render(
      <ReportFigure stats={[{ label: "Won", value: 4, onClick: () => {} }, { label: "Value", value: 1 }]} />,
    );
    expect(within(screen.getByRole("button", { name: /won/i })).getByTestId("stat-arrow")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="stat-arrow"]')).toHaveLength(1);
  });
});
