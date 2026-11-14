import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { db } from "@/test/db/store";
import { pgrstError } from "@/test/db/schema";
import { stubEdgeFunction, stubRpc } from "@/test/msw/server";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity, makeOpportunityItem } from "@/test/factories";
import { closeLine, openLines, openOverview, openStep, renderCostingDesk } from "@/test/support/costingDesk";
import { costingMatrixService } from "@/services/costingMatrixService";
import { stubRoomyScreen } from "@/test/roomyScreen";

/**
 * The Costing Desk, the Costing Matrix's record window (#267, layout A of 2026-10-22): its Tender
 * Lines filled from the SOR's products, each opening in place; with #268, the Components (a line's
 * product, or its parts), bundles, Inclusions and other costs (cost-only rows); the summary (#270) and the Bid
 * Decision (#320). Real components and services on the fake database; the matrix functions (plpgsql)
 * are stubbed. Who may read or write what is the policy tier's (78-costing-tender-lines).
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

function openDesk(deal) {
  const owner = makeEmployee();
  authUser = { id: owner.id, isSuperAdmin: true };
  return renderCostingDesk(deal);
}

/** The rest of the sheet's Revenue (#964): one Other costs row at the given amount, and Marketing typed as 0. */
function seedRestOfSheet(matrixId, expenses = 50000) {
  if (!db.rows("costing_cost_categories").some((c) => c.key === "delivery")) db.seed("costing_cost_categories", { key: "delivery", label: "Delivery", low_pct: 1, high_pct: 5, sort: 1 });
  db.seed("costing_cost_rows", { matrix_id: matrixId, position: 1, category_key: "delivery", description: "Delivery", quantity: 1, final_acquire_unit: expenses });
  db.seed("costing_matrix_money", { matrix_id: matrixId, marketing: 0 });
}

