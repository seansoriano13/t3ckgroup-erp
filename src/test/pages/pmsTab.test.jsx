import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import { renderWithProviders, setupUser } from "@/test/support";
import { db } from "@/test/db/store";
import { stubEdgeFunction, stubRpc } from "@/test/msw/server";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity, makeOpportunityItem } from "@/test/factories";
import OpportunityDetailsModal from "@/components/sor/OpportunityDetailsModal";

/**
 * The PMS tab of the SOR modal (#267): the Costing Matrix card (its headline numbers and the way into
 * the Costing Desk, the matrix's own record window), and the IPAS summaries (#249) and Transmittals
 * (#257) that moved here from the Summary and This stage, and the Purchase Request card (#310). The
 * matrix itself is worked in the Costing Desk (costingDesk.test.jsx). Real components and services on
 * the fake database; the matrix functions and the two section RPCs (plpgsql) are stubbed.
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

/** Where the app went: the route the "Open Costing Matrix" button navigates to renders this. */
function DeskRoute() {
  const location = useLocation();
  return <p data-testid="desk-route">{`${location.pathname} from ${location.state?.returnTo?.path ?? "nowhere"}`}</p>;
}

function openModal(deal, extraProps = {}) {
  const owner = makeEmployee();
  authUser = { id: owner.id, isSuperAdmin: true };
  stubEdgeFunction("odoo-sor-lookup", { success: true, found: true, order: { id: 1, name: "S1", state: "sale" }, customer: {}, items: [] });
  stubRpc("ipas_summaries_for_sor", [ipasSummary]);
  stubRpc("ipas_standing_for_sor", []);
  stubRpc("handoffs_for_sor", {
    transmittals: [{ id: "t-1", number: "TG03-901", prepared_on: "2026-10-15", priority: "high", state: "awaiting_check", na_count: 0, can_open: false }],
    packing_lists: [],
  });
  renderWithProviders(
    <MemoryRouter initialEntries={["/sors"]}>
      <Routes>
        <Route path="/sors" element={<OpportunityDetailsModal isOpen onClose={() => {}} opportunity={deal} {...extraProps} />} />
        <Route path="/costing-matrix/:id" element={<DeskRoute />} />
      </Routes>
    </MemoryRouter>,
  );
  return setupUser();
}

const openPms = async () => fireEvent.click(await screen.findByRole("button", { name: /^PMS/ }));

describe("the PMS tab", () => {
  let deal;

  beforeEach(() => {
    deal = makeOpportunity({ status: "QUALIFIED", sales_reference: "S06070" });
    makeOpportunityItem(deal.id, { product_name: "Fire Hose", odoo_product_id: 55, quantity: 4, unit: "pc", unit_price: 1200, sort_order: 0 });
  });

  it("shows the Costing Matrix card with its numbers, and the IPAS and Transmittal sections that moved into it", async () => {
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Fire hose, 65 mm", unit: "pc", quantity: 4 });
    db.seed("costing_tender_line_prices", { tender_line_id: line.id, abc_unit: 1500, final_offer_unit: 1600 });
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    openModal(deal);

    await openPms();

    expect(await screen.findByRole("heading", { name: /Costing Matrix/ })).toBeInTheDocument();
    const card = await screen.findByTestId("costing-matrix-card");
    // 4 x 1,500 = 6,000 and 4 x 1,600 = 6,400: 106.7% of the ABC.
    expect(card).toHaveTextContent("₱6,000.00");
    expect(card).toHaveTextContent("₱6,400.00");
    expect(card).toHaveTextContent("106.7% of the ABC");
    expect(screen.queryByTestId("tender-line")).not.toBeInTheDocument();

    // The moved sections.
    expect(await screen.findByText("TGIPAS_052")).toBeInTheDocument();
    expect(await screen.findByText("TG03-901")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Transmittals and Packing Lists/ })).toBeInTheDocument();
  });

  it("opens the Costing Desk at the matrix's own address, remembering the SOR it came from", async () => {
    db.seed("costing_matrices", { opportunity_id: deal.id });
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    const user = openModal(deal);

    await openPms();
    await user.click(await screen.findByRole("button", { name: "Open Costing Matrix" }));

    expect(await screen.findByTestId("desk-route")).toHaveTextContent(`/costing-matrix/${deal.id} from /sors`);
  });

  it("opens straight on the PMS tab when asked to, as the Costing Matrix page does (#606)", async () => {
    db.seed("costing_matrices", { opportunity_id: deal.id });
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    openModal(deal, { initialView: "pms" });

    expect(await screen.findByRole("heading", { name: /Costing Matrix/ })).toBeInTheDocument();
    expect(await screen.findByText("TGIPAS_052")).toBeInTheDocument();
  });

  it("opens on the Summary when the tab asked for does not exist", async () => {
    db.seed("costing_matrices", { opportunity_id: deal.id });
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    openModal(deal, { initialView: "no-such-tab" });

    await screen.findByRole("button", { name: /^PMS/ });
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId("costing-matrix-card")).not.toBeInTheDocument();
    expect(screen.queryByText("TGIPAS_052")).not.toBeInTheDocument();
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

  it("with no matrix shows the other sections and no card", async () => {
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    openModal(deal);

    await openPms();

    expect(await screen.findByText("TGIPAS_052")).toBeInTheDocument();
    expect(await screen.findByText("TG03-901")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Costing Matrix/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Costing Matrix" })).not.toBeInTheDocument();
  });

  it("shows a viewer with no costing tier (Finance) the PMS tab with the IPAS section and no matrix", async () => {
    db.seed("costing_matrices", { opportunity_id: deal.id });
    stubCostingMatrixRpcs({ tier: null, bands: [] });
    openModal(deal);

    await openPms();

    expect(await screen.findByText("TGIPAS_052")).toBeInTheDocument();
    expect(await screen.findByText("TG03-901")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByRole("heading", { name: /Costing Matrix/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("no-costing-matrix")).not.toBeInTheDocument();
  });

  it("says so in one plain line when the matrix has not opened", async () => {
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    openModal(deal);

    await openPms();

    expect(await screen.findByTestId("no-costing-matrix")).toHaveTextContent('No Costing Matrix yet. It opens when the flow\'s "Open Costing Matrix" step runs.');
    expect(screen.queryByRole("button", { name: "Open Costing Matrix" })).not.toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { name: /Costing Matrix/ })).toBeInTheDocument();
  });
});
