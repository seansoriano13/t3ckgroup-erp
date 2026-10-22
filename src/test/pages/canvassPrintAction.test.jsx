import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";

import { setupUser } from "@/test/support";
import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { seedCanvass, stubCanvassMoneyRpc } from "@/test/stubs/canvassRpc";
import { canvassService } from "@/services/canvassService";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { openLines, renderCostingDesk } from "@/test/support/costingDesk";

/**
 * The Canvass print (#282) is prices on paper, so the action is offered only to a reader whose
 * Canvass carries them: a Stage Participant without the money tier gets none.
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

describe("the Canvass print action", () => {
  let purchaser;
  let deal;
  let component;

  const open = async ({ tier, bands, money }) => {
    stubCostingMatrixRpcs({ tier, bands, actorId: purchaser.id });
    stubCanvassMoneyRpc({ money });
    renderCostingDesk(deal);
    await openLines();
    const user = setupUser();
    await user.click(await screen.findByRole("button", { name: /Open Canvass CNV_0001/ }));
    await screen.findByRole("heading", { name: /^CNV_0001\s*·/ });
  };

  beforeEach(async () => {
    stubCanvassMoneyRpc({ money: true });
    purchaser = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true });
    authUser = { id: purchaser.id, name: "Marco Dizon" };
    deal = makeOpportunity({ registered_by: purchaser.id, deal_owner_id: purchaser.id, sales_reference: "S07983" });
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1 });
    component = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Ambulance Folding Stretcher" });
    const canvass = await seedCanvass({ componentId: component.id }, purchaser.id);
    await canvassService.addOffer(canvass.id, { supplierName: "Redleaf Inc.", brand: "Redleaf", unitPrice: 78000 }, purchaser.id);
  });

  it("offers Print to a reader with the money tier", async () => {
    await open({ tier: "cost", bands: ["purchasing"], money: true });
    const panel = within(await screen.findByRole("dialog"));
    await setupUser().click(await panel.findByRole("button", { name: "More" }));
    expect(await screen.findByRole("button", { name: /^Print$/ })).toBeInTheDocument();
  });

  it("offers a Stage Participant without the money tier no print action", async () => {
    await open({ tier: "participant", bands: [], money: false });
    const panel = within(await screen.findByRole("dialog"));
    expect(await panel.findAllByTestId("offer")).toHaveLength(1);
    // Nothing to hold, so More is not drawn at all.
    expect(panel.queryByRole("button", { name: "More" })).not.toBeInTheDocument();
    expect(panel.queryByRole("button", { name: /^Print$/ })).not.toBeInTheDocument();
  });
});
