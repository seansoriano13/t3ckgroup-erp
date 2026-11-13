import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";

import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { openLines, renderCostingDesk } from "@/test/support/costingDesk";

/**
 * The S0 Evaluation's Canvass button (#972, spec #956): a Canvass belongs to a Purchase Request, so
 * the button on an evaluation line opens the Canvass of the request that carries the line, at that
 * line. With no request yet it is off and says to raise the request first; on more than one
 * request it lists them. A winner's fills on the row keep working.
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

describe("the Canvass button on an S0 Evaluation line", () => {
  let deal;
  let vehicle;
  let buyer;

  beforeEach(() => {
    deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S06070" });
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue vehicle", unit: "unit", quantity: 1 });
    vehicle = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "4x4 pick-up", brand: "Ford", quantity: 1, unit: "unit" });
    buyer = makeEmployee({ name: "Bea Buyer", has_purchasing_flow: true });
    authUser = { id: buyer.id, isSuperAdmin: true };
  });

  // One project request per SOR; another request carrying the line is a Direct request (#798).
  const request = (title, { direct = false } = {}) =>
    db.seed("purchase_requests", { opportunity_id: direct ? null : deal.id, created_by: buyer.id, buyer_id: buyer.id, title });
  const item = (requestId, status = "still_canvassing") =>
    db.seed("purchase_request_items", {
      request_id: requestId,
      source: "component",
      component_id: vehicle.id,
      name: "4x4 pick-up",
      quantity: 1,
      status,
      requested_by: buyer.id,
    });

  const vehicleRow = async () => {
    renderCostingDesk(deal);
    await openLines();
    return within(await screen.findByTestId("components")).getAllByTestId("component")[0];
  };

  it("opens the request's Canvass at the line", async () => {
    const pr = request("S06070 vehicles");
    const line = item(pr.id);
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });

    const row = await vehicleRow();
    const button = await within(row).findByRole("link", { name: "Canvass 1.1" });
    expect(button).toHaveAttribute("href", `/purchasing?request=${pr.id}&canvass=1&line=${line.id}`);
  });

  it("is off with no request yet, and says to raise the Purchase Request first", async () => {
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });

    const row = await vehicleRow();
    const button = await within(row).findByRole("button", { name: "Canvass 1.1" });
    expect(button).toBeDisabled();
    expect(within(row).getByText("Raise the Purchase Request first")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Raise it from the SOR" })).toBeInTheDocument();
  });

  it("counts a cancelled line as no request", async () => {
    item(request("S06070 vehicles").id, "cancelled");
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });

    const row = await vehicleRow();
    expect(await within(row).findByRole("button", { name: "Canvass 1.1" })).toBeDisabled();
  });

  it("gives a reader who can't raise a request only the note", async () => {
    stubCostingMatrixRpcs({ tier: "price", bands: [] });

    const row = await vehicleRow();
    expect(await within(row).findByText("Raise the Purchase Request first")).toBeInTheDocument();
    expect(within(row).queryByRole("link", { name: "Raise it from the SOR" })).not.toBeInTheDocument();
  });

  it("lists every request's Canvass when the line is on more than one", async () => {
    const first = request("S06070 vehicles");
    const second = request("S06070 spare vehicle", { direct: true });
    const a = item(first.id);
    const b = item(second.id);
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });

    const row = await vehicleRow();
    const list = await within(row).findByRole("list", { name: "Canvasses of 1.1" });
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["S06070 vehicles", "S06070 spare vehicle"]);
    expect(links[0]).toHaveAttribute("href", `/purchasing?request=${first.id}&canvass=1&line=${a.id}`);
    expect(links[1]).toHaveAttribute("href", `/purchasing?request=${second.id}&canvass=1&line=${b.id}`);
  });

  it("keeps the winner's fills: from Canvass beside Acquire, the Brand proposal with its Accept", async () => {
    const pr = request("S06070 vehicles");
    const line = item(pr.id);
    const canvass = db.seed("request_canvasses", { request_id: pr.id, canvasser_id: buyer.id });
    const supplier = db.seed("request_canvass_suppliers", { canvass_id: canvass.id, supplier_name: "Redleaf", sort_order: 0 });
    const quote = db.seed("request_canvass_quotes", { canvass_id: canvass.id, supplier_id: supplier.id, item_id: line.id, brand: "Toyota" });
    db.seed("request_canvass_winners", { item_id: line.id, supplier_id: supplier.id, reason: "Cheapest", chosen_at: "2026-11-10T00:00:00Z" });
    db.seed("costing_component_costs", { component_id: vehicle.id, acquire_unit: 2160500, acquire_from_offer_id: quote.id });
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });

    const row = await vehicleRow();
    expect(await within(row).findByTestId("from-canvass")).toHaveTextContent("from Canvass");
    expect(within(row).getByTestId("brand-proposal")).toHaveTextContent("Canvass says Toyota");
    expect(within(row).getByRole("button", { name: "Accept brand Toyota for Component 1.1" })).toBeInTheDocument();
    expect(within(row).getByTestId("component-canvass")).toHaveTextContent(/CNV_\d+\s*1 supplier/);
  });
});
