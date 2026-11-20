import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import BidDecisionPanel from "./BidDecisionPanel";

/** #1107: a purchaser reads the Closed Book on the sheet, but the bid panel (Final Offer, ABC) is not drawn for them. */

vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("../../services/salesFlowService", () => ({
  salesFlowService: { getFlow: () => Promise.resolve(null) },
}));

const matrix = (extra = {}) => ({
  tier: "closed_book",
  bidDecision: null,
  bidDecisionHistory: [],
  tenderLines: [{ id: "l1" }],
  totals: { missingOffer: 0, offer: 1000, abc: 900 },
  evaluation: { approved: true },
  summary: null,
  abc: null,
  canDecideLoss: false,
  ...extra,
});

const show = (m) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BidDecisionPanel matrix={m} writes={{ run: vi.fn() }} nameOf={() => "Dana"} />
    </QueryClientProvider>,
  );

describe("the bid panel for a purchaser", () => {
  it("draws nothing when the database said the Bid Decision is not for this viewer", () => {
    const { container } = show(matrix({ bidVisible: false }));
    expect(container).toBeEmptyDOMElement();
  });

  it("is drawn for the Deal Team, a decider or a Super Admin", () => {
    const { container } = show(matrix({ bidVisible: true }));
    expect(container).not.toBeEmptyDOMElement();
  });
});
