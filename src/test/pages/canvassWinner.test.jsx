import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { seedCanvass, stubCanvassMoneyRpc, stubCanvassWinnerRpcs } from "@/test/stubs/canvassRpc";
import { canvassService } from "@/services/canvassService";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { openLines, renderComponentCanvass, renderCostingDesk } from "@/test/support/costingDesk";

/**
 * The winner on the Costing Matrix page (#278): Purchasing marks a winner in the Canvass panel (opened
 * on the Component directly, since Canvass now opens from a product line, #682) and
 * the row shows "from Canvass" on Acquire and Offer Specification; a winning brand that differs
 * from Brand shows as "Canvass says ..." with an Accept for a Deal Team member only. Real
 * components and services on the fake database; the matrix and winner functions are stubbed. The
 * rules themselves are the policy tier's (91-canvass-winner.test.js).
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

describe("a winner on the Costing Matrix page", () => {
  let purchaser;
  let deal;
  let component;
  let canvass;
  let redleaf;

  const mount = ({ tier, bands, panel = true }) => {
    stubCostingMatrixRpcs({ tier, bands, actorId: purchaser.id });
    stubCanvassWinnerRpcs({ bands });
    if (!panel) return renderCostingDesk(deal);
    return renderComponentCanvass(deal, component, { userId: purchaser.id, withDesk: true });
  };

  beforeEach(async () => {
    stubCanvassMoneyRpc({ money: true });
    purchaser = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true });
    authUser = { id: purchaser.id };
    deal = makeOpportunity({ registered_by: purchaser.id, deal_owner_id: purchaser.id, sales_reference: "S07983" });
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1 });
    component = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Ambulance Folding Stretcher", brand: "Generic" });

    canvass = await seedCanvass({ componentId: component.id }, purchaser.id);
    redleaf = await canvassService.addOffer(
      canvass.id,
      { supplierName: "Redleaf Inc.", brand: "Redleaf", description: "Folding stretcher, 227 kg", unitPrice: 78000 },
      purchaser.id,
    );
    await canvassService.addOffer(canvass.id, { supplierName: "Ferno", brand: "Ferno", unitPrice: 82500 }, purchaser.id);
  });

  it("marks a winner from the panel and shows 'from Canvass' on Acquire and Offer Specification", async () => {
    const user = mount({ tier: "cost", bands: ["purchasing"] });
    await openLines();
    await user.click(await screen.findByRole("button", { name: /Mark Redleaf Inc\. the winner/ }));

    await waitFor(() => expect(db.rows("sor_canvass_offers").find((o) => o.id === redleaf.id).is_winner).toBe(true));
    await waitFor(() => expect(screen.getAllByTestId("from-canvass")).toHaveLength(2));
    expect(db.rows("costing_component_costs")[0]).toMatchObject({ acquire_unit: 78000, acquire_from_offer_id: redleaf.id });
    // Purchasing gets the Accept too: Brand is written by Sales and Purchasing.
    expect(await screen.findByTestId("brand-proposal")).toHaveTextContent("Canvass says Redleaf");
  });

  it("un-picks the winner: no winner, sign-off cleared, values kept, and a note on the row", async () => {
    const user = mount({ tier: "cost", bands: ["purchasing"] });
    await openLines();
    await user.click(await screen.findByRole("button", { name: /Mark Redleaf Inc. the winner/ }));
    await waitFor(() => expect(screen.getAllByTestId("from-canvass")).toHaveLength(2));
    expect(screen.queryByTestId("canvass-no-winner-note")).not.toBeInTheDocument();
    db.internal.rowsOf("sor_canvasses")[0].signed_off_at = "2026-10-20T01:00:00Z";

    await user.click(await screen.findByRole("button", { name: /Clear Redleaf Inc. as the winner/ }));
    // It asks first, in a plain confirm dialog.
    await user.click(within(await screen.findByRole("dialog", { name: "Clear the winner?" })).getByRole("button", { name: "Clear winner" }));

    await waitFor(() => expect(db.rows("sor_canvass_offers").some((o) => o.is_winner)).toBe(false));
    expect(db.rows("sor_canvasses")[0].signed_off_at).toBeNull();
    // What the winner filled stays, still marked.
    expect(db.rows("costing_component_costs")[0]).toMatchObject({ acquire_unit: 78000, acquire_from_offer_id: redleaf.id });
    expect(await screen.findByTestId("no-winner-note")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("canvass-no-winner-note")).toHaveTextContent("CNV_0001"));
    expect(screen.getAllByTestId("from-canvass")).toHaveLength(2);

    // A new winner takes the note away.
    await user.click(await screen.findByRole("button", { name: /Mark Ferno the winner/ }));
    await waitFor(() => expect(screen.queryByTestId("canvass-no-winner-note")).not.toBeInTheDocument());
  });

  it("offers the winning brand with an Accept to the Deal Team", async () => {
    db.internal.rowsOf("sor_canvass_offers").find((o) => o.id === redleaf.id).is_winner = true;
    const user = mount({ tier: "price", bands: ["sales"], panel: false });
    await openLines();

    const proposal = await screen.findByTestId("brand-proposal");
    expect(proposal).toHaveTextContent("Canvass says Redleaf");

    await user.click(within(proposal).getByRole("button", { name: /Accept brand Redleaf/ }));
    await waitFor(() => expect(db.rows("costing_components")[0].brand).toBe("Redleaf"));
    await waitFor(() => expect(screen.queryByTestId("brand-proposal")).not.toBeInTheDocument());
  });

  it("shows no 'Canvass says' to anyone outside Sales and Purchasing", async () => {
    db.internal.rowsOf("sor_canvass_offers").find((o) => o.id === redleaf.id).is_winner = true;
    mount({ tier: "cost", bands: [], panel: false });
    await openLines();
    await screen.findByTestId("component");
    expect(screen.queryByTestId("brand-proposal")).not.toBeInTheDocument();
    expect(screen.queryByText(/Canvass says/)).not.toBeInTheDocument();
  });
});
