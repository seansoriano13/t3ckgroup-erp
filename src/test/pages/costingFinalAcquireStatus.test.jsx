import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { openStep, renderCostingDesk } from "@/test/support/costingDesk";

/**
 * The Final Acquire step shows and sets each part's Status (#1034, tracker A2 and C1): Sales picks it, everyone
 * else reads it with a hint; an empty box says what it needs; the step counts what is in the way; and a discount
 * the database would refuse is refused in plain words first.
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

describe("Final Acquire step: Status and the discount", () => {
  let deal;
  let matrix;

  function seed(parts) {
    matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    db.seed("costing_matrix_money", { matrix_id: matrix.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue vehicle", unit: "unit", quantity: 1 });
    db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: 100000, final_offer_unit: 90000 });
    parts.forEach(({ name, status = null, odoo = null, acquire = null }, i) => {
      const c = db.seed("costing_components", { tender_line_id: line.id, position: i + 1, name, quantity: 1, unit: "unit", status });
      db.seed("costing_component_costs", { component_id: c.id, acquire_unit: acquire, odoo_unit: odoo, final_acquire_unit: null });
    });
  }

  function open(bands) {
    const owner = makeEmployee();
    authUser = { id: owner.id, isSuperAdmin: true };
    stubCostingMatrixRpcs({ tier: "closed_book", bands });
    return renderCostingDesk(deal);
  }

  beforeEach(() => {
    deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S06070" });
  });

  it("says why each empty box is empty, and counts the parts that need a Status", async () => {
    seed([
      { name: "Alpha" },
      { name: "Bravo", status: "stockable" },
      { name: "Charlie", status: "source_out" },
      { name: "Delta", status: "stockable", odoo: 1000 },
    ]);
    open(["sales", "management"]);
    await openStep("Final Acquire");

    const boxes = async (name) => (await screen.findByLabelText(`Final Acquire / unit ${name}`));
    expect(await boxes("Alpha")).toHaveAttribute("placeholder", "Needs a Status");
    expect(await boxes("Bravo")).toHaveAttribute("placeholder", "Needs the Odoo SRP");
    expect(await boxes("Charlie")).toHaveAttribute("placeholder", "Needs the Acquire");
    expect(await boxes("Delta")).toHaveAttribute("placeholder", "₱800.00 by rule");
    const steps = screen.getByRole("list", { name: "Steps" });
    expect(within(steps).getByText(/4 of 4 left · 1 need a Status/)).toBeInTheDocument();
  });

  it("lets Sales pick a Status, and Management only read it with the hint", async () => {
    seed([{ name: "Alpha" }]);
    open(["sales"]);
    await openStep("Final Acquire");
    expect(await screen.findByRole("combobox", { name: "Status Alpha" })).toBeInTheDocument();
  });

  it("shows the Status read-only with the hint for Management", async () => {
    seed([{ name: "Alpha", status: "source_out" }]);
    open(["management"]);
    await openStep("Final Acquire");
    const cell = await screen.findByTestId("corridor-part-status");
    expect(within(cell).getByText("Source Out")).toBeInTheDocument();
    expect(within(cell).getByText("Sales sets the Status")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Status Alpha" })).not.toBeInTheDocument();
  });

  it("refuses a discount that rounds to 100 in plain words", async () => {
    seed([{ name: "Alpha" }]);
    open(["management"]);
    await openStep("Final Acquire");
    const box = await screen.findByLabelText("Final Acquire discount from the Odoo SRP");
    fireEvent.change(box, { target: { value: "99.999" } });
    fireEvent.blur(box);
    expect(await screen.findByText("Type a discount below 100, like 20.")).toBeInTheDocument();
    expect(screen.queryByText(/violates check constraint/)).not.toBeInTheDocument();
  });
});
