import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PageHeader from "./PageHeader";

describe("PageHeader title accent", () => {
  it("puts the last word of a multi-word title in the accent colour", () => {
    render(<PageHeader title="Purchase Requests" />);
    expect(screen.getByText("Requests")).toHaveClass("text-primary");
    expect(screen.getByText("Purchase")).not.toHaveClass("text-primary");
  });

  it("accents a one-word title too, so every Purchasing page matches", () => {
    render(<PageHeader title="Canvasses" />);
    expect(screen.getByText("Canvasses")).toHaveClass("text-primary");
    expect(screen.getByRole("heading", { name: "Canvasses" })).toBeInTheDocument();
  });

  it("renders no empty leading span for a one-word title", () => {
    const { container } = render(<PageHeader title="Transmittals" />);
    expect(container.querySelectorAll("h1 > span")).toHaveLength(1);
  });
});

// A Page's main action is primary red by default (2026-11-10). index.css
// colours `[data-page-actions] > [data-slot=button][data-variant=default]`,
// so a plain <Button> placed in the header picks it up with nothing to add.
describe("PageHeader main action", () => {
  it("marks the action area and tells each button's variant", async () => {
    const { Button } = await import("./button");
    render(
      <PageHeader title="Packing Lists">
        <Button variant="outline">Settings</Button>
        <Button>New Packing List</Button>
      </PageHeader>,
    );
    const main = screen.getByRole("button", { name: "New Packing List" });
    expect(main.parentElement).toHaveAttribute("data-page-actions");
    expect(main).toHaveAttribute("data-variant", "default");
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute("data-variant", "outline");
  });

  it("has the CSS rule that makes it red", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/\[data-page-actions\]\s*>\s*\[data-slot="button"\]\[data-variant="default"\]/);
  });
});
