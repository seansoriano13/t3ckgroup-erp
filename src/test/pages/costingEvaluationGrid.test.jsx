import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { renderWithProviders, setupUser, chooseOption } from "@/test/support";
import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import CostingMatrixSection from "@/components/costing/CostingMatrixSection";

/**
 * The Evaluation of Specification on the Costing Matrix grid (#271): the Offer Specification
 * beside the Tender Specification, a verdict with its note and alternative for the Technical band,
 * the roll-ups on each line and the header, and the approval and its button. Real components and
 * services on the fake database; the matrix functions are stubbed. Who may write a verdict is the
 * policy tier's (82-costing-evaluation.test.js).
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

describe("the Evaluation of Specification on the grid", () => {
  let reviewer;
  let deal;
  let matrix;
  let line;
  let head;

  const mount = (stub = {}) => {
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing", "technical"], actorId: reviewer.id, ...stub });
    renderWithProviders(<CostingMatrixSection opportunityId={deal.id} opportunity={deal} />);
    return setupUser();
  };

  beforeEach(() => {
    reviewer = makeEmployee({ name: "Purchasing Reviewer", has_purchasing_flow: true });
    authUser = { id: reviewer.id };
    deal = makeOpportunity({ registered_by: reviewer.id, deal_owner_id: reviewer.id });
    matrix = db.seed("costing_matrices", { opportunity_id: deal.id });
    line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue tripod, 3 m, 22 kN", quantity: 2 });
    db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Tripod", offer_specification: "Tripod 3 m, 22 kN", compliance: "complies" });
    head = db.seed("costing_components", { tender_line_id: line.id, position: 2, name: "Head", offer_specification: "Head, 2.5 m" });
    db.seed("costing_components", { tender_line_id: line.id, position: 3, name: "Bag" });
  });

  it("shows the Tender Specification beside each Offer Specification", async () => {
    mount();
    const rows = await screen.findAllByTestId("component");
    const specs = within(rows[0]).getByTestId("specifications");
    expect(within(specs).getByLabelText("Tender Specification 1.1")).toHaveTextContent("Rescue tripod, 3 m, 22 kN");
    expect(within(specs).getByLabelText("Offer Specification 1.1")).toHaveValue("Tripod 3 m, 22 kN");
  });

  it("rolls the verdicts up on the Tender Line and on the matrix header", async () => {
    db.seed("costing_components", { tender_line_id: line.id, position: 4, name: "Strap", compliance: "deviates", compliance_note: "Narrower" });
    mount();
    expect(await screen.findByTestId("line-compliance")).toHaveTextContent("1 of 4 deviate · 2 not evaluated");
    expect(screen.getByTestId("matrix-compliance")).toHaveTextContent("1 of 4 deviate · 2 not evaluated");
  });

  it("lets the Technical band mark a Component, holding a deviation for its note", async () => {
    const user = mount();
    const rows = await screen.findAllByTestId("component");
    const second = rows[1];

    await chooseOption(user, within(second).getByLabelText("Compliance 1.2"), "Deviates");
    // Nothing is saved until the note is: the database would refuse a deviation without one.
    expect(await within(second).findByTestId("compliance-needs-note")).toBeInTheDocument();
    expect(db.rows("costing_components").find((c) => c.id === head.id).compliance).toBeNull();

    await user.type(within(second).getByLabelText("Compliance note 1.2"), "2.5 m, not 3 m");
    await user.tab();
    await waitFor(() => expect(db.rows("costing_components").find((c) => c.id === head.id)).toMatchObject({ compliance: "deviates", compliance_note: "2.5 m, not 3 m" }));

    await user.type(within(second).getByLabelText("Recommended alternative 1.2"), "Head 3 m (model T3)");
    await user.tab();
    await waitFor(() => expect(db.rows("costing_components").find((c) => c.id === head.id).recommended_alternative).toBe("Head 3 m (model T3)"));
    expect(await screen.findByTestId("line-compliance")).toHaveTextContent("1 of 3 deviate · 1 not evaluated");
  });

  it("marks a Component that complies in one choice", async () => {
    const user = mount();
    const rows = await screen.findAllByTestId("component");
    await chooseOption(user, within(rows[2]).getByLabelText("Compliance 1.3"), "Complies");
    await waitFor(() => expect(db.rows("costing_components").find((c) => c.position === 3).compliance).toBe("complies"));
  });

  it("reads the verdict, note and alternative as text for someone outside the Technical band", async () => {
    db.seed("costing_components", { tender_line_id: line.id, position: 4, name: "Strap", compliance: "deviates", compliance_note: "Narrower", recommended_alternative: "Strap 50 mm" });
    mount({ tier: "price", bands: ["sales"] });
    const rows = await screen.findAllByTestId("component");
    expect(screen.queryByLabelText("Compliance 1.1")).not.toBeInTheDocument();
    expect(within(rows[0]).getByText("Complies")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Deviates")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Narrower")).toBeInTheDocument();
    expect(within(rows[3]).getByText(/Strap 50 mm/)).toBeInTheDocument();
  });

  it("shows no money to a Stage Participant, who still reads the verdicts", async () => {
    mount({ tier: "participant", bands: [] });
    await screen.findAllByTestId("component");
    expect(screen.getByTestId("matrix-compliance")).toHaveTextContent("2 not evaluated");
    expect(screen.queryByText(/Acquire/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Final Offer/)).not.toBeInTheDocument();
  });

  describe("the approval", () => {
    it("offers the button to someone on the evaluation list, disabled while a Component has no verdict", async () => {
      db.seed("costing_signer_lists", { list_key: "evaluation", employee_id: reviewer.id });
      mount();
      const button = await screen.findByRole("button", { name: "Approve the evaluation" });
      expect(button).toBeDisabled();
      expect(screen.getByTestId("evaluation-waiting")).toHaveTextContent("2 Components have no verdict yet.");
      expect(screen.getByText("Not approved")).toBeInTheDocument();
    });

    it("approves once every Component has a verdict, and says who and when", async () => {
      db.seed("costing_signer_lists", { list_key: "evaluation", employee_id: reviewer.id });
      for (const row of db.internal.rowsOf("costing_components")) row.compliance = "complies";
      const user = mount();
      await user.click(await screen.findByRole("button", { name: "Approve the evaluation" }));
      const approval = await screen.findByTestId("evaluation-approval");
      await waitFor(() => expect(within(approval).getByText("Evaluation approved")).toBeInTheDocument());
      expect(approval).toHaveTextContent("Purchasing Reviewer");
      expect(screen.queryByRole("button", { name: "Approve the evaluation" })).not.toBeInTheDocument();
      expect(db.rows("costing_signoffs")).toHaveLength(1);
    });

    it("has no button for someone off the list", async () => {
      mount();
      await screen.findAllByTestId("component");
      expect(screen.queryByRole("button", { name: "Approve the evaluation" })).not.toBeInTheDocument();
    });

    it("says why the approval went when a specification changes, and offers to approve again", async () => {
      db.seed("costing_signer_lists", { list_key: "evaluation", employee_id: reviewer.id });
      for (const row of db.internal.rowsOf("costing_components")) row.compliance = "complies";
      db.seed("costing_signoffs", { matrix_id: matrix.id, role: "evaluation_approved", signed_by: reviewer.id });
      const user = mount();
      expect(await screen.findByText("Evaluation approved")).toBeInTheDocument();

      const rows = await screen.findAllByTestId("component");
      const offer = within(rows[1]).getByLabelText("Offer Specification 1.2");
      await user.clear(offer);
      await user.type(offer, "Head, 3 m");
      await user.tab();

      expect(await screen.findByTestId("evaluation-cleared")).toHaveTextContent("The last approval was cleared: an Offer Specification changed.");
      expect(screen.getByRole("button", { name: "Approve the evaluation" })).toBeEnabled();
    });
  });
});
