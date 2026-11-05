import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import TransmittalFormSkeleton from "./TransmittalFormSkeleton";

// Raise a Transmittal shows its form's outline while the checks load (#904), not a spinner over nothing.
describe("TransmittalFormSkeleton", () => {
  it("announces the Transmittal form as loading", () => {
    render(<TransmittalFormSkeleton />);

    expect(screen.getByRole("status", { name: "Loading Transmittal form" })).toBeInTheDocument();
  });
});
