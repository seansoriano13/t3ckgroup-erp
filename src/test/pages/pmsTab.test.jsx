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
 * and This stage. Real components and services on the fake database; the matrix
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
});
