import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders, setupUser, chooseOption } from "@/test/support";
import { stubRpc } from "@/test/msw/server";
import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import TechnicalSheet from "@/components/technical/TechnicalSheet";

/**
 * Complies or Deviates and a remark per product, on the Technical sheet. Only the Technical in-charge gets the
 * controls; everyone else reads the verdict and the remark. Who may write is the database's
 * (82-costing-evaluation.test.js); this proves the sheet offers the controls to the right person and saves.
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

describe("a product's verdict and remark on the Technical sheet", () => {
  let inCharge;
  let reader;
  let deal;
  let component;

  const mount = (who) => {
    authUser = { id: who.id };
    stubCostingMatrixRpcs({ tier: "participant", bands: [], actorId: who.id });
    renderWithProviders(<TechnicalSheet opportunityId={deal.id} />);
    return setupUser();
  };

  const stored = () => db.internal.rowsOf("costing_components").find((c) => c.id === component.id);

  beforeEach(() => {
    inCharge = makeEmployee({ name: "Sherwin Technical", sub_department: "Technical" });
    reader = makeEmployee({ name: "Grace Reader" });
    deal = makeOpportunity({ registered_by: inCharge.id, deal_owner_id: inCharge.id });
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id, technical_incharge_id: inCharge.id, compliance: null });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue tripod, 3 m", quantity: 2 });
    component = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Tripod", offer_specification: "Tripod 3 m" });
    stubRpc("costing_technical_list", () => [
      { opportunity_id: deal.id, sor_code: "SOR-9", sales_reference: "S09", project_title: "Rescue gear", client_name: "Marikina", stage: "Bid", team: "Technical", rows_total: 1, rows_judged: 0, approved: false, is_mine: false },
    ]);
  });

  it("lets the in-charge mark a product Complies", async () => {
    const user = mount(inCharge);
    await chooseOption(user, await screen.findByLabelText(/^Verdict /), "Complies");
    await waitFor(() => expect(stored().compliance).toBe("complies"));
  });

  it("holds Deviates until its remark is typed, then saves both together", async () => {
    const user = mount(inCharge);
    await chooseOption(user, await screen.findByLabelText(/^Verdict /), "Deviates");

    expect(await screen.findByTestId("item-verdict-needs-note")).toBeInTheDocument();
    expect(stored().compliance ?? null).toBeNull();

    await user.type(screen.getByLabelText(/^Remark /), "Narrower strap");
    await user.tab();
    await waitFor(() => expect(stored()).toMatchObject({ compliance: "deviates", compliance_note: "Narrower strap" }));
  });

  it("sets a verdict on every checked product from the Set verdict bar, and shows the result at the bottom", async () => {
    const user = mount(inCharge);
    expect(screen.queryByTestId("bulk-verdict-bar")).not.toBeInTheDocument();
    await user.click(await screen.findByLabelText("Check all products"));
    expect(screen.getByTestId("bulk-verdict-bar")).toHaveTextContent("1 product checked");
    await user.click(screen.getByRole("button", { name: "Complies" }));
    await waitFor(() => expect(stored().compliance).toBe("complies"));
    expect(screen.queryByTestId("bulk-verdict-bar")).not.toBeInTheDocument();
  });

  it("asks for one remark when Deviates is set in bulk, and applies it to each checked product", async () => {
    const user = mount(inCharge);
    await user.click(await screen.findByLabelText(/^Check [0-9]/));
    await user.click(screen.getByRole("button", { name: "Deviates" }));
    const apply = screen.getByRole("button", { name: "Set Deviates" });
    expect(apply).toBeDisabled();
    await user.type(screen.getByLabelText("Remark for every checked product"), "Wrong size");
    await user.click(apply);
    await waitFor(() => expect(stored()).toMatchObject({ compliance: "deviates", compliance_note: "Wrong size" }));
  });

  it("offers no checkboxes to anyone but the in-charge", async () => {
    mount(reader);
    await screen.findByTestId("technical-component");
    expect(screen.queryByLabelText("Check all products")).not.toBeInTheDocument();
  });

  it("shows everyone else the verdict and the remark, with nothing to change", async () => {
    db.internal.rowsOf("costing_components").find((c) => c.id === component.id).compliance = "complies";
    db.internal.rowsOf("costing_components").find((c) => c.id === component.id).compliance_note = "Checked against the datasheet";
    mount(reader);

    expect(await screen.findByText("Checked against the datasheet")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Verdict /)).not.toBeInTheDocument();
    expect(screen.getByTestId("item-verdict")).toHaveTextContent("Complies");
  });
});
