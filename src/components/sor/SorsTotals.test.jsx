import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SorsTotals from "./SorsTotals";

describe("SorsTotals (#1047)", () => {
  it("says how many Lost SORs the count leaves out", () => {
    render(<SorsTotals count={144} leftOut={1} openValue={0} wonValue={0} />);
    expect(screen.getByText(/\(\+1 Lost\)/)).toBeInTheDocument();
  });

  it("says nothing extra when nothing is left out", () => {
    render(<SorsTotals count={144} openValue={0} wonValue={0} />);
    expect(screen.queryByText(/Lost/)).toBeNull();
  });
});
