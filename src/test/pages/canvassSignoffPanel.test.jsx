import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { renderWithProviders, setupUser } from "@/test/support";
import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { seedCanvass, stubCanvassMoneyRpc, stubCanvassSignoffRpcs, stubCanvassWinnerRpcs } from "@/test/stubs/canvassRpc";
import { canvassService } from "@/services/canvassService";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import CostingMatrixSection from "@/components/costing/CostingMatrixSection";

/**
 * Signing a Canvass from its panel (#279): the purchasing approver sees "Sign off" once the Canvass
 * has a winner and a reason, is warned under three Offers before confirming, and the chip on the
 * Component row turns to "Signed off". The person who opened the Canvass is not offered it, and a
 * reader off the list never is. Real components and services on the fake database; the sign-off
 * functions are stubbed. The rules are the policy tier's (92-canvass-signoff.test.js).
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

describe("the sign-off on the Canvass panel", () => {
  let purchaser;
  let approver;
  let deal;
  let canvass;

  const mount = (who, { onList = true } = {}) => {
    authUser = { id: who.id };
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"], actorId: who.id });
    stubCanvassWinnerRpcs({ bands: ["purchasing"] });
    stubCanvassSignoffRpcs({ actorId: who.id, approverIds: onList ? [approver.id, purchaser.id] : [] });
    renderWithProviders(<CostingMatrixSection opportunityId={deal.id} opportunity={deal} />);
    return setupUser();
  };

  beforeEach(async () => {
    stubCanvassMoneyRpc({ money: true });
    purchaser = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true });
    approver = makeEmployee({ name: "Ana Reyes", has_purchasing_flow: true });
    db.seed("ipas_signer_lists", { list_key: "transmittal_check_by", employee_id: approver.id });
    deal = makeOpportunity({ registered_by: purchaser.id, deal_owner_id: purchaser.id, sales_reference: "S07983" });
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1 });
    const component = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Ambulance Folding Stretcher" });

    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing"], actorId: purchaser.id });
    stubCanvassWinnerRpcs({ bands: ["purchasing"] });
    stubCanvassSignoffRpcs({ actorId: purchaser.id, approverIds: [] });
    canvass = await seedCanvass({ componentId: component.id }, purchaser.id);
    const redleaf = await canvassService.addOffer(canvass.id, { supplierName: "Redleaf Inc.", brand: "Redleaf", unitPrice: 78000 }, purchaser.id);
    await canvassService.addOffer(canvass.id, { supplierName: "Ferno", brand: "Ferno", unitPrice: 82500 }, purchaser.id);
    await canvassService.markWinner(canvass.id, redleaf.id);
    await canvassService.setReason(canvass.id, "Cheapest quote that meets the load.");
  });

  it("warns under three Offers, signs, and shows the signed state on the chip", async () => {
    const user = mount(approver);
    expect(await screen.findByTestId("canvass-signed-state")).toHaveTextContent("Not signed");

    await user.click(screen.getByRole("button", { name: /Open Canvass CNV_0001/ }));
    const panel = await screen.findByTestId("canvass-signoff");
    expect(panel).toHaveTextContent("Not signed off yet.");
    await user.click(await within(panel).findByRole("button", { name: "Sign off" }));

    expect(await screen.findByTestId("signoff-warning")).toHaveTextContent("Two offers only — below the three-offer minimum");
    await user.click(screen.getByRole("button", { name: "Sign off anyway" }));

    await waitFor(() => expect(db.rows("sor_canvasses")[0].signed_off_by).toBe(approver.id));
    await waitFor(() => expect(screen.getByTestId("canvass-signed-state")).toHaveTextContent("Signed off"));
    expect(db.rows("sor_canvass_signoff_events")[0]).toMatchObject({ kind: "signed", offer_count: 2 });
  });

  it("does not offer it to the person who opened the Canvass, even on the list", async () => {
    db.seed("ipas_signer_lists", { list_key: "transmittal_check_by", employee_id: purchaser.id });
    const user = mount(purchaser);
    await user.click(await screen.findByRole("button", { name: /Open Canvass CNV_0001/ }));

    const panel = await screen.findByTestId("canvass-signoff");
    await within(panel).findByText(/You opened this Canvass/);
    expect(within(panel).queryByRole("button", { name: "Sign off" })).not.toBeInTheDocument();
  });

  it("does not offer it to someone off the list", async () => {
    const user = mount(purchaser);
    await user.click(await screen.findByRole("button", { name: /Open Canvass CNV_0001/ }));

    const panel = await screen.findByTestId("canvass-signoff");
    expect(within(panel).queryByRole("button", { name: "Sign off" })).not.toBeInTheDocument();
  });

  it("says why it came unsigned after a change", async () => {
    stubCanvassSignoffRpcs({ actorId: approver.id, approverIds: [approver.id] });
    await canvassService.sign(canvass.id);
    await canvassService.addOffer(canvass.id, { supplierName: "Hong Kong", currency: "USD", unitPrice: 1280, comparisonRate: 56.5 }, purchaser.id);

    const user = mount(purchaser);
    await user.click(await screen.findByRole("button", { name: /Open Canvass CNV_0001/ }));
    const panel = await screen.findByTestId("canvass-signoff");
    await waitFor(() => expect(panel).toHaveTextContent("It was unsigned because: an Offer was added."));
  });
});
