import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { openLines, renderCostingDesk } from "@/test/support/costingDesk";

/**
 * Landed Cost is cost (#546): the Component grid draws its two columns for the Closed Book and
 * cost tiers and drops them, rather than drawing empty ones, for the price tier. What the
 * database serves is the policy tier's (101-landed-cost-cost-tier.test.js).
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

describe("the Landed Cost columns on the Component grid", () => {
  let reader;
  let deal;

  const mount = (stub) => {
    stubCostingMatrixRpcs({ actorId: reader.id, ...stub });
    renderCostingDesk(deal);
  };

  beforeEach(() => {
    reader = makeEmployee({ name: "Grid Reader" });
    authUser = { id: reader.id };
    deal = makeOpportunity({ registered_by: reader.id, deal_owner_id: reader.id });
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue tripod", quantity: 2 });
    db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Tripod" });
  });

  it.each([
    ["cost", ["purchasing"]],
    ["closed_book", ["purchasing"]],
  ])("shows them to the %s tier", async (tier, bands) => {
    mount({ tier, bands });
    await openLines();
    await screen.findAllByTestId("component");
    expect(screen.getAllByText("Landed Cost / unit").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Landed Cost total").length).toBeGreaterThan(0);
  });

  it("drops them for the price tier", async () => {
    mount({ tier: "price", bands: ["sales"] });
    await openLines();
    await screen.findAllByTestId("component");
    expect(screen.queryByText("Landed Cost / unit")).not.toBeInTheDocument();
    expect(screen.queryByText("Landed Cost total")).not.toBeInTheDocument();
  });
});
