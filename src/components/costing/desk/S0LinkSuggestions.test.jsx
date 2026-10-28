import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import S0LinkSuggestions from "./S0LinkSuggestions";

const suggestion = { sorItemId: "i1", sorItemName: "Fire hose 65 mm", tenderLineId: "l1", tenderLineName: "Fire hose", score: 1 };

describe("S0LinkSuggestions", () => {
  it("shows nothing when there is no suggestion", () => {
    const { container } = render(<S0LinkSuggestions suggestions={[]} canConfirm busy={false} onConfirm={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lets Sales confirm a suggestion", async () => {
    const onConfirm = vi.fn();
    render(<S0LinkSuggestions suggestions={[suggestion]} canConfirm busy={false} onConfirm={onConfirm} />);

    expect(screen.getByText(/Fire hose 65 mm/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Link to the S0 line/ }));
    expect(onConfirm).toHaveBeenCalledWith(suggestion);
  });

  it("only lists the suggestion for someone who cannot confirm", () => {
    render(<S0LinkSuggestions suggestions={[suggestion]} canConfirm={false} busy={false} onConfirm={() => {}} />);

    expect(screen.getByText(/Fire hose 65 mm/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
