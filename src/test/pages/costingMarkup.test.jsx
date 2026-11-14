import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { closeLine, openLines, openStep, renderCostingDesk } from "@/test/support/costingDesk";

/**
 * Markup on the S0 Evaluation (#269, #703: only the Markup list writes the multiplier, so the tests that write it
 * hold the markup band). Since the price corridor (2026-11-13) the markup is Purchasing's guide in the Costs step,
 * as the sheet's "Markup Price · PMS Automatic": Acquire × the part's own markup, else the evaluation's (1.35 by
 * default); it never changes an offer, and nothing tries or applies a markup any more. In a line's detail the
 * Closed Book still sees each factor as ×1.35 and +35%, a row's Markup Price and the line's sum; Sales sees the
 * peso Markup Price and nothing behind it; Purchasing sees neither. Real components and services on the fake
 * database, with the matrix functions stubbed (policy 80 holds who may do what).
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

function openDesk(deal) {
  const owner = makeEmployee();
  authUser = { id: owner.id, isSuperAdmin: true };
  return renderCostingDesk(deal);
}

describe("markup on the S0 Evaluation", () => {
  let deal;
  let matrix;
  let vehicle;
  let bolts;

  // One Tender Line at Final Offer 3,300,000: the vehicle (x1.47, its own) and anchor bolts (the default x1.35),
  // and a Delivery Charge cost-only row at the x1.00 it starts with.
  function seed({ defaultFactor = 1.35, finalOffer = 3300000 } = {}) {
    matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    db.seed("costing_matrix_money", { matrix_id: matrix.id, default_factor: defaultFactor });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue vehicle", unit: "unit", quantity: 1 });
    db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: 4000000, final_offer_unit: finalOffer });
    vehicle = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "4x4 pick-up", is_bundle: true, quantity: 1 });
    db.seed("costing_component_costs", { component_id: vehicle.id, acquire_unit: 2160500, markup_factor: 1.47 });
    bolts = db.seed("costing_components", { tender_line_id: line.id, position: 2, name: "Anchor bolts", quantity: 2 });
    db.seed("costing_component_costs", { component_id: bolts.id, acquire_unit: 1000 });
    db.seed("costing_cost_rows", { matrix_id: matrix.id, position: 1, description: "Delivery Charge", quantity: 1, acquire_unit: 100000, markup_factor: 1 });
  }

  beforeEach(() => {
    deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S06070" });
  });

  it("shows the Closed Book each factor as x and +%, the Markup Price per row, and the line's sum", async () => {
    seed();
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["management", "markup"] });
    openDesk(deal);

    await openLines();

    const block = await screen.findByTestId("components");
    const rows = within(block).getAllByTestId("component");
    // The vehicle's own x1.47; the bolts follow the default x1.35.
    expect(within(rows[0]).getByLabelText("Markup factor 1.1")).toHaveValue(1.47);
    expect(within(rows[0]).getByTestId("markup-factor-shown")).toHaveTextContent("×1.47 · +47%");
    expect(within(rows[1]).getByLabelText("Markup factor 1.2")).toHaveValue(null);
    expect(within(rows[1]).getByTestId("markup-factor-shown")).toHaveTextContent("×1.35 · +35% (default)");
    // 2,160,500 x 1.47 = 3,175,935 and 1,000 x 1.35 = 1,350 per unit, 2,700 for two.
    expect(within(rows[0]).getAllByText("₱3,175,935.00")).toHaveLength(2);
    expect(within(rows[1]).getByText("₱1,350.00")).toBeInTheDocument();
    expect(within(rows[1]).getByText("₱2,700.00")).toBeInTheDocument();
    // The line adds them up beside its Final Offer; each part shows its markup under its own heading.
    expect(screen.getByTestId("line-markup-price")).toHaveTextContent("₱3,178,635.00");
    expect(within(rows[0]).getByRole("region", { name: "Markup" })).toHaveTextContent("Markup factor");
  });

  it("flags a Tender Line whose Final Offer is under the target, and still fills nothing in", async () => {
    seed({ finalOffer: 3000000 });
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["management"] });
    openDesk(deal);

    await openLines();

    const line = await screen.findByTestId("tender-line");
    expect(within(line).getByLabelText("Final Offer 1")).toHaveTextContent("₱3,000,000.00");
    expect(within(line).getByTestId("line-achieved")).toHaveTextContent("Under target");
    expect(db.rows("costing_tender_line_prices").map((p) => p.final_offer_unit)).toEqual([3000000]);
  });

  it("shows Purchasing the markup price on the Costs step: Acquire × the part's own markup, else the evaluation's", async () => {
    seed();
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["purchasing"] });
    openDesk(deal);

    await openStep("Costs");
    expect(await screen.findByLabelText("Markup")).toHaveTextContent("1.35");
    const prices = screen.getAllByTestId("corridor-markup-price");
    // The vehicle at its own x1.47: 2,160,500 x 1.47 = 3,175,935; the bolts at the default x1.35: 1,000 x 1.35 = 1,350.
    expect(prices[0]).toHaveTextContent("₱3,175,935.00");
    expect(prices[1]).toHaveTextContent("₱1,350.00");
    // Only the Markup list sets it: Purchasing reads it.
    expect(screen.getByLabelText("Markup").tagName).toBe("SPAN");
  });

  it("labels the Markup price beside Acquire, names the Costs-step cost column, and sticks the heading under a deal bar pinned only on a laptop (#1038)", async () => {
    seed();
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["purchasing", "management"] });
    openDesk(deal);

    await openStep("Costs");
    const prices = await screen.findAllByTestId("corridor-markup-price");
    expect(prices[0]).toHaveTextContent("Markup price");
    const heading = screen.getByRole("columnheader", { name: "Final Acquire / unit" });
    expect(heading.className).toContain("xl:sticky");
    expect(screen.queryByRole("columnheader", { name: "Our cost" })).not.toBeInTheDocument();
    // The deal bar pins from xl up only: a phone shows it in the flow, with the figures stacked.
    const bar = screen.getByTestId("corridor-deal");
    expect(bar.className).toContain("xl:sticky");
    expect(bar.className).not.toMatch(/(^|\s)sticky(\s|$)/);
  });

  it("saves a typed markup for the evaluation, follows it on the parts, and never changes an offer", async () => {
    seed({ defaultFactor: null });
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["management", "markup"] });
    const user = openDesk(deal);

    await openStep("Costs");
    const markup = await screen.findByLabelText("Markup");
    await user.clear(markup);
    await user.type(markup, "1.5");
    await user.tab();
    await waitFor(() => expect(db.rows("costing_matrix_money")[0].default_factor).toBe(1.5));
    // The bolts follow: 1,000 x 1.50; the vehicle keeps its own x1.47.
    await waitFor(() => expect(screen.getAllByTestId("corridor-markup-price")[1]).toHaveTextContent("₱1,500.00"));
    expect(screen.getAllByTestId("corridor-markup-price")[0]).toHaveTextContent("₱3,175,935.00");
    expect(db.rows("costing_tender_line_prices")[0].final_offer_unit).toBe(3300000);
  });

  it("keeps a Component's own markup in the line's detail", async () => {
    seed();
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["management", "markup"] });
    const user = openDesk(deal);

    await openLines();
    const boltsFactor = within(screen.getAllByTestId("component")[1]).getByLabelText("Markup factor 1.2");
    await user.type(boltsFactor, "2.0644");
    await user.tab();
    await waitFor(() => expect(db.rows("costing_component_costs").find((c) => c.component_id === bolts.id).markup_factor).toBe(2.0644));
    await waitFor(() => expect(within(screen.getAllByTestId("component")[1]).getByTestId("markup-factor-shown")).toHaveTextContent("×2.0644 · +106.44%"));
    await closeLine();
  });

  it("shows a Closed Book reader outside the Markup list the markup read-only", async () => {
    seed();
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["technical"] });
    openDesk(deal);

    await openStep("Costs");
    expect((await screen.findByLabelText("Markup")).tagName).toBe("SPAN");
    await openLines();
    expect(within(screen.getAllByTestId("component")[0]).getByLabelText("Markup factor 1.1").tagName).toBe("SPAN");
  });

  it("has no markup row for the cost tier, which is not sent the factor", async () => {
    seed();
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"], manageMarkup: false });
    openDesk(deal);

    await openStep("Costs");
    await screen.findAllByTestId("corridor-line");
    expect(screen.queryByTestId("corridor-markup")).not.toBeInTheDocument();
    expect(screen.queryByTestId("corridor-markup-price")).not.toBeInTheDocument();
  });

  it("gives Sales the peso Markup Price and neither a factor, nor the Acquire, nor the achieved markup", async () => {
    seed();
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"], manageMarkup: false });
    openDesk(deal);

    await openLines();

    const line = await screen.findByTestId("tender-line");
    expect(within(line).getByTestId("line-markup-price")).toHaveTextContent("₱3,178,635.00");
    expect(within(line).queryByTestId("line-achieved")).not.toBeInTheDocument();
    expect(screen.queryByTestId("markup-default")).not.toBeInTheDocument();
    expect(screen.queryByTestId("markup-overall")).not.toBeInTheDocument();

    const rows = within(screen.getByTestId("components")).getAllByTestId("component");
    expect(within(rows[0]).getAllByText("₱3,175,935.00")).toHaveLength(2);
    expect(within(rows[1]).getByText("₱2,700.00")).toBeInTheDocument();
    expect(screen.queryByLabelText("Markup factor 1.1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("markup-factor-shown")).not.toBeInTheDocument();
    expect(screen.queryByText(/Acquire/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Achieved|Under target/)).not.toBeInTheDocument();
    // A cost-only row's Markup Price would be its Acquire (x1.00): the price tier gets no Other costs step at all.
    expect(screen.queryByTestId("corridor-other-costs")).not.toBeInTheDocument();
    expect(screen.queryByText("₱100,000.00")).not.toBeInTheDocument();
  });

  it("gives Purchasing the Acquire and no Markup Price or factor at all", async () => {
    seed();
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"], manageMarkup: false });
    openDesk(deal);

    await openLines();

    const block = await screen.findByTestId("components");
    expect(within(block).getByLabelText("Acquire 1.1")).toHaveValue(2160500);
    expect(screen.queryByText(/Markup/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("line-markup-price")).not.toBeInTheDocument();
    expect(screen.queryByTestId("markup-default")).not.toBeInTheDocument();
  });

  it("shows a Stage Participant no markup at all", async () => {
    seed();
    stubCostingMatrixRpcs({ tier: "participant", bands: [], manageMarkup: false });
    openDesk(deal);

    await openLines();

    await screen.findByTestId("components");
    expect(screen.queryByText(/Markup|Achieved/)).not.toBeInTheDocument();
  });
});
