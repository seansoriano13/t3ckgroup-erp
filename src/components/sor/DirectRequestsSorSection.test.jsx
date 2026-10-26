import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "@/test/support";
import { stubRpc } from "@/test/msw/server";
import DirectRequestsSorSection from "./DirectRequestsSorSection";

describe("Direct requests for this project", () => {
  it("lists title, PR number, P0 and status, and no money", async () => {
    stubRpc("direct_requests_for_sor", [
      { id: "r1", title: "Demo unit", pr_number: "PR_0042", p0: "P07777", status: "purchased" },
      { id: "r2", title: "Tape", pr_number: "PR_0043", p0: null, status: "not_checked" },
    ]);
    renderWithProviders(<DirectRequestsSorSection opportunityId="sor-1" />);

    expect(await screen.findByText("Demo unit")).toBeInTheDocument();
    expect(screen.getByText("PR_0042")).toBeInTheDocument();
    expect(screen.getByText("P07777")).toBeInTheDocument();
    expect(screen.getByText("Purchased")).toBeInTheDocument();
    expect(screen.getByText(/No P0 yet/)).toBeInTheDocument();
    expect(screen.queryByText(/₱/)).not.toBeInTheDocument();
  });

  it("shows nothing when the database returns nothing", async () => {
    stubRpc("direct_requests_for_sor", []);
    const { container } = renderWithProviders(<DirectRequestsSorSection opportunityId="sor-1" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
  });
});
