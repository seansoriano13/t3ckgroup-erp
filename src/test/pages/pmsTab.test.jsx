import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithProviders, setupUser } from "@/test/support";
import { db } from "@/test/db/store";
import { pgrstError } from "@/test/db/schema";
import { stubEdgeFunction, stubRpc } from "@/test/msw/server";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity, makeOpportunityItem } from "@/test/factories";
import OpportunityDetailsModal from "@/components/sor/OpportunityDetailsModal";

/**
 * The PMS tab of the SOR modal (#267): the Costing Matrix's Tender Lines, and the
 * IPAS summaries (#249) and Transmittals (#257) that moved here from the Summary
 * and This stage; with #268, the Components, bundles, Inclusions and cost-only
 * rows, and the Purchase Request card (#310). Real components and services on the fake database; the matrix
 * functions and the two section RPCs (plpgsql) are stubbed. Who may read or
 * write what is the policy tier's (78-costing-tender-lines).
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

const ipasSummary = {
  ipas_id: "ipas-1",
  number: "TGIPAS_052",
  po_number: "P05123",
  supplier: "Scorpe Technologies",
  purpose: "project",
  state: "open",
  buyer_track: [{ key: "purchase_order", ticked: true, partial: false }],
  computation_status: "encoded",
  signoffs: { 1: { prepared: true, approved: false }, 3: { prepared: false, approved: false }, 7: { received: false, noted: false, checked: false, approved: false } },
};

function openModal(deal) {
  const owner = makeEmployee();
  authUser = { id: owner.id, isSuperAdmin: true };
  stubEdgeFunction("odoo-sor-lookup", { success: true, found: true, order: { id: 1, name: "S1", state: "sale" }, customer: {}, items: [] });
  stubRpc("ipas_summaries_for_sor", [ipasSummary]);
  stubRpc("ipas_standing_for_sor", []);
  stubRpc("handoffs_for_sor", {
    transmittals: [{ id: "t-1", number: "TG03-901", prepared_on: "2026-10-15", priority: "high", state: "awaiting_check", na_count: 0, can_open: false }],
    packing_lists: [],
  });
  renderWithProviders(<OpportunityDetailsModal isOpen onClose={() => {}} opportunity={deal} />);
  return setupUser();
}

const openPms = async () => fireEvent.click(await screen.findByRole("button", { name: /^PMS/ }));

describe("the PMS tab", () => {
  let deal;

  beforeEach(() => {
    deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S06070" });
    makeOpportunityItem(deal.id, { product_name: "Fire Hose", odoo_product_id: 55, quantity: 4, unit: "pc", unit_price: 1200, sort_order: 0 });
  });

  it("shows the matrix and the IPAS and Transmittal sections that moved into it", async () => {
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Fire hose, 65 mm", unit: "pc", quantity: 4 });
    db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: 1500, final_offer_unit: 1600 });
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    openModal(deal);

    await openPms();

    expect(await screen.findByRole("heading", { name: /Costing Matrix/ })).toBeInTheDocument();
    const row = await screen.findByTestId("tender-line");
    expect(within(row).getByLabelText("Tender Specification 1")).toHaveValue("Fire hose, 65 mm");
    expect(within(row).getByLabelText("ABC 1")).toHaveValue(1500);
    expect(within(row).getByLabelText("Final Offer 1")).toHaveValue(1600);
    // 4 x 1,500 = 6,000 and 4 x 1,600 = 6,400, so the offer is above the ABC.
    expect(within(row).getByText("₱6,000.00")).toBeInTheDocument();
    expect(within(row).getByText("₱6,400.00")).toBeInTheDocument();
    expect(within(row).getByText("Over ABC")).toBeInTheDocument();
    expect(screen.getByTestId("abc-percent")).toHaveTextContent("106.7%");

    // The moved sections.
    expect(await screen.findByText("TGIPAS_052")).toBeInTheDocument();
    expect(await screen.findByText("TG03-901")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Transmittals and Packing Lists/ })).toBeInTheDocument();
  });

  it("no longer shows the IPAS and Transmittal sections on the Summary or This stage", async () => {
    db.seed("costing_matrices", { opportunity_id: deal.id });
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    openModal(deal);

    await screen.findByRole("button", { name: /^PMS/ });
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText("TGIPAS_052")).not.toBeInTheDocument();
    expect(screen.queryByText("TG03-901")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^This stage/ }));
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText("TGIPAS_052")).not.toBeInTheDocument();
  });

  it("with no matrix shows the other sections and no grid", async () => {
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    openModal(deal);

    await openPms();

    expect(await screen.findByText("TGIPAS_052")).toBeInTheDocument();
    expect(await screen.findByText("TG03-901")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Costing Matrix/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/No Tender Lines yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Tender Line/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("tender-line")).not.toBeInTheDocument();
  });

  it("shows no PMS tab to someone with no costing tier", async () => {
    db.seed("costing_matrices", { opportunity_id: deal.id });
    stubCostingMatrixRpcs({ tier: null, bands: [] });
    openModal(deal);

    await screen.findByRole("button", { name: /^This stage/ });
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByRole("button", { name: /^PMS/ })).not.toBeInTheDocument();
  });

  it("gives a Stage Participant the Tender Lines read-only, with no money columns", async () => {
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Fire hose, 65 mm", unit: "pc", quantity: 4 });
    db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: 1500, final_offer_unit: 1600 });
    stubCostingMatrixRpcs({ tier: "participant", bands: [] });
    openModal(deal);

    await openPms();

    const row = await screen.findByTestId("tender-line");
    expect(within(row).getByText("Fire hose, 65 mm")).toBeInTheDocument();
    expect(within(row).queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/ABC/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Final Offer/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Tender Line/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove Tender Line/ })).not.toBeInTheDocument();
  });

  it("makes cells outside the viewer's band read-only while Purchasing still sees the ABC", async () => {
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Fire hose, 65 mm", unit: "pc", quantity: 4 });
    db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: 1500, final_offer_unit: 1600 });
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });
    openModal(deal);

    await openPms();

    const row = await screen.findByTestId("tender-line");
    expect(within(row).getByText("Fire hose, 65 mm")).toBeInTheDocument();
    expect(within(row).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(row).getByText("₱1,500.00", { selector: "span[aria-label=\"ABC 1\"]" })).toBeInTheDocument();
    expect(screen.queryByText(/Final Offer/)).not.toBeInTheDocument();
  });

  it("adds a Tender Line, picks one from an SOR line, and saves a typed Final Offer", async () => {
    db.seed("costing_matrices", { opportunity_id: deal.id });
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    const user = openModal(deal);

    await openPms();
    expect(await screen.findByText(/No Tender Lines yet/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Add Tender Line/ }));
    const typed = await screen.findByTestId("tender-line");
    await user.type(within(typed).getByLabelText("Tender Specification 1"), "Rescue tripod");
    await user.tab();
    await waitFor(() => expect(db.rows("costing_tender_lines")[0].tender_specification).toBe("Rescue tripod"));

    await user.click(screen.getByRole("button", { name: /Pick from an SOR line/ }));
    await user.click(await screen.findByRole("button", { name: "Add as Tender Line" }));
    await waitFor(() => expect(screen.getAllByTestId("tender-line")).toHaveLength(2));
    const picked = screen.getAllByTestId("tender-line")[1];
    expect(within(picked).getByLabelText("Tender Specification 2")).toHaveValue("Fire Hose");
    expect(within(picked).getByText("From an SOR line")).toBeInTheDocument();

    await user.type(within(picked).getByLabelText("Final Offer 2"), "1300");
    await user.tab();
    await waitFor(() => expect(db.rows("costing_tender_line_prices").find((p) => p.final_offer_unit === 1300)).toBeTruthy());
    expect(await within(screen.getAllByTestId("tender-line")[1]).findByText("₱5,200.00")).toBeInTheDocument();
    // The quotation's price shows beside the Final Offer when they differ.
    expect(within(screen.getAllByTestId("tender-line")[1]).getByTestId("quotation-price")).toHaveTextContent("Quotation ₱1,200.00");
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
    openModal(deal);

    await openPms();

    expect(await screen.findByText("SOR line now says 4 pc")).toBeInTheDocument();
  });

  it("shows a band refusal beside the cell it refused", async () => {
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Fire hose", unit: "pc", quantity: 4 });
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    stubRpc("costing_set_money", () => {
      throw pgrstError("42501", "costing_band:costing_tender_line_prices.final_offer_unit:sales", { status: 403 });
    });
    const user = openModal(deal);

    await openPms();
    const row = await screen.findByTestId("tender-line");
    await user.type(within(row).getByLabelText("Final Offer 1"), "900");
    await user.tab();

    expect(await within(row).findByRole("alert")).toHaveTextContent("Final Offer is written by Sales (the Deal Team).");
  });

  it("says so in one plain line when the matrix has not opened, with no grid", async () => {
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    openModal(deal);

    await openPms();

    expect(await screen.findByTestId("no-costing-matrix")).toHaveTextContent('No Costing Matrix yet. It opens when the flow\'s "Open Costing Matrix" step runs.');
    expect(screen.queryByTestId("tender-line")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Component/ })).not.toBeInTheDocument();
  });

  it("shows the Purchase Request card on the PMS tab, under the matrix", async () => {
    db.seed("costing_matrices", { opportunity_id: deal.id });
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });
    stubRpc("sor_purchase_request_overview", [
      {
        request_id: "req-1",
        buyer_id: "emp-b",
        buyer_name: "Bea Buyer",
        buyer_avatar_path: null,
        opened_visit_id: null,
        created_at: "2026-01-01T00:00:00Z",
        items: [{ id: "i1", name: "Hose", odoo_product_id: null, quantity: 1, unit: null, status: "requested", source: "sor_line", created_at: "2026-01-02T00:00:00Z" }],
      },
    ]);
    openModal(deal);

    await openPms();

    expect(await screen.findByText("Buyer: Bea Buyer")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Costing Matrix/ })).toBeInTheDocument();
  });

  describe("Components, bundles, Inclusions and cost-only rows (#268)", () => {
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
      openModal(deal);

      await openPms();

      const block = await screen.findByTestId("components");
      const rows = within(block).getAllByTestId("component");
      expect(rows).toHaveLength(2);
      expect(within(rows[0]).getByText("1.1")).toBeInTheDocument();
      expect(within(rows[1]).getByText("1.2")).toBeInTheDocument();
      expect(within(rows[0]).getByLabelText("Component name 1.1")).toHaveValue("4x4 pick-up");
      expect(within(rows[0]).getByLabelText("Offer Specification 1.1")).toHaveValue("Double cab, 13-line specification");
      expect(within(rows[0]).getByLabelText("Brand 1.1")).toHaveValue("Toyota");
      expect(within(rows[0]).getByLabelText("P.O./RFQ No. 1.1")).toHaveValue("RFQ-2231");
      expect(within(rows[0]).getByLabelText("Acquire 1.1")).toHaveValue(2160500);
      expect(within(rows[0]).getByLabelText("Odoo unit cost 1.1")).toHaveValue(2200000);
      // The bundle at 1 x 2,160,500 totals 2,160,500, never 0.00; the part with no Acquire shows a dash.
      expect(within(rows[0]).getByText("₱2,160,500.00")).toBeInTheDocument();
      expect(within(rows[1]).getByText("₱120,000.00")).toBeInTheDocument();
      const totals = within(block).getByTestId("component-totals");
      expect(within(totals).getByText("₱2,320,000.00")).toBeInTheDocument();
      expect(within(totals).getByText("1 without Acquire")).toBeInTheDocument();
      expect(within(totals).getAllByText("—").length).toBeGreaterThan(0);

      // The owner-band header: whose columns are whose.
      const headers = within(block).getAllByRole("columnheader").map((h) => h.textContent);
      expect(headers).toEqual(expect.arrayContaining(["Sales", "PMS", "Brand", "P.O./RFQ No.", "Acquire / unit", "Odoo / unit"]));
    });

    it("makes a Sales viewer's Purchasing columns read-only and shows no Acquire column at the price tier", async () => {
      seedComponents();
      stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
      openModal(deal);

      await openPms();

      const block = await screen.findByTestId("components");
      const row = within(block).getAllByTestId("component")[0];
      // Sales writes Brand and the Odoo unit cost.
      expect(within(row).getByLabelText("Brand 1.1")).toHaveValue("Toyota");
      expect(within(row).getByLabelText("Odoo unit cost 1.1")).toHaveValue(2200000);
      // Purchasing's columns read as text.
      expect(within(row).getByLabelText("Offer Specification 1.1").tagName).toBe("SPAN");
      expect(within(row).getByLabelText("P.O./RFQ No. 1.1").tagName).toBe("SPAN");
      expect(within(row).getByLabelText("Availability 1.1")).toHaveTextContent("For Order");
      expect(within(row).getByLabelText("Source 1.1")).toHaveTextContent("Import");
      // No Acquire, no Final Acquire, no factor: not hidden, absent.
      expect(within(block).queryByLabelText("Acquire 1.1")).not.toBeInTheDocument();
      expect(within(block).queryByText(/Acquire/)).not.toBeInTheDocument();
      expect(within(block).queryByText(/Final Acquire|markup/i)).not.toBeInTheDocument();
    });

    it("makes a Purchasing viewer's Sales columns read-only and keeps their own Acquire and Offer Specification editable", async () => {
      seedComponents();
      stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing", "technical"] });
      openModal(deal);

      await openPms();

      const row = within(await screen.findByTestId("components")).getAllByTestId("component")[0];
      expect(within(row).getByLabelText("Brand 1.1").tagName).toBe("SPAN");
      expect(within(row).getByLabelText("Odoo unit cost 1.1").tagName).toBe("SPAN");
      expect(within(row).getByLabelText("Acquire 1.1")).toHaveValue(2160500);
      expect(within(row).getByLabelText("Offer Specification 1.1")).toHaveValue("Double cab, 13-line specification");
    });

    it("gives a Stage Participant the Components read-only with no money columns and no add or remove", async () => {
      seedComponents();
      db.seed("costing_cost_rows", { matrix_id: matrix.id, position: 1, description: "Delivery Charge", quantity: 1, acquire_unit: 100000 });
      stubCostingMatrixRpcs({ tier: "participant", bands: [] });
      openModal(deal);

      await openPms();

      const block = await screen.findByTestId("components");
      const row = within(block).getAllByTestId("component")[0];
      expect(within(row).getByText("4x4 pick-up")).toBeInTheDocument();
      expect(within(row).getByText("Toyota")).toBeInTheDocument();
      expect(within(block).queryByRole("textbox")).not.toBeInTheDocument();
      expect(within(block).queryByText(/Acquire|Odoo (\/ unit|total|unit)/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add Component|Add cost-only row|Add Inclusion/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Remove (Component|cost-only|Inclusion)/ })).not.toBeInTheDocument();
      // The cost-only row is there by description, with no figure.
      const costRows = screen.getByTestId("cost-rows");
      expect(within(costRows).getByText("Delivery Charge")).toBeInTheDocument();
      expect(within(costRows).queryByText(/100,000/)).not.toBeInTheDocument();
    });

    it("lists a bundle's Inclusions under their headings, collapsible, with the covered count", async () => {
      seedComponents();
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "technical"] });
      const user = openModal(deal);

      await openPms();

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
      openModal(deal);

      await openPms();

      const inclusions = await screen.findByTestId("inclusions");
      expect(within(inclusions).getByLabelText("Completeness 1.1.1").tagName).toBe("SPAN");
      // Sales still edits what the Inclusion says.
      expect(within(inclusions).getByLabelText("Inclusion 1.1.1 description")).toHaveValue("Roll bar");
    });

    it("adds a Component, types its name, and adds an Inclusion under a bundle", async () => {
      matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
      line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue vehicle", unit: "unit", quantity: 1 });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "technical"] });
      const user = openModal(deal);

      await openPms();
      await user.click(await screen.findByRole("button", { name: /Add Component/ }));

      const row = await screen.findByTestId("component");
      await user.type(within(row).getByLabelText("Component name 1.1"), "Winch");
      await user.tab();
      await waitFor(() => expect(db.rows("costing_components")[0].name).toBe("Winch"));

      await user.type(within(row).getByLabelText("Acquire 1.1"), "52000");
      await user.tab();
      await waitFor(() => expect(db.rows("costing_component_costs")[0].acquire_unit).toBe(52000));
      expect(await within(screen.getByTestId("components")).findByTestId("component-totals")).toBeInTheDocument();

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
      const user = openModal(deal);

      await openPms();
      const row = within(await screen.findByTestId("components")).getAllByTestId("component")[0];
      const acquire = within(row).getByLabelText("Acquire 1.1");
      await user.clear(acquire);
      await user.type(acquire, "1");
      await user.tab();

      expect(await within(row).findByRole("alert")).toHaveTextContent("Acquire is written by Purchasing.");
    });

    it("adds a cost-only row beneath the Tender Lines, kept out of the Components total", async () => {
      seedComponents();
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing"] });
      const user = openModal(deal);

      await openPms();
      await user.click(await screen.findByRole("button", { name: /Add cost-only row/ }));

      const row = await screen.findByTestId("cost-row");
      await user.type(within(row).getByLabelText("Cost-only row 1 description"), "Delivery Charge");
      await user.tab();
      await waitFor(() => expect(db.rows("costing_cost_rows")[0].description).toBe("Delivery Charge"));
      await user.type(within(row).getByLabelText("Cost-only row 1 Acquire"), "100000");
      await user.tab();
      await waitFor(() => expect(db.rows("costing_cost_rows")[0].acquire_unit).toBe(100000));

      const costRows = screen.getByTestId("cost-rows");
      expect(await within(costRows).findByTestId("cost-row-totals")).toHaveTextContent("₱100,000.00");
      // The Tender Line's Components total did not move.
      expect(within(screen.getByTestId("component-totals")).queryByText("₱2,260,500.00")).not.toBeInTheDocument();
      expect(within(screen.getByTestId("component-totals")).getByText("₱2,320,000.00")).toBeInTheDocument();
    });

    it("names the matrix's Sales and Purchasing incharge, held to the viewer's band", async () => {
      const sales = makeEmployee({ name: "Sandy Sales" });
      const buyer = makeEmployee({ name: "Bea Buyer", has_purchasing_flow: true });
      deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S06071", deal_owner_id: sales.id });
      matrix = db.seed("costing_matrices", { opportunity_id: deal.id, sales_incharge_id: sales.id, purchasing_incharge_id: buyer.id });
      stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"] });
      openModal(deal);

      await openPms();

      // Purchasing reads the Sales incharge as a name and may change its own.
      expect(await screen.findByLabelText("Sales incharge")).toHaveTextContent("Sandy Sales");
      expect(screen.getByLabelText("Sales incharge").tagName).toBe("SPAN");
      expect(screen.getByLabelText("Purchasing incharge").tagName).not.toBe("SPAN");
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
        item("ordered");
        item("requested");
      }

      it.each(["closed_book", "cost", "price", "participant"])("shows a Component its Requested Items' statuses at the %s tier", async (tier) => {
        seedRequestedItems();
        stubCostingMatrixRpcs({ tier, bands: [] });
        openModal(deal);

        await openPms();

        const block = await screen.findByTestId("components");
        const [vehicleRow, winchRow] = within(block).getAllByTestId("component");
        const requests = await within(vehicleRow).findByTestId("component-requests");
        expect(within(requests).getByText("Ordered")).toBeInTheDocument();
        expect(within(requests).getByText("Requested")).toBeInTheDocument();
        // Only the status: no name, quantity or requester comes with it.
        expect(requests).not.toHaveTextContent("Bea Buyer");
        expect(within(winchRow).queryByTestId("component-requests")).not.toBeInTheDocument();
      });

      it("shows nothing under a Component nobody has requested", async () => {
        seedComponents();
        stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
        openModal(deal);

        await openPms();

        await screen.findByTestId("components");
        expect(screen.queryByTestId("component-requests")).not.toBeInTheDocument();
      });
    });
  });

  describe("the summary and Final Acquire (#270)", () => {
    let matrix;
    let component;

    // One Tender Line at a Final Offer of 2,980,000 against an ABC of 3,200,000, with one Component.
    function seedSummary({ finalAcquire = null, extraLine = false } = {}) {
      matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
      db.seed("costing_settings", { id: 1 });
      const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue vehicle", unit: "unit", quantity: 1 });
      db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: 3200000, final_offer_unit: 2980000 });
      if (extraLine) {
        const second = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 2, tender_specification: "Spare kit", unit: "set", quantity: 1 });
        db.seed("costing_tender_line_prices", { tender_line_id: second.id, abc_unit: 100 });
      }
      component = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "4x4 pick-up", quantity: 1, unit: "unit" });
      db.seed("costing_component_costs", { component_id: component.id, acquire_unit: 2300000, final_acquire_unit: finalAcquire });
    }

    it("renders the incomplete summary in words while a Component has no Final Acquire", async () => {
      seedSummary();
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "management", "finance"] });
      openModal(deal);

      await openPms();

      const summary = await screen.findByTestId("costing-summary");
      expect(within(summary).getByTestId("summary-revenue")).toHaveTextContent("Incomplete — 1 row has no cost");
      expect(within(summary).getByTestId("summary-opex-total")).toHaveTextContent("Incomplete — 1 row has no cost");
      // The offer figures still work, to the centavo.
      expect(within(summary).getByTestId("summary-final-offer")).toHaveTextContent("₱2,980,000.00");
      expect(within(summary).getByTestId("summary-vat")).toHaveTextContent("₱2,660,714.29");
      expect(within(summary).getByTestId("summary-tax")).toHaveTextContent("₱178,800.00");
      expect(within(summary).getByTestId("summary-retention")).toHaveTextContent("₱29,800.00");
      expect(within(summary).getByTestId("summary-collected")).toHaveTextContent("₱2,771,400.00");
      expect(within(summary).getByTestId("summary-itr")).toHaveTextContent("₱218,400.00");
    });

    it("shows Revenue and the ABC gauge once every cost is in (#229 sample)", async () => {
      seedSummary({ finalAcquire: 2338500 });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "management", "finance"] });
      openModal(deal);

      await openPms();

      const summary = await screen.findByTestId("costing-summary");
      expect(within(summary).getByTestId("summary-opex-total")).toHaveTextContent("₱2,338,500.00");
      expect(within(summary).getByTestId("summary-revenue")).toHaveTextContent("₱423,100.00");
      expect(within(summary).queryByText(/Incomplete/)).not.toBeInTheDocument();
      expect(screen.getByTestId("abc-percent")).toHaveTextContent("93.1%");
    });

    it("marks the offer figures incomplete while a Tender Line has no Final Offer", async () => {
      seedSummary({ finalAcquire: 2338500, extraLine: true });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "management", "finance"] });
      openModal(deal);

      await openPms();

      const summary = await screen.findByTestId("costing-summary");
      for (const id of ["summary-final-offer", "summary-vat", "summary-tax", "summary-retention", "summary-collected", "summary-itr", "summary-revenue"]) {
        expect(within(summary).getByTestId(id), id).toHaveTextContent("Incomplete — 1 tender line has no Final Offer");
      }
    });

    it("lets the Final Acquire list type Final Acquire and Marketing, and the summary follows", async () => {
      seedSummary();
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "management", "finance"] });
      const user = openModal(deal);

      await openPms();
      const row = await screen.findByTestId("component");
      await user.type(within(row).getByLabelText("Final Acquire 1.1"), "2338500");
      await user.tab();
      await waitFor(() => expect(screen.getByTestId("summary-revenue")).toHaveTextContent("₱423,100.00"));
      expect(db.rows("costing_component_costs")[0].final_acquire_unit).toBe(2338500);

      await user.type(within(screen.getByTestId("summary-marketing")).getByLabelText("Marketing"), "12000");
      await user.tab();
      await waitFor(() => expect(db.rows("costing_matrix_money")[0]?.marketing).toBe(12000));
    });

    it("makes Final Acquire, Marketing and OPEX read-only for a Super Admin off the list", async () => {
      seedSummary({ finalAcquire: 2338500 });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing"] });
      openModal(deal);

      await openPms();

      const row = await screen.findByTestId("component");
      expect(within(row).getByLabelText("Final Acquire 1.1")).toHaveTextContent("₱2,338,500.00");
      expect(within(row).getByLabelText("Final Acquire 1.1").tagName).toBe("SPAN");
      expect(within(screen.getByTestId("summary-marketing")).getByLabelText("Marketing").tagName).toBe("SPAN");
      expect(within(screen.getByTestId("summary-opex")).getByLabelText("OPEX").tagName).toBe("SPAN");
    });

    it("shows a refused Final Acquire beside its cell", async () => {
      seedSummary();
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "management"] });
      const user = openModal(deal);
      await openPms();
      const row = await screen.findByTestId("component");
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing"] });

      await user.type(within(row).getByLabelText("Final Acquire 1.1"), "5");
      await user.tab();

      expect(await within(row).findByRole("alert")).toHaveTextContent("Final Acquire is written by the Final Acquire list.");
    });

    it("types a cost-only row's Final Acquire in the MNGT columns", async () => {
      seedSummary({ finalAcquire: 100 });
      const costRow = db.seed("costing_cost_rows", { matrix_id: matrix.id, position: 1, description: "Delivery Charge", quantity: 1 });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "purchasing", "management"] });
      const user = openModal(deal);

      await openPms();
      const rows = await screen.findByTestId("cost-rows");
      expect(within(rows).getAllByText("MNGT").length).toBeGreaterThan(0);
      await user.type(within(rows).getByLabelText("Cost-only row 1 Final Acquire"), "2500");
      await user.tab();

      await waitFor(() => expect(db.rows("costing_cost_rows").find((r) => r.id === costRow.id).final_acquire_unit).toBe(2500));
      // (2,980,000 - 2,600) - ITR of 218,400
      await waitFor(() => expect(screen.getByTestId("summary-revenue")).toHaveTextContent("₱2,759,000.00"));
    });

    it.each([
      ["price", ["sales"]],
      ["cost", ["purchasing"]],
      ["participant", []],
    ])("gives the %s tier no summary and no Final Acquire column", async (tier, bands) => {
      seedSummary({ finalAcquire: 2338500 });
      stubCostingMatrixRpcs({ tier, bands });
      openModal(deal);

      await openPms();

      await screen.findByTestId("component");
      expect(screen.queryByTestId("costing-summary")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Final Acquire 1.1")).not.toBeInTheDocument();
      expect(screen.queryByText("MNGT")).not.toBeInTheDocument();
      expect(screen.queryByText(/Incomplete/)).not.toBeInTheDocument();
    });
  });

  describe("the Bid Decision (#320)", () => {
    let matrix;
    let decider;

    // One Tender Line at a Final Offer of 2,980,000 against an ABC of 3,200,000.
    function seedPriced({ offer = 2980000 } = {}) {
      matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
      db.seed("costing_settings", { id: 1 });
      const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue vehicle", unit: "unit", quantity: 1 });
      db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: 3200000, final_offer_unit: offer });
      decider = makeEmployee({ name: "Boss Person" });
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

    it("shows the Final Acquire list the decision with the figures it was taken against, and the controls", async () => {
      seedPriced();
      seedDecision({ verdict: "go", reason: "Fits the budget" });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
      openModal(deal);

      await openPms();

      const panel = await screen.findByTestId("bid-decision");
      expect(within(panel).getByTestId("bid-decision-live")).toHaveTextContent("Go");
      expect(within(panel).getByTestId("bid-decision-reason")).toHaveTextContent("Fits the budget");
      expect(within(panel).getByTestId("bid-decision-live")).toHaveTextContent("Boss Person");
      expect(within(panel).getByTestId("bid-decision-figures")).toHaveTextContent("Final Offer of ₱2,980,000.00 and an ABC of ₱3,200,000.00");
      expect(within(panel).getByRole("button", { name: "Go" })).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: "Revise" })).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: "No-go" })).toBeInTheDocument();
    });

    it("takes a decision: the reason is needed, then the buttons record it at the summary", async () => {
      seedPriced();
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
      const user = openModal(deal);

      await openPms();

      const panel = await screen.findByTestId("bid-decision");
      expect(within(panel).getByTestId("bid-decision-none")).toHaveTextContent("No decision yet.");
      expect(within(panel).getByRole("button", { name: "Go" })).toBeDisabled();

      await user.type(within(panel).getByLabelText("Reason for the decision"), "Price fits and margin is fine");
      await user.click(within(panel).getByRole("button", { name: "Go" }));

      await waitFor(() => expect(within(screen.getByTestId("bid-decision")).getByTestId("bid-decision-live")).toHaveTextContent("Go"));
      expect(screen.getByTestId("bid-decision-reason")).toHaveTextContent("Price fits and margin is fine");
      expect(screen.getByTestId("bid-decision-figures")).toHaveTextContent("₱2,980,000.00");
      const [row] = db.rows("costing_bid_decisions");
      expect(row).toMatchObject({ verdict: "go", reason: "Price fits and margin is fine", final_offer_total: 2980000, abc_total: 3200000 });
    });

    it("keeps the controls off while a Tender Line has no Final Offer", async () => {
      seedPriced({ offer: null });
      stubCostingMatrixRpcs({ tier: "closed_book", bands: ["sales", "management"] });
      openModal(deal);

      await openPms();

      const panel = await screen.findByTestId("bid-decision");
      expect(within(panel).getByTestId("bid-decision-none")).toHaveTextContent("once every Tender Line has a Final Offer");
      expect(within(panel).getByLabelText("Reason for the decision")).toBeDisabled();
      expect(within(panel).getByRole("button", { name: "No-go" })).toBeDisabled();
    });

    it("shows the Deal Team the verdict and the reason and no figure and no controls", async () => {
      seedPriced();
      seedDecision();
      stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
      openModal(deal);

      await openPms();

      const panel = await screen.findByTestId("bid-decision");
      expect(within(panel).getByTestId("bid-decision-live")).toHaveTextContent("No-go");
      expect(within(panel).getByTestId("bid-decision-reason")).toHaveTextContent("Offer is far over the ABC and we cannot get there");
      expect(within(panel).queryByTestId("bid-decision-figures")).not.toBeInTheDocument();
      expect(panel).not.toHaveTextContent("3,200,000");
      expect(within(panel).queryByRole("button", { name: "Go" })).not.toBeInTheDocument();
      expect(within(panel).queryByLabelText("Reason for the decision")).not.toBeInTheDocument();
    });

    it("says in words when an earlier decision was cleared", async () => {
      seedPriced();
      seedDecision({ verdict: "go", cleared_at: "2026-10-16T03:00:00.000Z", cleared_reason: "The Final Offer changed" });
      stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
      openModal(deal);

      await openPms();

      const panel = await screen.findByTestId("bid-decision");
      expect(within(panel).getByTestId("bid-decision-none")).toBeInTheDocument();
      expect(within(panel).getByTestId("bid-decision-cleared")).toHaveTextContent("The earlier decision (Go) was cleared: The Final Offer changed.");
    });

    it.each(["cost", "participant"])("draws nothing of it for the %s tier", async (tier) => {
      seedPriced();
      seedDecision();
      stubCostingMatrixRpcs({ tier, bands: [] });
      openModal(deal);

      await openPms();

      await screen.findByTestId("tender-line");
      expect(screen.queryByTestId("bid-decision")).not.toBeInTheDocument();
    });
  });
});