describe("the Costing Desk", () => {
  let deal;

  beforeEach(() => {
    deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S06070" });
    makeOpportunityItem(deal.id, { product_name: "Fire Hose", odoo_product_id: 55, quantity: 4, unit: "pc", unit_price: 1200, sort_order: 0 });
  });

  it("shows a line with its ABC and Final Offer, and the overview above the lines", async () => {
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Fire hose, 65 mm", unit: "pc", quantity: 4 });
    db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: 1500, final_offer_unit: 1600 });
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    openDesk(deal);

    await openLines();

    const row = await screen.findByTestId("tender-line");
    // The slide-over's header names the line and carries its totals and badge.
    const panel = screen.getByRole("dialog");
    expect(within(panel).getAllByText("Fire hose, 65 mm").length).toBeGreaterThan(0);
    expect(within(row).getByLabelText("Tender Specification 1")).toHaveValue("Fire hose, 65 mm");
    expect(within(row).getByLabelText("ABC 1")).toHaveValue("1,500.00");
    expect(within(row).getByLabelText("Final Offer 1")).toHaveValue("1,600.00");
    // 4 x 1,500 = 6,000 and 4 x 1,600 = 6,400, so the offer is above the ABC.
    expect(within(panel).getAllByText(/₱6,000\.00/).length).toBeGreaterThan(0);
    expect(within(panel).getAllByText(/₱6,400\.00/).length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("Over ABC").length).toBeGreaterThan(0);
    expect(screen.getByTestId("corridor-deal")).toHaveTextContent("106.7% of ABC");
  });

  // The unit is one of the common units a request is counted in, picked from
  // a list. A typed unit gave "pc", "pcs" and "piece" in the same column.
  it("picks a tender line's unit from the common units, not by typing", async () => {
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Fire hose, 65 mm", unit: "pc", quantity: 4 });
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    openDesk(deal);

    await openLines();

    const row = await screen.findByTestId("tender-line");
    expect(within(row).queryByRole("textbox", { name: "Unit 1" })).not.toBeInTheDocument();
    expect(within(row).getByLabelText("Unit 1")).toHaveTextContent("pc");
  });

  it("gives a Stage Participant the Tender Lines read-only, with no money columns", async () => {
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Fire hose, 65 mm", unit: "pc", quantity: 4 });
    db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: 1500, final_offer_unit: 1600 });
    stubCostingMatrixRpcs({ tier: "participant", bands: [] });
    openDesk(deal);

    await openLines();

    const row = await screen.findByTestId("tender-line");
    expect(within(row).getAllByText("Fire hose, 65 mm").length).toBeGreaterThan(0);
    expect(within(row).queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/ABC/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Final Offer/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add a line/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove Tender Line/ })).not.toBeInTheDocument();
  });

  it("makes cells outside the viewer's band read-only while Purchasing still sees the ABC", async () => {
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Fire hose, 65 mm", unit: "pc", quantity: 4 });
    db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: 1500, final_offer_unit: 1600 });
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });
    openDesk(deal);

    await openLines();

    const row = await screen.findByTestId("tender-line");
    expect(within(row).getAllByText("Fire hose, 65 mm").length).toBeGreaterThan(0);
    expect(within(row).queryByRole("textbox", { name: /ABC|Final Offer/ })).not.toBeInTheDocument();
    expect(within(row).getByText("₱1,500.00", { selector: "span[aria-label=\"ABC 1\"]" })).toBeInTheDocument();
    expect(screen.queryByText(/Final Offer/)).not.toBeInTheDocument();
  });

  it("fills an empty matrix from the SOR's products, adds a typed line, and saves a typed Final Offer", async () => {
    db.seed("costing_matrices", { opportunity_id: deal.id });
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    const user = openDesk(deal);

    // The SOR's one product came in by itself, priced from its product.
    await waitFor(() => expect(screen.getAllByTestId("corridor-line")).toHaveLength(1));
    expect(screen.getAllByTestId("corridor-line")[0]).toHaveTextContent("Fire Hose");
    expect(db.rows("costing_tender_lines")[0]).toMatchObject({ source: "sor_line", tender_specification: "Fire Hose", quantity: 4 });
    expect(db.rows("costing_components")[0]).toMatchObject({ name: "Fire Hose", quantity: 4, odoo_product_id: 55 });

    await user.click(screen.getByRole("button", { name: /Add a line that is not on the SOR/ }));
    await waitFor(() => expect(screen.getAllByTestId("corridor-line")).toHaveLength(2));
    await openLines(2);
    const typed = screen.getByTestId("tender-line");
    await user.type(within(typed).getByLabelText("Tender Specification 2"), "Rescue tripod");
    await user.tab();
    await waitFor(() => expect(db.rows("costing_tender_lines")[1].tender_specification).toBe("Rescue tripod"));
    await closeLine();

    await openLines(1);
    const hose = screen.getByTestId("tender-line");
    await user.type(within(hose).getByLabelText("Final Offer 1"), "1300");
    await user.tab();
    await waitFor(() => expect(db.rows("costing_tender_line_prices").find((p) => p.final_offer_unit === 1300)).toBeTruthy());
    expect((await within(screen.getByRole("dialog")).findAllByText(/₱5,200\.00/)).length).toBeGreaterThan(0);
    // The quotation's price shows beside the Final Offer when they differ.
    expect(within(screen.getByTestId("tender-line")).getByTestId("quotation-price")).toHaveTextContent("Quotation ₱1,200.00");
    await closeLine();

    // Refresh finds nothing new on the SOR.
    await user.click(screen.getByRole("button", { name: /Refresh from the SOR/ }));
    expect(await screen.findByText("Everything on the SOR is already here.")).toBeInTheDocument();
  });

  it("opens with products and automatically fills Odoo costs without requiring Refresh or reload (#834)", async () => {
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", {
      matrix_id: matrix.id,
      position: 1,
      source: "sor_line",
      tender_specification: "Fire Hose",
      unit: "pc",
      quantity: 4,
      odoo_product_id: 55,
      sor_line_snapshot: { name: "Fire Hose", quantity: 4, unit: "pc" },
    });
    const component = db.seed("costing_components", {
      tender_line_id: line.id,
      position: 1,
      name: "Fire Hose",
      quantity: 4,
      unit: "pc",
      odoo_product_id: 55,
    });
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });
    stubEdgeFunction("odoo-costing-costs", () => {
      db.seed("costing_component_costs", {
        component_id: component.id,
        odoo_unit: 850,
        acquire_unit: 850,
      });
      return { success: true, filled: 1, unpriced: 0 };
    });

    openDesk(deal);

    // Shows the filled cost automatically without manual refresh or reload
    await waitFor(() => {
      expect(screen.getAllByText(/₱850\.00/).length).toBeGreaterThan(0);
    });
    expect(await screen.findByText(/1 line updated from Odoo/)).toBeInTheDocument();
  });

  it("updates the screen at once when Refresh from the SOR is pressed (#834)", async () => {
    db.seed("costing_matrices", { opportunity_id: deal.id });
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });
    let costsStubbed = false;
    stubEdgeFunction("odoo-costing-costs", () => {
      if (costsStubbed) {
        const components = db.rows("costing_components");
        for (const c of components) {
          if (c.odoo_product_id && !db.rows("costing_component_costs").some((cc) => cc.component_id === c.id)) {
            db.seed("costing_component_costs", {
              component_id: c.id,
              odoo_unit: 950,
              acquire_unit: 950,
            });
          }
        }
        return { success: true, filled: 1, unpriced: 0 };
      }
      return { success: true, filled: 0, unpriced: 0 };
    });

    const user = openDesk(deal);

    // Initial fill from empty matrix creates lines, but no cost yet
    await waitFor(() => expect(screen.getAllByTestId("corridor-line")).toHaveLength(1));

    // Now Odoo has a cost available
    costsStubbed = true;
    await user.click(screen.getByRole("button", { name: /Refresh from the SOR/ }));

    // Screen updates at once with the cost
    await waitFor(() => {
      expect(screen.getAllByText(/₱950\.00/).length).toBeGreaterThan(0);
    });
    expect(await screen.findByText(/1 line updated from Odoo/)).toBeInTheDocument();
  });

  it("shows what the SOR line now says when the Product List changed", async () => {
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    db.seed("costing_tender_lines", {
      matrix_id: matrix.id,
      position: 1,
      tender_specification: "Fire Hose",
      unit: "pc",
      quantity: 4,
      source: "sor_line",
      odoo_product_id: 55,
      sor_line_snapshot: { name: "Fire Hose", quantity: 3, unit: "pc" },
    });
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    openDesk(deal);

    await openLines();

    expect(await screen.findByText("SOR line now says 4 pc")).toBeInTheDocument();
  });

  it("shows a band refusal beside the cell it refused", async () => {
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Fire hose", unit: "pc", quantity: 4 });
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    stubRpc("costing_set_money", () => {
      throw pgrstError("42501", "costing_band:costing_tender_line_prices.final_offer_unit:sales", { status: 403 });
    });
    const user = openDesk(deal);

    await openLines();
    const row = await screen.findByTestId("tender-line");
    await user.type(within(row).getByLabelText("Final Offer 1"), "900");
    await user.tab();

    expect(await within(row).findByRole("alert")).toHaveTextContent("Final Offer is written by Sales (the Deal Team).");
  });

  describe("Components, bundles, Inclusions and other costs (#268)", () => {
    let matrix;
    let line;

    // Tender Line 1 with a bundle (1.1, three Inclusions under two headings) and a part bought on its own (1.2).
    function seedComponents() {
      matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
      line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue vehicle", unit: "unit", quantity: 1 });
      db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: 2200000, final_offer_unit: 2100000 });
      const vehicle = db.seed("costing_components", {
        tender_line_id: line.id,
        position: 1,
        name: "4x4 pick-up",
        offer_specification: "Double cab, 13-line specification",
        brand: "Toyota",
        status: "source_out",
        availability: "for_order",
        source: "import",
        po_rfq_no: "RFQ-2231",
        is_bundle: true,
        quantity: 1,
        unit: "unit",
      });
      db.seed("costing_component_costs", { component_id: vehicle.id, acquire_unit: 2160500, odoo_unit: 2200000, final_acquire_unit: 2100000, markup_factor: 1.35 });
      db.seed("costing_inclusions", { component_id: vehicle.id, position: 1, heading: "Accessories", description: "Roll bar", completeness: "COVERED" });
      db.seed("costing_inclusions", { component_id: vehicle.id, position: 2, heading: "Accessories", description: "Carry bag", completeness: "MISSING" });
      db.seed("costing_inclusions", { component_id: vehicle.id, position: 3, heading: "With", description: "Spare key", completeness: "COVERED" });
      const winch = db.seed("costing_components", { tender_line_id: line.id, position: 2, name: "Winch", brand: "Warn", quantity: 2, unit: "pc" });
      db.seed("costing_component_costs", { component_id: winch.id, odoo_unit: 60000 });
      return { vehicle, winch };
    }

    it("nests Components as 1.1 and 1.2 under the Tender Line, with the owner-band header and totals", async () => {
      seedComponents();
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing"] });
      openDesk(deal);

      await openLines();

      const block = await screen.findByTestId("components");
      const rows = within(block).getAllByTestId("component");
      expect(rows).toHaveLength(2);
      expect(within(block).getByText("1.1 · 4x4 pick-up")).toBeInTheDocument();
      expect(within(block).getByText("1.2 · Winch")).toBeInTheDocument();
      expect(within(rows[0]).getByLabelText("Component name 1.1")).toHaveValue("4x4 pick-up");
      expect(within(rows[0]).getByLabelText("Offer Specification 1.1")).toHaveValue("Double cab, 13-line specification");
      expect(within(rows[0]).getByLabelText("Brand 1.1")).toHaveValue("Toyota");
      expect(within(rows[0]).queryByLabelText("P.O./RFQ No. 1.1")).toBeNull();
      expect(within(rows[0]).getByLabelText("Acquire 1.1")).toHaveValue("2,160,500.00");
      expect(within(rows[0]).getByLabelText("Odoo SRP 1.1")).toHaveValue("2,200,000.00");
      // The bundle at 1 x 2,160,500 totals 2,160,500, never 0.00; the part with no Acquire shows a dash.
      expect(within(rows[0]).getByText("₱2,160,500.00")).toBeInTheDocument();
      expect(within(rows[1]).getByText("₱120,000.00")).toBeInTheDocument();
      // One part has no Acquire, so the parts' total is not known: a dash, never a smaller sum.
      expect(within(block).getByTestId("component-totals")).toHaveTextContent("—");
      expect(within(block).getByText(/no Acquire yet/)).toBeInTheDocument();

      // Each part's fields sit under the band that writes them.
      expect(within(rows[0]).getByRole("region", { name: "Sales" })).toHaveTextContent("Brand");
      expect(within(rows[0]).getByRole("region", { name: "Purchasing" })).toHaveTextContent("Source");
      expect(within(rows[0]).getByRole("region", { name: "Purchasing" })).toHaveTextContent("Acquire / unit");
    });

    it("makes a Sales viewer's Purchasing columns read-only and shows no Acquire column at the price tier", async () => {
      seedComponents();
      stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
      openDesk(deal);

      await openLines();

      const block = await screen.findByTestId("components");
      const row = within(block).getAllByTestId("component")[0];
      // Sales writes Brand and the Odoo unit cost.
      expect(within(row).getByLabelText("Brand 1.1")).toHaveValue("Toyota");
      expect(within(row).getByLabelText("Odoo SRP 1.1")).toHaveValue("2,200,000.00");
      // Purchasing's columns read as text.
      expect(within(row).getByLabelText("Offer Specification 1.1").tagName).toBe("SPAN");
      expect(within(row).queryByLabelText("Availability 1.1")).toBeNull();
      expect(within(row).getByLabelText("Source 1.1")).toHaveTextContent("Import");
      // No Acquire, no Final Acquire, no factor: not hidden, absent. The peso Markup Price is there (#269).
      expect(within(block).queryByLabelText("Acquire 1.1")).not.toBeInTheDocument();
      expect(within(block).queryByText(/Acquire/)).not.toBeInTheDocument();
      expect(within(block).queryByText(/Final Acquire|markup factor/i)).not.toBeInTheDocument();
      expect(within(block).queryByLabelText("Markup factor 1.1")).not.toBeInTheDocument();
      expect(within(row).getAllByText("₱2,916,675.00")).toHaveLength(2);
    });

    it("makes a Purchasing viewer's Sales-only columns read-only and keeps Brand, Acquire and Offer Specification editable", async () => {
      seedComponents();
      stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing", "technical"] });
      openDesk(deal);

      await openLines();

      const row = within(await screen.findByTestId("components")).getAllByTestId("component")[0];
      // Brand is written by Sales and Purchasing; the Odoo unit cost stays Sales'.
      expect(within(row).getByLabelText("Brand 1.1")).toHaveValue("Toyota");
      expect(within(row).getByLabelText("Odoo SRP 1.1").tagName).toBe("SPAN");
      expect(within(row).getByLabelText("Acquire 1.1")).toHaveValue("2,160,500.00");
      expect(within(row).getByLabelText("Offer Specification 1.1")).toHaveValue("Double cab, 13-line specification");
    });

    // A Canvass belongs to the Purchase Request (#967), so a Component row has no Canvass button; the
    // S0 Evaluation's Canvass button (#972) opens the request's Canvass at the line.
    it("offers no Canvass button on a Component, to Purchasing or to Sales", async () => {
      seedComponents();
      stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });
      openDesk(deal);

      await openLines();

      const row = within(await screen.findByTestId("components")).getAllByTestId("component")[0];
      expect(within(row).queryByRole("button", { name: /^Canvass Component/ })).toBeNull();
    });

    it("gives a Stage Participant the Components read-only with no money columns and no add or remove", async () => {
      seedComponents();
      db.seed("costing_cost_rows", { matrix_id: matrix.id, position: 1, description: "Delivery Charge", quantity: 1, acquire_unit: 100000 });
      stubCostingMatrixRpcs({ tier: "participant", bands: [] });
      openDesk(deal);

      await openLines();

      const block = await screen.findByTestId("components");
      const row = within(block).getAllByTestId("component")[0];
      expect(within(row).getByText("4x4 pick-up")).toBeInTheDocument();
      expect(within(row).getByText("Toyota")).toBeInTheDocument();
      expect(within(block).queryByRole("textbox")).not.toBeInTheDocument();
      expect(within(block).queryByText(/Acquire|Odoo (\/ unit|total|unit)/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add a part|Break down|Add another cost|Add Inclusion/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Remove (Component|other cost|Inclusion)/ })).not.toBeInTheDocument();
      // Other costs are money: a Stage Participant gets no Other costs step, and no figure anywhere.
      expect(screen.queryByTestId("corridor-other-costs")).not.toBeInTheDocument();
      expect(screen.queryByText(/100,000/)).not.toBeInTheDocument();
    });

    it("lists a bundle's Inclusions under their headings, collapsible, with the covered count", async () => {
      seedComponents();
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "technical"] });
      const user = openDesk(deal);

      await openLines();

      const inclusions = await screen.findByTestId("inclusions");
      expect(within(inclusions).getByText("2 of 3 covered")).toBeInTheDocument();
      expect(within(inclusions).getByText("Accessories")).toBeInTheDocument();
      expect(within(inclusions).getByText("With")).toBeInTheDocument();
      expect(within(inclusions).getByLabelText("Inclusion 1.1.1 description")).toHaveValue("Roll bar");
      expect(within(inclusions).getByLabelText("Completeness 1.1.1")).toHaveTextContent("Covered");
      expect(within(inclusions).getByLabelText("Completeness 1.1.2")).toHaveTextContent("Missing");

      await user.click(within(inclusions).getByRole("button", { name: /Inclusions/ }));
      expect(within(screen.getByTestId("inclusions")).queryByText("Accessories")).not.toBeInTheDocument();
      await user.click(within(screen.getByTestId("inclusions")).getByRole("button", { name: /Inclusions/ }));
      expect(within(screen.getByTestId("inclusions")).getByText("Accessories")).toBeInTheDocument();
    });

    it("leaves Completeness to Technical: a Sales viewer reads it as text", async () => {
      seedComponents();
      stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
      openDesk(deal);

      await openLines();

      const inclusions = await screen.findByTestId("inclusions");
      expect(within(inclusions).getByLabelText("Completeness 1.1.1").tagName).toBe("SPAN");
      // Sales still edits what the Inclusion says.
      expect(within(inclusions).getByLabelText("Inclusion 1.1.1 description")).toHaveValue("Roll bar");
    });

    it("adds a Component, types its name, and adds an Inclusion under a bundle", async () => {
      matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
      line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue vehicle", unit: "unit", quantity: 1 });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "technical"] });
      const user = openDesk(deal);

      await openLines();
      await user.click(await screen.findByRole("button", { name: /Add what we supply/ }));

      const row = await screen.findByTestId("component");
      const name = within(row).getByLabelText("Component name 1.1");
      await user.clear(name);
      await user.type(name, "Winch");
      await user.tab();
      await waitFor(() => expect(db.rows("costing_components")[0].name).toBe("Winch"));

      await user.type(within(row).getByLabelText("Acquire 1.1"), "52000");
      await user.tab();
      await waitFor(() => expect(db.rows("costing_component_costs")[0].acquire_unit).toBe(52000));

      // Not a bundle yet: the database refuses an Inclusion; tick Bundle, then add one.
      await user.click(within(row).getByLabelText("Bundle 1.1"));
      await waitFor(() => expect(db.rows("costing_components")[0].is_bundle).toBe(true));
      await user.click(await screen.findByRole("button", { name: "Add Inclusion" }));
      await waitFor(() => expect(db.rows("costing_inclusions")).toHaveLength(1));
      expect(await screen.findByLabelText("Inclusion 1.1.1 description")).toHaveValue("");
    });

    it("shows a band refusal beside the Acquire cell it refused", async () => {
      seedComponents();
      stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });
      stubRpc("costing_set_money", () => {
        throw pgrstError("42501", "costing_band:costing_component_costs.acquire_unit:purchasing", { status: 403 });
      });
      const user = openDesk(deal);

      await openLines();
      const row = within(await screen.findByTestId("components")).getAllByTestId("component")[0];
      const acquire = within(row).getByLabelText("Acquire 1.1");
      await user.clear(acquire);
      await user.type(acquire, "1");
      await user.tab();

      expect(await within(row).findByRole("alert")).toHaveTextContent("Acquire is written by Purchasing.");
    });

    // Other costs is the sheet's "Project Cost Summary" on its own step (2026-11-13): Cost, Range, Amount, %.
    it("adds a cost under a category on the Other costs step, names it, and keeps it out of the Components total", async () => {
      seedComponents();
      db.seed("costing_cost_categories", { key: "labor", label: "Labor", low_pct: 8, high_pct: 15, sort: 2 });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing"] });
      const user = openDesk(deal);

      await openStep("Other costs");
      const table = await screen.findByTestId("corridor-other-costs");
      expect(within(table).getByRole("columnheader", { name: "Range" })).toBeInTheDocument();
      expect(within(table).queryByRole("columnheader", { name: /Acquire|Final cost|Qty|Category/ })).not.toBeInTheDocument();
      // #723: a cost belongs to a category, so a new one is added under one.
      await user.click(within(table).getByRole("combobox", { name: "Add a cost under a category" }));
      await user.click(await screen.findByRole("option", { name: "Labor" }));
      await waitFor(() => expect(db.rows("costing_cost_rows")).toHaveLength(1));
      expect(db.rows("costing_cost_rows")[0]).toMatchObject({ category_key: "labor", quantity: 1 });

      await user.type(await screen.findByLabelText("Name of Labor"), "Delivery Charge");
      await user.tab();
      await waitFor(() => expect(db.rows("costing_cost_rows")[0].description).toBe("Delivery Charge"));
      await user.type(await screen.findByLabelText("Amount of Delivery Charge"), "100000");
      await user.tab();
      await waitFor(() => expect(db.rows("costing_cost_rows")[0].acquire_unit).toBe(100000));
      await waitFor(() => expect(screen.getByTestId("corridor-other-costs-total")).toHaveTextContent("₱100,000.00"));
      // It says which category it counts under, and the range is the category's.
      expect(screen.getByText("under Labor")).toBeInTheDocument();
      // The Tender Line's parts total did not take it in.
      await openLines();
      expect(within(screen.getByTestId("component-totals")).queryByText(/100,000/)).not.toBeInTheDocument();
    });

    it("types a cost as a percent of the ABC, and removes a cost once it is confirmed", async () => {
      seedComponents();
      db.seed("costing_cost_categories", { key: "labor", label: "Labor", low_pct: 8, high_pct: 15, sort: 2 });
      const row = db.seed("costing_cost_rows", { matrix_id: matrix.id, position: 1, category_key: "labor", description: "Labor", quantity: 1, acquire_unit: 5000 });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing"] });
      const user = openDesk(deal);

      await openStep("Other costs");
      const percent = await screen.findByLabelText("Percent of the ABC for Labor");
      await user.clear(percent);
      await user.type(percent, "10");
      await user.tab();
      await waitFor(() => expect(db.rows("costing_cost_rows").find((r) => r.id === row.id).abc_pct).toBe(10));

      await user.click(screen.getByRole("button", { name: "Remove Labor" }));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
      await waitFor(() => expect(db.rows("costing_cost_rows")).toHaveLength(0));
    });

    it("names the matrix's Sales and Purchasing incharge, held to the viewer's band", async () => {
      const sales = makeEmployee({ name: "Sandy Sales" });
      const buyer = makeEmployee({ name: "Bea Buyer", has_purchasing_flow: true });
      deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S06071", deal_owner_id: sales.id });
      matrix = db.seed("costing_matrices", { opportunity_id: deal.id, sales_incharge_id: sales.id, purchasing_incharge_id: buyer.id });
      stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });
      const user = openDesk(deal);

      // The in-charge are named under People.
      await user.click(await screen.findByRole("button", { name: "People" }));

      // Purchasing reads the Sales incharge as a name and may change its own.
      expect(await screen.findByLabelText("Sales incharge")).toHaveTextContent("Sandy Sales");
      expect(screen.getByLabelText("Sales incharge").tagName).toBe("SPAN");
      expect(screen.getByLabelText("Purchasing incharge").tagName).not.toBe("SPAN");
    });

    it("Purchasing sees the full header and resolves Sales incharge with narrow header data (#836)", async () => {
      const sales = makeEmployee({ name: "Dani demo" });
      const buyer = makeEmployee({ name: "Cjay Buyer", has_purchasing_flow: true });
      deal = makeOpportunity({
        status: "QUALIFIED",
        sor_code: "SOR-256",
        project_title: "Project [FOR DEMO]",
        client_name: "Acme Client",
        sales_reference: "S03204",
        deal_owner_id: sales.id,
      });
      matrix = db.seed("costing_matrices", { opportunity_id: deal.id, purchasing_incharge_id: buyer.id });
      stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });

      // getHeader returns the narrow header row
      const header = await costingMatrixService.getHeader(deal.id);
      expect(header).toEqual({
        id: deal.id,
        sor_code: "SOR-256",
        client_name: "Acme Client",
        project_title: "Project [FOR DEMO]",
        sales_reference: "S03204",
        deal_owner_id: sales.id,
      });

      // When the caller has no tier, getHeader returns null
      stubCostingMatrixRpcs({ tier: null, bands: [] });
      expect(await costingMatrixService.getHeader(deal.id)).toBeNull();

      // Passing header (as Purchasing receives from fallback) displays the SOR code, title, client, and resolves Sales incharge
      stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });
      const user = openDesk(header);
      await user.click(await screen.findByRole("button", { name: "People" }));

      expect(screen.getByText("SOR-256")).toBeInTheDocument();
      expect(screen.getByText("Project [FOR DEMO]")).toBeInTheDocument();
      expect(screen.getByText("SO S03204 · Acme Client")).toBeInTheDocument();
      expect(await screen.findByLabelText("Sales incharge")).toHaveTextContent("Dani demo");
      expect(screen.queryByText("Former team member")).not.toBeInTheDocument();
    });

    describe("Requested Items on a Component (#273)", () => {
      // 1.1 is being bought twice (one ordered, one still requested); 1.2 is not being bought.
      function seedRequestedItems() {
        const { vehicle } = seedComponents();
        const buyer = makeEmployee({ name: "Bea Buyer", has_purchasing_flow: true });
        const request = db.seed("purchase_requests", { opportunity_id: deal.id, created_by: buyer.id, buyer_id: buyer.id });
        const item = (status) =>
          db.seed("purchase_request_items", {
            request_id: request.id,
            source: "component",
            component_id: vehicle.id,
            name: "4x4 pick-up",
            quantity: 1,
            status,
            requested_by: buyer.id,
          });
        item("purchased");
        item("not_checked");
      }

      it.each(["closed_book", "cost", "price", "participant"])("shows a Component its Requested Items' statuses at the %s tier", async (tier) => {
        seedRequestedItems();
        stubCostingMatrixRpcs({ tier, bands: [] });
        openDesk(deal);

        await openLines();

        const block = await screen.findByTestId("components");
        const [vehicleRow, winchRow] = within(block).getAllByTestId("component");
        const requests = await within(vehicleRow).findByTestId("component-requests");
        expect(within(requests).getByText("Purchased")).toBeInTheDocument();
        expect(within(requests).getByText("Not checked")).toBeInTheDocument();
        // Only the status: no name, quantity or requester comes with it.
        expect(requests).not.toHaveTextContent("Bea Buyer");
        expect(within(winchRow).queryByTestId("component-requests")).not.toBeInTheDocument();
      });

      it("shows nothing under a Component nobody has requested", async () => {
        seedComponents();
        stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
        openDesk(deal);

        await openLines();

        await screen.findByTestId("components");
        expect(screen.queryByTestId("component-requests")).not.toBeInTheDocument();
      });
    });
  });

  describe("the summary and Final Acquire (#270)", () => {
    let matrix;
    let component;

    // One Tender Line at a Final Offer of 2,980,000 against an ABC of 3,200,000, with one Component.
    // With `sheet`, also one Other costs row of 50,000 and Marketing typed as 0: the rest of the sheet's Revenue (#964).
    function seedSummary({ finalAcquire = null, acquire = 2300000, extraLine = false, sheet = false } = {}) {
      matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
      db.seed("costing_settings", { id: 1 });
      const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue vehicle", unit: "unit", quantity: 1 });
      db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: 3200000, final_offer_unit: 2980000 });
      if (extraLine) {
        const second = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 2, tender_specification: "Spare kit", unit: "set", quantity: 1 });
        db.seed("costing_tender_line_prices", { tender_line_id: second.id, abc_unit: 100 });
      }
      component = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "4x4 pick-up", quantity: 1, unit: "unit" });
      db.seed("costing_component_costs", { component_id: component.id, acquire_unit: acquire, final_acquire_unit: finalAcquire });
      if (sheet) seedRestOfSheet(matrix.id);
    }

    // The summary, with Planned vs Actual and Marketing, is in the Overview (2026-11-13). A figure that cannot be
    // worked shows a dash, and why is said once under the title.
    it("renders the incomplete summary with the reason once while a Component has no cost (#787: Acquire stands in for Final Acquire)", async () => {
      seedSummary({ acquire: null });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "management", "finance"] });
      openDesk(deal);

      await openOverview();

      const summary = await screen.findByTestId("costing-summary");
      expect(within(summary).getByTestId("summary-incomplete")).toHaveTextContent("Incomplete — 1 Component has no Final Acquire");
      expect(within(summary).getAllByText("Incomplete — 1 Component has no Final Acquire")).toHaveLength(1);
      expect(within(summary).getByTestId("summary-revenue")).toHaveTextContent("—");
      expect(within(summary).getByTestId("summary-landed-cost")).toHaveTextContent("—");
      expect(within(summary).getByTestId("summary-revenue-percent")).toHaveTextContent("—");
      // The offer figures still work, to the centavo.
      expect(within(summary).getByTestId("summary-final-offer")).toHaveTextContent("₱2,980,000.00");
      expect(within(summary).getByTestId("summary-vat")).toHaveTextContent("₱2,660,714.29");
      expect(within(summary).getByTestId("summary-tax")).toHaveTextContent("₱159,642.86");
      expect(within(summary).getByTestId("summary-retention")).toHaveTextContent("₱29,800.00");
      expect(within(summary).getByTestId("summary-collected")).toHaveTextContent("₱2,790,557.14");
      expect(within(summary).getByTestId("summary-itr")).toHaveTextContent("₱218,400.00");
    });

    it("shows Revenue, Revenue ÷ Final Offer and the share of the ABC once every cost is in (#229 sample)", async () => {
      seedSummary({ finalAcquire: 2338500, sheet: true });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "management", "finance"] });
      openDesk(deal);

      // The deal bar says the offer's share of the ABC and the Revenue.
      const deal_ = await screen.findByTestId("corridor-deal");
      await waitFor(() => expect(deal_).toHaveTextContent("93.1% of ABC"));
      expect(deal_).toHaveTextContent("₱24,014.29");

      await openOverview();
      const summary = await screen.findByTestId("costing-summary");
      expect(within(summary).getByTestId("summary-landed-cost")).toHaveTextContent("₱2,338,500.00");
      expect(within(summary).getByTestId("summary-project-expenses")).toHaveTextContent("₱50,000.00");
      // OPEX = retention 29,800 + 2,338,500 + 50,000 + 0
      expect(within(summary).getByTestId("summary-opex")).toHaveTextContent("₱2,418,300.00");
      expect(within(summary).getByTestId("summary-revenue")).toHaveTextContent("₱24,014.29");
      expect(within(summary).getByTestId("summary-revenue-percent")).toHaveTextContent("0.81%");
      expect(within(summary).queryByText(/Incomplete/)).not.toBeInTheDocument();
    });

    it("marks the offer figures incomplete while a Tender Line has no Final Offer", async () => {
      seedSummary({ finalAcquire: 2338500, extraLine: true, sheet: true });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "management", "finance"] });
      openDesk(deal);

      await openOverview();

      const summary = await screen.findByTestId("costing-summary");
      expect(within(summary).getByTestId("summary-incomplete")).toHaveTextContent("Incomplete — 1 tender line has no Final Offer");
      for (const id of ["summary-final-offer", "summary-vat", "summary-tax", "summary-retention", "summary-collected", "summary-itr", "summary-revenue", "summary-revenue-percent"]) {
        expect(within(summary).getByTestId(id), id).toHaveTextContent("—");
      }
    });

    it("lets the Final Acquire list type Marketing, and the summary follows (Final Acquire is back on the screen, #962)", async () => {
      seedSummary({ finalAcquire: 2338500, sheet: true });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "management", "finance"] });
      const user = openDesk(deal);

      await openLines();
      const row = await screen.findByTestId("component");
      // The figure is shown to the Closed Book; with no Status the cell says to pick one.
      expect(within(row).getByLabelText("Final Acquire 1.1")).toHaveValue("2,338,500.00");
      expect(within(row).getByTestId("final-acquire-rule")).toBeInTheDocument();
      await closeLine();

      await openOverview();
      await waitFor(() => expect(screen.getByTestId("summary-revenue")).toHaveTextContent("₱24,014.29"));
      await user.type(within(screen.getByTestId("summary-marketing")).getByLabelText("Marketing"), "12000");
      await user.tab();
      await waitFor(() => expect(db.rows("costing_matrix_money")[0]?.marketing).toBe(12000));
    });

    it("makes Marketing read-only for a Closed Book reader outside Sales and Purchasing, and OPEX is never typed (#964)", async () => {
      seedSummary({ finalAcquire: 2338500 });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["technical"] });
      openDesk(deal);

      await openOverview();

      expect(within(await screen.findByTestId("summary-marketing")).getByLabelText("Marketing").tagName).toBe("SPAN");
      expect(within(screen.getByTestId("summary-opex")).queryByLabelText("OPEX")).not.toBeInTheDocument();
    });

    it("shows a refused Marketing beside its cell", async () => {
      seedSummary({ finalAcquire: 2338500 });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "management", "finance"] });
      const user = openDesk(deal);
      await openOverview();
      await screen.findByTestId("summary-marketing");
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["technical"] });

      await user.type(within(screen.getByTestId("summary-marketing")).getByLabelText("Marketing"), "5");
      await user.tab();

      expect(await within(screen.getByTestId("summary-marketing")).findByRole("alert")).toHaveTextContent(/Marketing is written by/);
    });

    it("types another cost's amount on the Other costs step, and the Revenue follows", async () => {
      seedSummary({ finalAcquire: 100 });
      const costRow = db.seed("costing_cost_rows", { matrix_id: matrix.id, position: 1, description: "Delivery Charge", quantity: 1 });
      db.seed("costing_matrix_money", { matrix_id: matrix.id, marketing: 0 });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "management"] });
      const user = openDesk(deal);

      await openStep("Other costs");
      await user.type(await screen.findByLabelText("Amount of Delivery Charge"), "2500");
      await user.tab();

      await waitFor(() => expect(db.rows("costing_cost_rows").find((r) => r.id === costRow.id).acquire_unit).toBe(2500));
      // VAT-exclusive 2,660,714.29 - OPEX (29,800 + 100 + 2,500) - ITR 218,400
      await waitFor(() => expect(screen.getByTestId("corridor-deal")).toHaveTextContent("₱2,409,914.29"));
    });

    it.each([
      ["price", ["sales"]],
      ["cost", ["purchasing"]],
      ["participant", []],
    ])("gives the %s tier no summary and no Final Acquire column", async (tier, bands) => {
      seedSummary({ finalAcquire: 2338500 });
      stubCostingMatrixRpcs({ tier, bands });
      openDesk(deal);

      await openLines();

      await screen.findByTestId("component");
      expect(screen.queryByTestId("costing-summary")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Final Acquire 1.1")).not.toBeInTheDocument();
      expect(screen.queryByText("MNGT")).not.toBeInTheDocument();
      expect(screen.queryByText(/Incomplete/)).not.toBeInTheDocument();
    });
  });

  describe("the Bid Decision (#320), on the decision card beside the steps", () => {
    beforeEach(() => stubRoomyScreen());

    let matrix;
    let decider;

    // One Tender Line at a Final Offer of 2,980,000 against an ABC of 3,200,000.
    // The Evaluation of Specification is approved unless `approved` is false (#881: a Go waits for it).
    function seedPriced({ offer = 2980000, approved = true } = {}) {
      matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
      db.seed("costing_settings", { id: 1 });
      const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue vehicle", unit: "unit", quantity: 1 });
      db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: 3200000, final_offer_unit: offer });
      decider = makeEmployee({ name: "Boss Person" });
      if (approved) db.seed("costing_signoffs", { matrix_id: matrix.id, role: "evaluation_approved", signed_by: decider.id });
    }

    const seedDecision = (fields = {}) =>
      db.seed("costing_bid_decisions", {
        matrix_id: matrix.id,
        verdict: "no_go",
        reason: "Offer is far over the ABC and we cannot get there",
        decided_by: decider.id,
        decided_at: "2026-10-16T01:00:00.000Z",
        final_offer_total: 2980000,
        abc_total: 3200000,
        ...fields,
      });

    // The verdict buttons are named by the verdict and what it does ("Go: Bid, and lock the sheet").
    const verdict = (panel, label) => within(panel).getByRole("button", { name: new RegExp(`^${label}:`) });
    const card = () => screen.findByTestId("corridor-decision");

    it("shows the decider the Go with the figures it was taken against, and Unlock in place of the verdicts", async () => {
      seedPriced();
      seedDecision({ verdict: "go", reason: "Fits the budget" });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"], canDecideLoss: true });
      openDesk(deal);

      const panel = await card();
      expect(panel).toHaveTextContent("Go · locked");
      expect(within(panel).getByTestId("corridor-decision-live")).toHaveTextContent("Boss Person");
      expect(within(panel).getByTestId("corridor-decision-reason")).toHaveTextContent("Fits the budget");
      expect(within(panel).getByTestId("corridor-decision-figures")).toHaveTextContent("₱2,980,000.00");
      expect(within(panel).getByTestId("corridor-decision-figures")).toHaveTextContent("₱3,200,000.00");
      // A Go locks the sheet (#704): the verdict buttons give way to Unlock, which waits for a reason.
      expect(within(panel).getByTestId("corridor-decision-locked")).toHaveTextContent("The sheet is locked");
      expect(within(panel).getByRole("button", { name: "Unlock the sheet" })).toBeDisabled();
      expect(within(panel).queryByRole("button", { name: /^Revise:/ })).not.toBeInTheDocument();
    });

    it("offers Go, Revise and No-go while no Go stands", async () => {
      seedPriced();
      seedDecision({ verdict: "no_go", reason: "Too far over" });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
      openDesk(deal);

      const panel = await card();
      expect(verdict(panel, "Go")).toBeInTheDocument();
      expect(verdict(panel, "Revise")).toBeInTheDocument();
      expect(verdict(panel, "No-go")).toBeInTheDocument();
      expect(within(panel).queryByTestId("corridor-decision-locked")).not.toBeInTheDocument();
    });

    it("takes a decision: the reason is needed, then a confirmed Go records it", async () => {
      seedPriced();
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
      const user = openDesk(deal);

      const panel = await card();
      expect(panel).toHaveTextContent("No decision yet");
      expect(verdict(panel, "Go")).toBeDisabled();
      expect(within(panel).getByTestId("corridor-decision-why")).toHaveTextContent("Write a reason to decide.");

      await user.type(within(panel).getByLabelText("Reason for the decision"), "Price fits and margin is fine");
      await user.click(verdict(panel, "Go"));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Go" }));

      await waitFor(() => expect(db.rows("costing_bid_decisions")).toHaveLength(1));
      expect(db.rows("costing_bid_decisions")[0]).toMatchObject({ verdict: "go", reason: "Price fits and margin is fine", final_offer_total: 2980000, abc_total: 3200000 });
      expect(await within(await card()).findByTestId("corridor-decision-reason")).toHaveTextContent("Price fits and margin is fine");
    });

    it("keeps Go off until the Evaluation of Specification is approved, and says why; Revise stays on (#881)", async () => {
      seedPriced({ approved: false });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
      const user = openDesk(deal);

      const panel = await card();
      await user.type(within(panel).getByLabelText("Reason for the decision"), "Reprice first");
      expect(within(panel).getByTestId("corridor-decision-why")).toHaveTextContent("A Go waits for the specs to be approved.");
      expect(verdict(panel, "Go")).toBeDisabled();
      expect(verdict(panel, "Revise")).toBeEnabled();
      expect(verdict(panel, "No-go")).toBeEnabled();
    });

    // #880: a Component whose Final Acquire (3,500,000) is more than the Final Offer (2,980,000) makes the planned revenue a loss.
    function seedLoss() {
      seedPriced();
      const line = db.rows("costing_tender_lines")[0];
      const part = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "4x4 pick-up", quantity: 1, unit: "unit" });
      db.seed("costing_component_costs", { component_id: part.id, acquire_unit: 3500000, final_acquire_unit: 3500000 });
      seedRestOfSheet(matrix.id);
      // A cost change clears the evaluation approval (#881), so the approval is seated again after it.
      db.seed("costing_signoffs", { matrix_id: matrix.id, role: "evaluation_approved", signed_by: decider.id });
    }

    it("asks to confirm a Go first, stating the Final Offer, ABC and planned revenue, and writes nothing until it is confirmed (#880)", async () => {
      seedPriced();
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
      const user = openDesk(deal);

      const panel = await card();
      await user.type(within(panel).getByLabelText("Reason for the decision"), "Price fits and margin is fine");
      await user.click(verdict(panel, "Go"));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByTestId("corridor-decision-go-figures")).toHaveTextContent("Final Offer₱2,980,000.00");
      expect(within(dialog).getByTestId("corridor-decision-go-figures")).toHaveTextContent("ABC₱3,200,000.00");
      expect(within(dialog).getByTestId("corridor-decision-go-revenue")).toHaveTextContent("Not worked yet");
      expect(within(dialog).queryByTestId("corridor-decision-go-loss")).not.toBeInTheDocument();
      expect(db.rows("costing_bid_decisions")).toHaveLength(0);

      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(db.rows("costing_bid_decisions")).toHaveLength(0);
      expect(panel).toHaveTextContent("No decision yet");
    });

    it("shows Revenue ÷ Final Offer on the card, warns under the Go line and never blocks a Go (#964)", async () => {
      seedPriced();
      const line = db.rows("costing_tender_lines")[0];
      const part = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "4x4 pick-up", quantity: 1, unit: "unit" });
      db.seed("costing_component_costs", { component_id: part.id, acquire_unit: 2338500, final_acquire_unit: 2338500 });
      seedRestOfSheet(matrix.id);
      db.seed("costing_signoffs", { matrix_id: matrix.id, role: "evaluation_approved", signed_by: decider.id });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
      const user = openDesk(deal);

      const panel = await card();
      // Revenue 24,014.29 of a 2,980,000 offer: 0.81%, under the 20% Go line.
      expect(within(panel).getByTestId("corridor-decision-figures")).toHaveTextContent("Revenue0.8%");
      expect(within(panel).getByTestId("corridor-decision-under-go-line")).toHaveTextContent("Under the 20% Go line");
      await user.type(within(panel).getByLabelText("Reason for the decision"), "Strategic account");
      expect(verdict(panel, "Go")).toBeEnabled();
    });

    it("warns on a loss, and lets a Super Admin or the decider list take the Go (#880)", async () => {
      seedLoss();
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"], canDecideLoss: true });
      const user = openDesk(deal);

      const panel = await card();
      expect(within(panel).getByTestId("corridor-decision-loss")).toHaveTextContent("this bid loses money");
      await user.type(within(panel).getByLabelText("Reason for the decision"), "Bid at a loss on purpose");
      await user.click(verdict(panel, "Go"));

      const dialog = await screen.findByRole("dialog");
      // VAT-exclusive 2,660,714.29 - OPEX (29,800 + 3,500,000 + 50,000 + 0) - ITR 218,400
      expect(within(dialog).getByTestId("corridor-decision-go-revenue")).toHaveTextContent("-₱1,137,485.71");
      expect(within(dialog).getByTestId("corridor-decision-go-loss")).toHaveTextContent("This bid loses money.");
      await user.click(within(dialog).getByRole("button", { name: "Go" }));

      await waitFor(() => expect(db.rows("costing_bid_decisions")).toHaveLength(1));
      expect(db.rows("costing_bid_decisions")[0]).toMatchObject({ verdict: "go", reason: "Bid at a loss on purpose" });
    });

    it("gives everyone else the verdict and the reason, no buttons, and one line saying who decides (#1033)", async () => {
      seedLoss();
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"], canDecideLoss: false });
      openDesk(deal);

      const panel = await card();
      expect(within(panel).getByTestId("corridor-decision-readonly")).toHaveTextContent("Only the decider list or a Super Admin decides a bid.");
      expect(within(panel).queryByLabelText("Reason for the decision")).not.toBeInTheDocument();
      expect(within(panel).queryByRole("button", { name: /^Go:/ })).not.toBeInTheDocument();
      expect(within(panel).queryByRole("button", { name: /^Revise:/ })).not.toBeInTheDocument();
      expect(within(panel).queryByRole("button", { name: /^No-go:/ })).not.toBeInTheDocument();
    });

    it("draws a Go that is off in the neutral style (#899)", async () => {
      seedPriced({ approved: false });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
      const user = openDesk(deal);

      const panel = await card();
      await user.type(within(panel).getByLabelText("Reason for the decision"), "Price fits");
      const go = verdict(panel, "Go");
      expect(go).toBeDisabled();
      expect(go.className).not.toMatch(/bg-green-3/);
    });

    it("draws the green Go once the spec is approved and a reason is written (#899)", async () => {
      seedPriced();
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
      const user = openDesk(deal);

      const panel = await card();
      await user.type(within(panel).getByLabelText("Reason for the decision"), "Price fits");
      const go = verdict(panel, "Go");
      expect(go).toBeEnabled();
      expect(go.className).toMatch(/bg-green-3/);
    });

    it("hides the Unlock controls from people who cannot decide, and says who can (#899, #1033)", async () => {
      seedPriced();
      seedDecision({ verdict: "go", reason: "Fits the budget" });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"], canDecideLoss: false });
      openDesk(deal);

      const panel = await card();
      expect(within(panel).getByTestId("corridor-decision-locked")).toBeInTheDocument();
      expect(within(panel).getByTestId("corridor-decision-readonly")).toHaveTextContent("Only the decider list or a Super Admin decides a bid.");
      expect(within(panel).queryByRole("button", { name: "Unlock the sheet" })).not.toBeInTheDocument();
      expect(within(panel).queryByLabelText("Reason for unlocking")).not.toBeInTheDocument();
    });

    it("asks to confirm an Unlock, and clears the Go only once it is confirmed (#899)", async () => {
      seedPriced();
      seedDecision({ verdict: "go", reason: "Fits the budget" });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"], canDecideLoss: true });
      const user = openDesk(deal);

      const panel = await card();
      await user.type(within(panel).getByLabelText("Reason for unlocking"), "Price needs a second look");
      await user.click(within(panel).getByRole("button", { name: "Unlock the sheet" }));

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("Price needs a second look");
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(db.rows("costing_bid_decisions")[0].cleared_at).toBeFalsy();
      expect(within(panel).getByTestId("corridor-decision-locked")).toBeInTheDocument();

      await user.click(within(panel).getByRole("button", { name: "Unlock the sheet" }));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Unlock" }));
      await waitFor(() => expect(db.rows("costing_bid_decisions")[0].cleared_at).toBeTruthy());
    });

    it("keeps the controls off while a Tender Line has no Final Offer", async () => {
      seedPriced({ offer: null });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
      openDesk(deal);

      const panel = await card();
      expect(within(panel).getByTestId("corridor-decision-why")).toHaveTextContent("Every line needs a Final Offer first.");
      expect(within(panel).getByLabelText("Reason for the decision")).toBeDisabled();
      expect(verdict(panel, "No-go")).toBeDisabled();
    });

    it("shows the Deal Team the verdict and the reason and no figure and no controls", async () => {
      seedPriced();
      seedDecision();
      stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
      openDesk(deal);

      const panel = await card();
      expect(panel).toHaveTextContent("No-go");
      expect(within(panel).getByTestId("corridor-decision-reason")).toHaveTextContent("Offer is far over the ABC and we cannot get there");
      expect(within(panel).queryByTestId("corridor-decision-figures")).not.toBeInTheDocument();
      expect(panel).not.toHaveTextContent("3,200,000");
      expect(within(panel).queryByRole("button", { name: /^Go:/ })).not.toBeInTheDocument();
      expect(within(panel).queryByLabelText("Reason for the decision")).not.toBeInTheDocument();
    });

    it("allows a Go with the offer over the ABC, but says so in red on the card and in the confirm box (A1)", async () => {
      seedPriced({ offer: 3300000 });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
      const user = openDesk(deal);

      const panel = await card();
      expect(within(panel).getByTestId("corridor-decision-over-abc")).toHaveTextContent("The offer is ₱100,000.00 over the ABC. The client cannot accept it.");
      await user.type(within(panel).getByLabelText("Reason for the decision"), "Client will negotiate");
      expect(verdict(panel, "Go")).toBeEnabled();
      await user.click(verdict(panel, "Go"));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByTestId("corridor-decision-go-over-abc")).toHaveTextContent("The offer is ₱100,000.00 over the ABC. The client cannot accept it.");
      await user.click(within(dialog).getByRole("button", { name: "Go" }));
      await waitFor(() => expect(db.rows("costing_bid_decisions")).toHaveLength(1));
      expect(db.rows("costing_bid_decisions")[0]).toMatchObject({ verdict: "go" });
    });

    it("counts a line over its own ABC even when the totals are within (B4)", async () => {
      seedPriced({ offer: 3000000 });
      const second = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 2, tender_specification: "Hose", unit: "unit", quantity: 1 });
      db.seed("costing_tender_line_prices", { tender_line_id: second.id, abc_unit: 1000000, final_offer_unit: 1100000 });
      db.rows("costing_tender_line_prices")[0].abc_unit = 3400000;
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
      openDesk(deal);

      const panel = await card();
      expect(within(panel).getByTestId("corridor-decision-over-abc")).toHaveTextContent("1 line over its ABC");
      expect(panel).toHaveTextContent("The offer is within the ABC1 line over its ABC");
    });

    it("shows the live offer after a Revise and keeps the stamped figure in the decision line (B1)", async () => {
      seedPriced({ offer: 430000 });
      seedDecision({ verdict: "revise", reason: "Reprice", final_offer_total: 410000 });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
      openDesk(deal);

      const panel = await card();
      expect(within(panel).getByTestId("corridor-decision-figures")).toHaveTextContent("Offer₱430,000.00");
      expect(within(panel).getByTestId("corridor-decision-live")).toHaveTextContent("Revise at ₱410,000.00 · Boss Person");
    });

    it("warns in amber that Revenue is not worked and says what is blank (A5)", async () => {
      seedPriced();
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
      const user = openDesk(deal);

      const panel = await card();
      expect(panel).toHaveTextContent("Worth finishing first");
      await user.type(within(panel).getByLabelText("Reason for the decision"), "Fine");
      await user.click(verdict(panel, "Go"));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByTestId("corridor-decision-go-unworked")).toHaveTextContent(/Planned revenue is not worked yet: .+/);
    });

    it("words an Unlock as one sentence with one full stop (C7)", async () => {
      seedPriced();
      seedDecision({ verdict: "go", cleared_at: "2026-10-16T03:00:00.000Z", cleared_reason: "Unlocked: E2E test." });
      stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
      openDesk(deal);

      const panel = await card();
      expect(within(panel).getByTestId("corridor-decision-cleared").textContent).toBe("Earlier Go was unlocked: E2E test.");
    });

    it("says in words when an earlier decision was cleared", async () => {
      seedPriced();
      seedDecision({ verdict: "go", cleared_at: "2026-10-16T03:00:00.000Z", cleared_reason: "The Final Offer changed" });
      stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
      openDesk(deal);

      const panel = await card();
      expect(panel).toHaveTextContent("No decision yet");
      expect(within(panel).getByTestId("corridor-decision-cleared")).toHaveTextContent("Earlier Go was cleared: The Final Offer changed.");
    });

    it.each(["cost", "participant"])("draws nothing of it for the %s tier", async (tier) => {
      seedPriced();
      seedDecision();
      stubCostingMatrixRpcs({ tier, bands: [] });
      openDesk(deal);

      await openLines();

      await screen.findByTestId("tender-line");
      expect(screen.queryByTestId("corridor-decision")).not.toBeInTheDocument();
    });
  });
});
