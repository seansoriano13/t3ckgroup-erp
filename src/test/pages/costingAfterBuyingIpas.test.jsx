import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { openLines, openOverview, renderCostingDesk } from "@/test/support/costingDesk";
import { COMPONENT_BANDS } from "@/constants/costing";

/**
 * Spec #955 decision 6 (#965), on the price corridor (2026-11-13): the IPAS of each line (number and state, a
 * link, a dash when none) is in the Overview's After buying table, out of the steps, since the S0 Evaluation is
 * the estimate for the Go; P.O./RFQ No. and Availability are gone from the line's detail pane and the write bands.
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

describe("the IPAS of each line, in After buying", () => {
  let reviewer;
  let deal;

  const mount = (tier = "cost") => {
    stubCostingMatrixRpcs({ tier, bands: ["purchasing"], actorId: reviewer.id });
    return renderCostingDesk(deal);
  };

  beforeEach(() => {
    reviewer = makeEmployee({ name: "Purchasing Reviewer", has_purchasing_flow: true });
    authUser = { id: reviewer.id };
    deal = makeOpportunity({ registered_by: reviewer.id, deal_owner_id: reviewer.id });
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const withIpas = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue tripod", quantity: 1 });
    const without = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 2, tender_specification: "Harness", quantity: 1 });
    db.seed("costing_components", { tender_line_id: withIpas.id, position: 1, name: "Tripod", po_rfq_no: "P02574", availability: "available" });
    db.seed("costing_components", { tender_line_id: without.id, position: 1, name: "Harness" });
    db.seed("ipas", { number: "IPAS-0042", po_number: "P02574", state: "open", purpose: "project", source: "local", priority: "high", created_by: reviewer.id, odoo_copy: { po: { name: "P02574" }, lines: [] } });
  });

  it("shows the IPAS number and state as a link, and a dash when a line has none", async () => {
    mount("closed_book");
    await openOverview();
    const table = await screen.findByTestId("after-buying");
    const rows = within(table).getAllByTestId("after-buying-line");
    expect(within(table).getByRole("columnheader", { name: "IPAS" })).toBeInTheDocument();
    const link = within(rows[0]).getByRole("link", { name: "IPAS-0042" });
    expect(link).toHaveAttribute("href", expect.stringMatching(/^\/purchasing\/ipas\/.+/));
    expect(rows[0]).toHaveTextContent(/IPAS-0042\s+\S+/);
    expect(within(rows[1]).queryByTestId("after-buying-ipas")).toBeNull();
    expect(rows[1]).toHaveTextContent("—");
  });

  it("keeps After buying out of the steps", async () => {
    mount("closed_book");
    await screen.findByRole("list", { name: "Steps" });
    expect(screen.queryByTestId("after-buying")).not.toBeInTheDocument();
  });

  it("drops P.O./RFQ No. and Availability from the line's detail pane", async () => {
    mount();
    await openLines();
    await waitFor(() => expect(screen.getAllByTestId("component").length).toBeGreaterThan(0));
    expect(screen.queryByLabelText(/^P\.O\.\/RFQ No\./)).toBeNull();
    expect(screen.queryByLabelText(/^Availability/)).toBeNull();
    expect(screen.getAllByLabelText(/^Brand/).length).toBeGreaterThan(0);
  });

  it("no longer lists the two removed columns in the screen's write bands", () => {
    expect(COMPONENT_BANDS).not.toHaveProperty("po_rfq_no");
    expect(COMPONENT_BANDS).not.toHaveProperty("availability");
    expect(COMPONENT_BANDS).toHaveProperty("brand");
    expect(COMPONENT_BANDS).toHaveProperty("source");
  });
});
