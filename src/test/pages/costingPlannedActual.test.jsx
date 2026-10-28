import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { openLines, renderCostingDesk } from "@/test/support/costingDesk";

/**
 * Planned and Actual Revenue in the Costing Matrix summary (#605), Closed Book only. One Tender Line at
 * a Final Offer of 2,980,000 with two Components at Final Acquire 1,000,000 and 1,338,500 (Revenue
 * 423,100 as today). The maths is costingMath's; this is the wiring: the two columns, the "estimate"
 * mark, the not-bought note and the highlighted difference.
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

describe("Planned and Actual Revenue on the summary", () => {
  let reader;
  let deal;
  let first;
  let ipas;

  const mount = (stub = { tier: "closed_book", bands: ["purchasing"] }) => {
    stubCostingMatrixRpcs({ actorId: reader.id, ...stub });
    renderCostingDesk(deal);
  };

  /** The first Component bought on the IPAS' PO at the given price per unit. */
  const buy = (unitPrice, computationStatus) => {
    ipas = db.seed("ipas", {
      number: "TGIPAS_050",
      po_number: "P02552",
      state: "open",
      purpose: "project",
      source: "local",
      priority: "high",
      created_by: reader.id,
      computation_status: computationStatus,
      landed_cost_split: "value",
      odoo_copy: { po: { name: "P02552", currency: "Php" }, supplier: { id: 1, name: "Scorpe" }, lines: [{ line_id: 11, name: "Tripod", quantity: 1, price_unit: unitPrice }] },
    });
    db.seed("ipas_sors", { ipas_id: ipas.id, opportunity_id: deal.id });
    const request = db.seed("purchase_requests", { opportunity_id: deal.id, created_by: reader.id });
    db.seed("purchase_request_items", {
      request_id: request.id,
      source: "component",
      component_id: first.id,
      name: "Tripod",
      status: "purchased",
      requested_by: reader.id,
      po_number: "P02552",
      quantity: 1,
      odoo_po_line_ids: [11],
    });
  };

  beforeEach(() => {
    reader = makeEmployee({ name: "Closed Book" });
    authUser = { id: reader.id };
    deal = makeOpportunity({ registered_by: reader.id, deal_owner_id: reader.id });
    db.seed("costing_settings", { id: 1 });
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue vehicle", unit: "unit", quantity: 1 });
    db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: 3200000, final_offer_unit: 2980000 });
    first = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Tripod", quantity: 1, unit: "unit" });
    const second = db.seed("costing_components", { tender_line_id: line.id, position: 2, name: "Winch", quantity: 1, unit: "unit" });
    db.seed("costing_component_costs", { component_id: first.id, final_acquire_unit: 1000000 });
    db.seed("costing_component_costs", { component_id: second.id, final_acquire_unit: 1338500 });
  });

  it("shows Planned as today's Revenue and Actual equal to it while nothing is bought, with the not-bought note", async () => {
    mount();
    await openLines();
    const block = await screen.findByTestId("summary-planned-actual");
    expect(screen.getByTestId("summary-revenue")).toHaveTextContent("₱423,100.00");
    expect(within(block).getByTestId("summary-planned-revenue")).toHaveTextContent("₱423,100.00");
    expect(within(block).getByTestId("summary-actual-revenue")).toHaveTextContent("₱423,100.00");
    expect(within(block).getByTestId("summary-not-bought")).toHaveTextContent("2 of 2 items not bought yet, counted at the planned cost.");
    expect(within(block).getByTestId("summary-difference")).toHaveAttribute("data-lower", "false");
  });

  it("highlights the difference when buying cost more, and marks Actual an estimate while the IPAS is short of LC Odoo Done", async () => {
    buy(1100000, "encoded");
    mount();
    await openLines();
    const block = await screen.findByTestId("summary-planned-actual");
    expect(await within(block).findByTestId("summary-actual-estimate")).toHaveTextContent("estimate");
    // The first Component at 1,100,000 instead of 1,000,000: Actual Revenue 100,000 below Planned.
    expect(within(block).getByTestId("summary-actual-revenue")).toHaveTextContent("₱323,100.00");
    const difference = within(block).getByTestId("summary-difference");
    expect(difference).toHaveAttribute("data-lower", "true");
    expect(difference).toHaveTextContent("-₱100,000.00");
    expect(within(block).getByTestId("summary-not-bought")).toHaveTextContent("1 of 2 items not bought yet");
  });

  it("drops the estimate mark once the IPAS reached LC Odoo Done, and does not highlight a saving", async () => {
    buy(900000, "lc_odoo_done");
    mount();
    await openLines();
    const block = await screen.findByTestId("summary-planned-actual");
    expect(within(block).getByTestId("summary-actual-revenue")).toHaveTextContent("₱523,100.00");
    expect(within(block).queryByTestId("summary-actual-estimate")).not.toBeInTheDocument();
    const difference = within(block).getByTestId("summary-difference");
    expect(difference).toHaveAttribute("data-lower", "false");
    expect(difference).toHaveTextContent("+₱100,000.00");
  });

  it.each([
    ["cost", ["purchasing"]],
    ["price", ["sales"]],
  ])("shows the %s tier neither the summary nor the comparison", async (tier, bands) => {
    mount({ tier, bands });
    await openLines();
    await screen.findAllByTestId("component");
    expect(screen.queryByTestId("costing-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("summary-planned-actual")).not.toBeInTheDocument();
  });
});
