import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { stubCanvassMoneyRpc } from "@/test/stubs/canvassRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { openLines, renderCostingDesk } from "@/test/support/costingDesk";

/**
 * Expected and Actual cost on the Costing Matrix (#686): the attached P0's price is the Actual and
 * wins over the Expected (Acquire). Real components on the fake database. The "Canvass winner"
 * mark on Acquire comes back with the winner rules of #969.
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

describe("Expected and Actual cost on the S0 Evaluation", () => {
  let purchaser;
  let deal;
  let component;

  const mount = ({ tier = "cost", bands = ["purchasing"] } = {}) => {
    stubCostingMatrixRpcs({ tier, bands, actorId: purchaser.id });
    return renderCostingDesk(deal);
  };

  const seedCost = (cost) => db.seed("costing_component_costs", { component_id: component.id, ...cost });

  beforeEach(() => {
    stubCanvassMoneyRpc({ money: true });
    purchaser = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true });
    authUser = { id: purchaser.id };
    deal = makeOpportunity({ registered_by: purchaser.id, deal_owner_id: purchaser.id, sales_reference: "S07983" });
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1 });
    component = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Folding Stretcher" });
  });

  it("shows Expected, Actual and the change when the P0 price differs", async () => {
    seedCost({ acquire_unit: 78000, p0_unit_price: 81900 });
    mount();
    await openLines();
    expect(await screen.findByTestId("cost-comparison")).toHaveTextContent("Expected ₱78,000.00 · Actual ₱81,900.00 (+5.0%)");
  });

  it("shows one figure when the P0 price matches", async () => {
    seedCost({ acquire_unit: 78000, p0_unit_price: 78000 });
    mount();
    await openLines();
    expect(await screen.findByTestId("cost-comparison")).toHaveTextContent(/^₱78,000\.00$/);
  });

  it("shows a USD P0 in pesos at the Canvass rate, not its dollar price as pesos", async () => {
    // P01235: the Light Tower 400 at USD 388; the Canvass winner filled Acquire at 63.509.
    seedCost({ acquire_unit: 24641.49, p0_unit_price: 24641.49, p0_quoted_unit_price: 388, p0_currency: "USD" });
    mount();
    await openLines();
    const text = await screen.findByTestId("cost-comparison");
    expect(text).toHaveTextContent("₱24,641.49 · $388.00 at the Canvass rate");
    expect(text).not.toHaveTextContent("₱388.00");
  });

  it("shows a USD P0 with no peso rate in dollars, not compared", async () => {
    seedCost({ acquire_unit: 24641.49, p0_unit_price: null, p0_quoted_unit_price: 388, p0_currency: "USD" });
    mount();
    await openLines();
    const text = await screen.findByTestId("cost-comparison");
    expect(text).toHaveTextContent("Actual $388.00 in USD, not compared");
    expect(text).not.toHaveTextContent("%");
  });

  it("shows nothing about cost to a tier that may not read it", async () => {
    seedCost({ acquire_unit: 78000, p0_unit_price: 81900 });
    mount({ tier: "price", bands: ["sales"] });
    await openLines();
    await screen.findByTestId("costing-desk");
    expect(screen.queryByTestId("cost-comparison")).not.toBeInTheDocument();
    expect(screen.queryByText(/81,900/)).not.toBeInTheDocument();
  });
});
