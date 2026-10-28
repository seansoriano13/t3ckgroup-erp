import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { db, updateRow } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { explainEmptySlots, seedCanvass, stubCanvassMoneyRpc, stubCanvassWinnerRpcs } from "@/test/stubs/canvassRpc";
import { canvassService } from "@/services/canvassService";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { renderComponentCanvass } from "@/test/support/costingDesk";

/**
 * A Canvass is not signed off (#728, ADR 0047). The panel offers no Sign off, asks no one to sign
 * and says the Canvass is ready once it has a winner and a reason. A Canvass signed off before
 * still says who signed, as read-only history. The real rules are the policy tier's
 * (728-canvass-no-signing.test.js). Real components and services on the fake database.
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

describe("the Canvass panel without a sign-off", () => {
  let purchaser;
  let approver;
  let deal;
  let canvass;
  let component;

  const mount = (who) => {
    authUser = { id: who.id };
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"], actorId: who.id });
    stubCanvassWinnerRpcs({ bands: ["purchasing"] });
    return renderComponentCanvass(deal, component, { userId: who.id });
  };

  beforeEach(async () => {
    stubCanvassMoneyRpc({ money: true });
    purchaser = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true });
    approver = makeEmployee({ name: "Ana Reyes", has_purchasing_flow: true });
    db.seed("ipas_signer_lists", { list_key: "transmittal_check_by", employee_id: approver.id });
    deal = makeOpportunity({ registered_by: purchaser.id, deal_owner_id: purchaser.id, sales_reference: "S07983" });
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1 });
    component = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Ambulance Folding Stretcher" });

    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"], actorId: purchaser.id });
    stubCanvassWinnerRpcs({ bands: ["purchasing"] });
    canvass = await seedCanvass({ componentId: component.id }, purchaser.id);
    const redleaf = await canvassService.addOffer(canvass.id, { supplierName: "Redleaf Inc.", brand: "Redleaf", unitPrice: 78000 }, purchaser.id);
    await canvassService.addOffer(canvass.id, { supplierName: "Ferno", brand: "Ferno", unitPrice: 82500 }, purchaser.id);
    explainEmptySlots(canvass.id);
    await canvassService.markWinner(canvass.id, redleaf.id);
    await canvassService.setReason(canvass.id, "Cheapest quote that meets the load.");
  });

  it("offers no Sign off to the purchaser, and says the Canvass is ready", async () => {
    mount(purchaser);
    await screen.findByText("Ready. Nothing left to do.");
    expect(screen.queryByRole("button", { name: /sign off/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("canvass-signoff")).not.toBeInTheDocument();
    expect(screen.queryByTestId("canvass-history")).not.toBeInTheDocument();
  });

  it("offers no Sign off to someone on the old approver list either", async () => {
    mount(approver);
    await screen.findByText("Ready. Nothing left to do.");
    expect(screen.queryByRole("button", { name: /sign off/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("canvass-signoff")).not.toBeInTheDocument();
  });

  it("still says who signed an old Canvass, as history", async () => {
    const row = db.internal.rowsOf("sor_canvasses").find((c) => c.id === canvass.id);
    updateRow("sor_canvasses", row, { signed_off_by: approver.id, signed_off_at: "2026-10-01T02:00:00Z" });
    const user = mount(purchaser);

    // A done step is folded away until it is opened.
    await user.click(await screen.findByRole("button", { name: /History/ }));
    const history = await screen.findByTestId("canvass-history");
    await waitFor(() => expect(within(history).getByTestId("signoff-state")).toHaveTextContent("Signed off by Ana Reyes"));
    expect(screen.queryByRole("button", { name: /sign off/i })).not.toBeInTheDocument();
  });
});
