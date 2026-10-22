import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { openLines, renderCostingDesk } from "@/test/support/costingDesk";

/**
 * Markup on the Costing Matrix grid (#269): the Closed Book sees each factor as ×1.35 and +35%, a
 * row's Markup Price, each Tender Line's Markup Price beside Final Offer, the achieved markup against
 * the target (per line and overall) and sets the default factor; Sales sees the peso Markup Price and
 * nothing behind it; Purchasing sees neither. Real components and services on the fake database, with
 * the matrix functions stubbed (policy 80 holds who may do what).
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

function openDesk(deal) {
  const owner = makeEmployee();
  authUser = { id: owner.id, isSuperAdmin: true };
  return renderCostingDesk(deal);
}

describe("markup on the Costing Matrix grid", () => {
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
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["management"] });
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

  it("shows each Tender Line's Markup Price beside Final Offer with the achieved markup against the target, and the overall in the header", async () => {
    seed();
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["management"] });
    openDesk(deal);

    await openLines();

    const line = await screen.findByTestId("tender-line");
    expect(within(line).getByLabelText("Final Offer 1")).toHaveTextContent("₱3,300,000.00");
    expect(within(line).getByTestId("line-markup-price")).toHaveTextContent("₱3,178,635.00");
    // 3,300,000 / (2,160,500 + 2 x 1,000) = 1.526 achieved, against the blend of x1.47 and x1.35: 3,178,635 / 2,162,500.
    const achieved = within(line).getByTestId("line-achieved");
    expect(achieved).toHaveTextContent("×1.526 +52.6%");
    expect(achieved).toHaveTextContent("against ×1.4699 +46.99%");
    expect(achieved).not.toHaveTextContent("Under target");

    // The Delivery Charge pulls the overall figure down: 3,300,000 / 2,262,500 = 1.4586, and the line's stays put.
    const overall = screen.getByTestId("markup-overall");
    expect(overall).toHaveTextContent("×1.4586 +45.86%");
    expect(overall).toHaveTextContent("against ×1.4491 +44.91%");
    expect(screen.getByTestId("markup-default-shown")).toHaveTextContent("×1.35 +35%");
    // The playground starts at the saved markup.
    expect(screen.getByLabelText("Markup factor to try")).toHaveValue(1.35);
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

  it("shows another cost at its Acquire, with no markup of its own to set, and leaves a blank Acquire blank", async () => {
    seed();
    db.seed("costing_cost_rows", { matrix_id: matrix.id, position: 2, description: "Unpriced", quantity: 1 });
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["management"] });
    openDesk(deal);

    await openLines();

    const [delivery, unpriced] = await within(await screen.findByTestId("cost-rows")).findAllByTestId("cost-row");
    // It carries at x1.00 into the totals; the Closed Book sees what it costs, not a factor to change.
    expect(within(delivery).getByText("₱100,000.00")).toBeInTheDocument();
    expect(within(delivery).queryByLabelText(/markup factor/)).not.toBeInTheDocument();
    expect(within(delivery).queryByTestId("markup-factor-shown")).not.toBeInTheDocument();
    expect(within(unpriced).getByText("—")).toBeInTheDocument();
  });

  it("tries a preset without saving it, then saves it as the markup for someone who does not write Final Offers", async () => {
    seed();
    db.seed("costing_markup_presets", { label: "Government", factor: 1.35, sort: 1, active: true });
    db.seed("costing_markup_presets", { label: "Private", factor: 2.4, sort: 2, active: true });
    db.seed("costing_markup_presets", { label: "Retired", factor: 9, sort: 3, active: false });
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["management"] });
    const user = openDesk(deal);

    await openLines();
    const presets = await screen.findByLabelText("Markup presets");
    // A preset that was switched off is not offered.
    expect(within(presets).queryByRole("button", { name: /Retired/ })).not.toBeInTheDocument();
    await user.click(within(presets).getByRole("button", { name: /Private/ }));

    // Trying it changes nothing saved: 2,160,500 x 1.47 + 2 x 1,000 x 2.40 = 3,180,735, under the ABC.
    expect(screen.getByTestId("markup-preview")).toHaveTextContent("₱3,180,735.00");
    expect(db.rows("costing_matrix_money")[0].default_factor).toBe(1.35);

    await user.click(screen.getByRole("button", { name: "Save ×2.40 as the markup" }));
    await waitFor(() => expect(db.rows("costing_matrix_money")[0]).toMatchObject({ default_factor: 2.4 }));
    await waitFor(() => expect(screen.getByTestId("markup-default-shown")).toHaveTextContent("×2.40 +140%"));
    // The bolts follow the new default; the vehicle keeps its own x1.47; Final Offer is where Sales left it.
    expect(within(screen.getAllByTestId("component")[1]).getByTestId("markup-factor-shown")).toHaveTextContent("×2.40 · +140% (default)");
    expect(within(screen.getAllByTestId("component")[0]).getByTestId("markup-factor-shown")).toHaveTextContent("×1.47 · +47%");
    expect(db.rows("costing_tender_line_prices")[0].final_offer_unit).toBe(3300000);
  });

  it("applies a tried markup to the Final Offers, and can price every part at it", async () => {
    seed();
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
    const user = openDesk(deal);

    await openLines();
    const tried = await screen.findByLabelText("Markup factor to try");
    await user.clear(tried);
    await user.type(tried, "1.2");
    // The vehicle keeps its own x1.47: 3,175,935 + 2 x 1,000 x 1.20 = 3,178,335.
    expect(screen.getByTestId("markup-preview")).toHaveTextContent("₱3,178,335.00");
    expect(screen.getByText(/1 part has a markup of its own/)).toBeInTheDocument();

    // Priced at x1.20 throughout: 2,160,500 x 1.20 + 2,400 = 2,595,000.
    await user.click(screen.getByRole("switch", { name: /Price every part at this markup/ }));
    expect(screen.getByTestId("markup-preview")).toHaveTextContent("₱2,595,000.00");

    await user.click(screen.getByRole("button", { name: "Apply ×1.20 to the Final Offers" }));
    await waitFor(() => expect(db.rows("costing_tender_line_prices")[0].final_offer_unit).toBe(2595000));
    expect(db.rows("costing_matrix_money")[0].default_factor).toBe(1.2);
    expect(db.rows("costing_component_costs").find((c) => c.component_id === vehicle.id).markup_factor).toBeNull();
  });

  it("saves a typed markup and a Component's own override", async () => {
    seed({ defaultFactor: null });
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["management"] });
    const user = openDesk(deal);

    await openLines();
    expect(await screen.findByTestId("markup-default-shown")).toHaveTextContent("none yet");
    expect(within(screen.getAllByTestId("component")[1]).getByTestId("markup-factor-shown")).toHaveTextContent("No factor yet");

    const tried = screen.getByLabelText("Markup factor to try");
    await user.clear(tried);
    await user.type(tried, "1.5");
    await user.click(screen.getByRole("button", { name: "Save ×1.50 as the markup" }));
    await waitFor(() => expect(db.rows("costing_matrix_money")[0].default_factor).toBe(1.5));

    const boltsFactor = within(screen.getAllByTestId("component")[1]).getByLabelText("Markup factor 1.2");
    await user.type(boltsFactor, "2.0644");
    await user.tab();
    await waitFor(() => expect(db.rows("costing_component_costs").find((c) => c.component_id === bolts.id).markup_factor).toBe(2.0644));
    await waitFor(() => expect(within(screen.getAllByTestId("component")[1]).getByTestId("markup-factor-shown")).toHaveTextContent("×2.0644 · +106.44%"));
  });

  it("shows a Closed Book reader outside Sales and Purchasing the factor read-only", async () => {
    seed();
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["technical"] });
    openDesk(deal);

    await openLines();

    expect(await screen.findByTestId("markup-default-shown")).toHaveTextContent("×1.35 +35%");
    // They may try a markup, and save nothing.
    expect(screen.queryByRole("button", { name: /Apply|Save/ })).not.toBeInTheDocument();
    expect(screen.getByText("Sales, Purchasing and the Final Acquire list set the markup.")).toBeInTheDocument();
    expect(within(screen.getAllByTestId("component")[0]).getByLabelText("Markup factor 1.1").tagName).toBe("SPAN");
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
    // A cost-only row's Markup Price would be its Acquire (x1.00): the price tier is not shown it.
    expect(within(screen.getByTestId("cost-rows")).queryByText("₱100,000.00")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("cost-rows")).queryByText(/Markup/)).not.toBeInTheDocument();
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
