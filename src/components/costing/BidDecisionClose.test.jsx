import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { MoveToClosedLost } from "./BidDecisionPanel";

/** #941: "Move to Closed Lost" next to a No-go: the Deal Owner's button, nobody else's. */

let authUser;
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

let canvas;
vi.mock("../../services/salesFlowService", () => ({
  salesFlowService: { getFlow: () => Promise.resolve(canvas) },
}));

const stages = (lost = true) => [
  { id: "s1", name: "Lead", is_terminal: false },
  { id: "won", name: "Won", is_terminal: true, terminal_outcome: "won" },
  ...(lost ? [{ id: "lost", name: "Closed Lost", is_terminal: true, terminal_outcome: "lost" }] : []),
];

function show(opportunity) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MoveToClosedLost opportunity={opportunity} reason="Too far over" nameOf={() => "Dana Owner"} />
    </QueryClientProvider>,
  );
}

const deal = { id: "opp-1", sale_type_id: "st-1", flow_stage_id: "s1", deal_owner_id: "owner-1" };

describe("Move to Closed Lost on a No-go", () => {
  beforeEach(() => {
    canvas = { flow: { won_stage_id: "won" }, stages: stages() };
  });

  it("is shown to the Deal Owner", async () => {
    authUser = { id: "owner-1" };
    show(deal);
    expect(await screen.findByTestId("bid-decision-move-closed-lost")).toBeInTheDocument();
  });

  it("tells everyone else who can close it", async () => {
    authUser = { id: "someone-else" };
    show(deal);
    expect(await screen.findByTestId("bid-decision-close-owner-only")).toHaveTextContent("Dana Owner");
    expect(screen.queryByTestId("bid-decision-move-closed-lost")).not.toBeInTheDocument();
  });

  it("is not shown when the flow has no Closed Lost stage", async () => {
    authUser = { id: "owner-1" };
    canvas = { flow: { won_stage_id: "won" }, stages: stages(false) };
    show(deal);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("bid-decision-move-closed-lost")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bid-decision-close-owner-only")).not.toBeInTheDocument();
  });
});
