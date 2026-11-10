import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { setupUser } from "@/test/support";
import LinerList from "./LinerList";

const rows = [
  { key: "a", main: "Cutter", sub: "PO-1", quantity: "2 pcs", badge: { label: "GC", theme: "green" }, children: <p>Cutter details</p> },
  { key: "b", main: "Blade", sub: "PO-2", quantity: "1 pc", children: <p>Blade details</p> },
  { key: "c", main: "Plain row" },
];

describe("LinerList", () => {
  it("shows one line per row with its sub line, quantity and badge", () => {
    render(<LinerList rows={rows} />);

    expect(screen.getByText("Cutter")).toBeInTheDocument();
    expect(screen.getByText("PO-1")).toBeInTheDocument();
    expect(screen.getByText("2 pcs")).toBeInTheDocument();
    expect(screen.getByText("GC")).toBeInTheDocument();
  });

  it("opens a row in place with its chevron, and several can be open", async () => {
    const user = setupUser();
    render(<LinerList rows={rows} />);

    const cutter = screen.getByRole("button", { name: /Cutter/ });
    const blade = screen.getByRole("button", { name: /Blade/ });
    expect(cutter).toHaveAttribute("aria-expanded", "false");
    // The content stays mounted while shut, but out of the accessibility tree.
    expect(screen.getByText("Cutter details").closest("[aria-hidden='true']")).not.toBeNull();

    await user.click(cutter);
    await user.click(blade);

    expect(cutter).toHaveAttribute("aria-expanded", "true");
    expect(blade).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Cutter details").closest("[aria-hidden='true']")).toBeNull();
    expect(screen.getByText("Blade details").closest("[aria-hidden='true']")).toBeNull();

    await user.click(cutter);
    expect(cutter).toHaveAttribute("aria-expanded", "false");
    expect(blade).toHaveAttribute("aria-expanded", "true");
  });

  it("gives a row with nothing to show no chevron button", () => {
    render(<LinerList rows={rows} />);
    expect(screen.queryByRole("button", { name: /Plain row/ })).not.toBeInTheDocument();
    expect(screen.getByText("Plain row")).toBeInTheDocument();
  });

  it("keeps a shut row's content clipped, so it cannot spill over the row below", () => {
    const { container } = render(<LinerList rows={rows} />);
    const panels = container.querySelectorAll(".reveal");
    expect(panels).toHaveLength(2);
    panels.forEach((panel) => expect(panel.getAttribute("data-settled")).toBe("false"));
  });

  it("opens a row marked defaultOpen on arrival", () => {
    render(<LinerList rows={[{ key: "a", main: "Cutter", children: <p>Cutter details</p>, defaultOpen: true }]} />);
    expect(screen.getByRole("button", { name: /Cutter/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("splits rows under group sub-headings in one box", () => {
    render(
      <LinerList
        groups={[
          { key: "todo", title: "To do", rows: [{ key: "a", main: "Cutter" }] },
          { key: "doing", title: "In progress", rows: [{ key: "b", main: "Blade" }] },
          { key: "done", title: "Closed", rows: [] },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "To do" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "In progress" })).toBeInTheDocument();
    // A group with no rows leaves no heading behind.
    expect(screen.queryByRole("heading", { name: "Closed" })).not.toBeInTheDocument();
  });

  it("says one quiet sentence, with no box, when it is empty", () => {
    render(<LinerList rows={[]} empty="No lines yet." />);
    expect(screen.getByText("No lines yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
