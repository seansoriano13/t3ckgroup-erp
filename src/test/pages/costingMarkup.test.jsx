import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithProviders, setupUser, chooseOption } from "@/test/support";
import { db } from "@/test/db/store";
import { stubEdgeFunction, stubRpc } from "@/test/msw/server";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import OpportunityDetailsModal from "@/components/sor/OpportunityDetailsModal";

/**
 * Markup on the Costing Matrix grid (#269): the Closed Book sees each factor as ×1.35 and +35%, a
 * row's Markup Price, each Tender Line's Markup Price beside Final Offer, the achieved markup against
 * the target (per line and overall) and sets the default factor; Sales sees the peso Markup Price and
 * nothing behind it; Purchasing sees neither. Real components and services on the fake database, with
 * the matrix functions stubbed (policy 80 holds who may do what).
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

function openModal(deal) {
  const owner = makeEmployee();
  authUser = { id: owner.id, isSuperAdmin: true };
  stubEdgeFunction("odoo-sor-lookup", { success: true, found: true, order: { id: 1, name: "S1", state: "sale" }, customer: {}, items: [] });
  stubRpc("ipas_summaries_for_sor", []);
  stubRpc("ipas_standing_for_sor", []);
  stubRpc("handoffs_for_sor", { transmittals: [], packing_lists: [] });
  renderWithProviders(<OpportunityDetailsModal isOpen onClose={() => {}} opportunity={deal} />);
  return setupUser();
}

const openPms = async () => fireEvent.click(await screen.findByRole("button", { name: /^PMS/ }));

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
    openModal(deal);

    await openPms();

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
    expect(within(screen.getByTestId("component-totals")).getByText("₱3,178,635.00")).toBeInTheDocument();
    expect(within(block).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(expect.arrayContaining(["Markup", "Markup factor", "Markup Price / unit"]));
  });

  it("shows each Tender Line's Markup Price beside Final Offer with the achieved markup against the target, and the overall in the header", async () => {
    seed();
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["management"] });
    openModal(deal);

    await openPms();

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
    expect(screen.getByLabelText("Default markup factor")).toHaveValue(1.35);
  });

  it("flags a Tender Line whose Final Offer is under the target, and still fills nothing in", async () => {
    seed({ finalOffer: 3000000 });
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["management"] });
    openModal(deal);

    await openPms();

    const line = await screen.findByTestId("tender-line");
    expect(within(line).getByLabelText("Final Offer 1")).toHaveTextContent("₱3,000,000.00");
    expect(within(line).getByTestId("line-achieved")).toHaveTextContent("Under target");
    expect(db.rows("costing_tender_line_prices").map((p) => p.final_offer_unit)).toEqual([3000000]);
  });

  it("shows a cost-only row at x1.00 and its Markup Price, and leaves a blank Acquire blank", async () => {
    seed();
    db.seed("costing_cost_rows", { matrix_id: matrix.id, position: 2, description: "Unpriced", quantity: 1 });
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["management"] });
    openModal(deal);

    await openPms();

    const [delivery, unpriced] = await within(await screen.findByTestId("cost-rows")).findAllByTestId("cost-row");
    expect(within(delivery).getByTestId("markup-factor-shown")).toHaveTextContent("×1.00 · +0%");
    expect(within(delivery).getAllByText("₱100,000.00").length).toBeGreaterThanOrEqual(3);
    expect(within(unpriced).getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("lets the Final Acquire list pick a preset, which sets the default factor and leaves Final Offer alone", async () => {
    seed();
    db.seed("costing_markup_presets", { label: "Government", factor: 1.35, sort: 1, active: true });
    db.seed("costing_markup_presets", { label: "Private", factor: 2.4, sort: 2, active: true });
    db.seed("costing_markup_presets", { label: "Retired", factor: 9, sort: 3, active: false });
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["management"] });
    const user = await openModal(deal);

    await openPms();
    const select = await screen.findByRole("combobox", { name: "Markup preset" });
    await chooseOption(user, select, "Private (×2.40)");

    await waitFor(() => expect(db.rows("costing_matrix_money")[0]).toMatchObject({ default_factor: 2.4 }));
    await waitFor(() => expect(screen.getByTestId("markup-default-shown")).toHaveTextContent("×2.40 +140%"));
    // The bolts follow the new default; the vehicle keeps its own x1.47; Final Offer is where Sales left it.
    expect(within(screen.getAllByTestId("component")[1]).getByTestId("markup-factor-shown")).toHaveTextContent("×2.40 · +140% (default)");
    expect(within(screen.getAllByTestId("component")[0]).getByTestId("markup-factor-shown")).toHaveTextContent("×1.47 · +47%");
    expect(db.rows("costing_tender_line_prices")[0].final_offer_unit).toBe(3300000);
    // A preset that was switched off is not offered.
    await user.click(select);
    expect(screen.queryByRole("option", { name: /Retired/ })).not.toBeInTheDocument();
  });

  it("saves a typed default factor and a Component's own override", async () => {
    seed({ defaultFactor: null });
    stubCostingMatrixRpcs({ tier: "closed_book", bands: ["management"] });
    const user = await openModal(deal);

    await openPms();
    expect(await screen.findByTestId("markup-default-shown")).toHaveTextContent("None yet");
    expect(within(screen.getAllByTestId("component")[1]).getByTestId("markup-factor-shown")).toHaveTextContent("No factor yet");

    await user.type(screen.getByLabelText("Default markup factor"), "1.5");
    await user.tab();
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
    openModal(deal);

    await openPms();

    expect(await screen.findByTestId("markup-default-shown")).toHaveTextContent("×1.35 +35%");
    expect(screen.queryByRole("combobox", { name: "Markup preset" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Default markup factor")).not.toBeInTheDocument();
    expect(screen.getByText("Sales, Purchasing and the Final Acquire list set the markup factor.")).toBeInTheDocument();
    expect(within(screen.getAllByTestId("component")[0]).getByLabelText("Markup factor 1.1").tagName).toBe("SPAN");
  });

  it("gives Sales the peso Markup Price and neither a factor, nor the Acquire, nor the achieved markup", async () => {
    seed();
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"], manageMarkup: false });
    openModal(deal);

    await openPms();

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
    openModal(deal);

    await openPms();

    const block = await screen.findByTestId("components");
    expect(within(block).getByLabelText("Acquire 1.1")).toHaveValue(2160500);
    expect(screen.queryByText(/Markup/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("line-markup-price")).not.toBeInTheDocument();
    expect(screen.queryByTestId("markup-default")).not.toBeInTheDocument();
  });

  it("shows a Stage Participant no markup at all", async () => {
    seed();
    stubCostingMatrixRpcs({ tier: "participant", bands: [], manageMarkup: false });
    openModal(deal);

    await openPms();

    await screen.findByTestId("components");
    expect(screen.queryByText(/Markup|Achieved/)).not.toBeInTheDocument();
  });
});
