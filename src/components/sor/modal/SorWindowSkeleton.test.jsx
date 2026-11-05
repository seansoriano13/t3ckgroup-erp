import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import SorWindowSkeleton from "./SorWindowSkeleton";

// The SOR window's frame shows while the record loads (#904), so it is never a blank panel.
describe("SorWindowSkeleton", () => {
  it("shows a loading frame for the SOR while the record is on the way", () => {
    render(<SorWindowSkeleton isOpen onClose={vi.fn()} />);

    expect(screen.getByRole("status", { name: "Loading SOR" })).toBeInTheDocument();
    expect(screen.getByText("Loading SOR…")).toBeInTheDocument();
  });

  it("renders nothing while closed", () => {
    render(<SorWindowSkeleton isOpen={false} onClose={vi.fn()} />);

    expect(screen.queryByRole("status", { name: "Loading SOR" })).not.toBeInTheDocument();
  });
});
