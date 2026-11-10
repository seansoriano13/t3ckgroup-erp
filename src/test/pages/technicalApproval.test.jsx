import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { renderWithProviders, setupUser } from "@/test/support";
import { stubRpc } from "@/test/msw/server";
import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import TechnicalSheet from "@/components/technical/TechnicalSheet";

/**
 * Approving an S0 Evaluation from the Technical page (spec #907, decision 10; the Evaluation list's door).
 * Someone on the Evaluation list opens the sheet from the Technical list and approves it there, once the
 * Technical in-charge has given the verdict. The in-charge never approves their own SOR. Who may sign is the
 * database's (82-costing-evaluation.test.js); this proves the sheet offers the button to the right people.
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

describe("approving an S0 Evaluation from the Technical sheet", () => {
  let inCharge;
  let approver;
  let outsider;
  let deal;
  let matrix;

  const mount = (who, stub = {}) => {
    authUser = { id: who.id };
    stubCostingMatrixRpcs({ tier: "participant", bands: [], actorId: who.id, ...stub });
    renderWithProviders(<TechnicalSheet opportunityId={deal.id} />);
    return setupUser();
  };

  const signoffs = () => db.rows("costing_signoffs").filter((s) => s.role === "evaluation_approved");

  beforeEach(() => {
    inCharge = makeEmployee({ name: "Sherwin Technical", sub_department: "Technical" });
    approver = makeEmployee({ name: "Grace Approver" });
    outsider = makeEmployee({ name: "Nobody Special" });
    deal = makeOpportunity({ registered_by: inCharge.id, deal_owner_id: inCharge.id });
    matrix = db.seed("costing_matrices", { opportunity_id: deal.id, technical_incharge_id: inCharge.id, compliance: "complies", compliance_by: inCharge.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue tripod, 3 m", quantity: 2 });
    db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Tripod", offer_specification: "Tripod 3 m" });
    db.seed("costing_signer_lists", { list_key: "evaluation", employee_id: approver.id });
    stubRpc("costing_technical_list", () => [
      { opportunity_id: deal.id, sor_code: "SOR-9", sales_reference: "S09", project_title: "Rescue gear", client_name: "Marikina", stage: "Bid", team: "Technical", rows_total: 1, rows_judged: 1, approved: false, is_mine: false },
    ]);
  });

  it("lets someone on the Evaluation list approve it once the verdict is in", async () => {
    const user = mount(approver);
    await user.click(await screen.findByRole("button", { name: "Approve the evaluation" }));

    await waitFor(() => expect(signoffs()).toHaveLength(1));
    expect(signoffs()[0].signed_by).toBe(approver.id);
    // The sheet shows it approved without a reload.
    expect(await within(await screen.findByTestId("evaluation-approval")).findByText("Evaluation approved")).toBeInTheDocument();
  });

  it("holds the button back until the Technical in-charge has given the verdict", async () => {
    db.internal.rowsOf("costing_matrices").find((m) => m.id === matrix.id).compliance = null;
    mount(approver);
    expect(await screen.findByRole("button", { name: "Approve the evaluation" })).toBeDisabled();
    expect(screen.getByTestId("evaluation-waiting")).toHaveTextContent("The Technical verdict is not given yet.");
  });

  it("offers no button to someone who is not on the Evaluation list", async () => {
    mount(outsider);
    await screen.findByTestId("evaluation-approval");
    expect(screen.queryByRole("button", { name: "Approve the evaluation" })).not.toBeInTheDocument();
  });

  it("offers no button to the Technical in-charge, even on the list, and says someone else approves", async () => {
    db.seed("costing_signer_lists", { list_key: "evaluation", employee_id: inCharge.id });
    mount(inCharge);
    expect(await screen.findByTestId("evaluation-incharge-note")).toHaveTextContent("someone else");
    expect(screen.queryByRole("button", { name: "Approve the evaluation" })).not.toBeInTheDocument();
  });
});
