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
