import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { closeLine, openLines, openStep, renderCostingDesk } from "@/test/support/costingDesk";

/**
 * The Evaluation of Specification on the Costing Matrix grid (#271, offer-level since #908/#909): the
 * Offer Specification beside the Tender Specification, the one Technical verdict card the Technical
 * in-charge gives, the Technical in-charge picker, the header's verdict line and the approval and its
 * button. Real components and services on the fake database; the matrix functions are stubbed. Who may
 * write a verdict is the policy tier's (82-costing-evaluation.test.js, 908-technical-incharge.test.js).
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

const VERDICT_CHOICE = "Technical verdict choice";
const REMARKS = "Technical Evaluation Remarks & Recommendations";

describe("the Evaluation of Specification on the grid", () => {
  let reviewer;
  let deal;
  let matrix;
  let line;

  // The verdict, the in-charge picker and the approval are on the Specs step; openLines moves to a line step itself.
  const mount = async (stub = {}) => {
    stubCostingMatrixRpcs({ tier: "cost", bands: ["purchasing", "technical"], actorId: reviewer.id, ...stub });
    const user = renderCostingDesk(deal);
    await openStep("Specs");
    return user;
  };

  const storedMatrix = () => db.rows("costing_matrices").find((m) => m.id === matrix.id);

  beforeEach(() => {
    reviewer = makeEmployee({ name: "Purchasing Reviewer", has_purchasing_flow: true });
    authUser = { id: reviewer.id };
    deal = makeOpportunity({ registered_by: reviewer.id, deal_owner_id: reviewer.id });
    // The reviewer is the Technical in-charge of this S0 Evaluation (#908): they alone give the verdict.
    matrix = db.seed("costing_matrices", { opportunity_id: deal.id, technical_incharge_id: reviewer.id, compliance: null, compliance_note: null });
    line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Rescue tripod, 3 m, 22 kN", quantity: 2 });
    db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Tripod", offer_specification: "Tripod 3 m, 22 kN" });
    db.seed("costing_components", { tender_line_id: line.id, position: 2, name: "Head", offer_specification: "Head, 2.5 m" });
    db.seed("costing_components", { tender_line_id: line.id, position: 3, name: "Bag" });
  });

  it("shows the Tender Specification beside each Offer Specification", async () => {
    await mount();
    await openLines();
    const rows = await screen.findAllByTestId("component");
    const specs = within(rows[0]).getByTestId("specifications");
    expect(within(specs).getByLabelText("Tender Specification 1.1")).toHaveTextContent("Rescue tripod, 3 m, 22 kN");
    expect(within(specs).getByLabelText("Offer Specification 1.1")).toHaveValue("Tripod 3 m, 22 kN");
  });

  it("shows the Technical verdict on the header, and says when it is not given yet", async () => {
    await mount();
    expect(await screen.findByTestId("matrix-compliance")).toHaveTextContent("Technical verdict not given yet");
  });

  it("shows a given Technical verdict on the header", async () => {
    db.internal.rowsOf("costing_matrices")[0].compliance = "deviates";
    db.internal.rowsOf("costing_matrices")[0].compliance_note = "Narrower";
    await mount();
    expect(await screen.findByTestId("matrix-compliance")).toHaveTextContent("Technical verdict: Deviates");
  });

  it("shows no money to a Stage Participant, who still reads the verdict", async () => {
    db.internal.rowsOf("costing_matrices")[0].compliance = "complies";
    await mount({ tier: "participant", bands: [] });
    expect(await screen.findByTestId("matrix-compliance")).toHaveTextContent("Technical verdict: Complies");
    await openLines();
    await screen.findAllByTestId("component");
    expect(screen.queryByText(/Acquire/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Final Offer/)).not.toBeInTheDocument();
  });

  it("has no per-line Compliance column and no Judged count on the sheet", async () => {
    await mount();
    await openLines();
    await screen.findAllByTestId("component");
    expect(screen.queryByTestId("sheet-compliance")).not.toBeInTheDocument();
    expect(screen.queryByText("Judged")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Compliance" })).not.toBeInTheDocument();
  });

  const judgeAll = (compliance) => {
    for (const component of db.internal.rowsOf("costing_components")) component.compliance = compliance;
  };

  it("has no verdict picker: the result follows from the products, and a deviation asks for the note", async () => {
    judgeAll("complies");
    db.internal.rowsOf("costing_components")[0].compliance = "deviates";
    db.internal.rowsOf("costing_components")[0].compliance_note = "Narrower strap";
    const user = await mount();
    expect(await screen.findByTestId("technical-verdict")).toBeInTheDocument();
    expect(screen.queryByLabelText(VERDICT_CHOICE)).not.toBeInTheDocument();
    expect(within(screen.getByTestId("technical-verdict")).getByText("Deviates")).toBeInTheDocument();
    expect(await screen.findByTestId("verdict-needs-note")).toBeInTheDocument();

    await user.type(screen.getByLabelText(REMARKS), "2.5 m, not 3 m");
    await user.tab();
    await waitFor(() => expect(storedMatrix()).toMatchObject({ compliance_note: "2.5 m, not 3 m" }));
    expect(screen.queryByTestId("verdict-needs-note")).not.toBeInTheDocument();
  });

  it("lists no missing We offers beside the verdict", async () => {
    // The fixture's "Bag" has no Offer Specification; the verdict card no longer warns about it.
    await mount();
    expect(await screen.findByTestId("technical-verdict")).toBeInTheDocument();
    expect(screen.queryByTestId("verdict-offers-missing")).not.toBeInTheDocument();
  });

  it("says to judge every product until each one has a verdict", async () => {
    await mount();
    expect(await screen.findByTestId("technical-verdict-waiting")).toHaveTextContent("Judge every product to see the result");
  });

  it("shows Complies once every product complies", async () => {
    judgeAll("complies");
    await mount();
    await waitFor(() => expect(within(screen.getByTestId("technical-verdict")).getByText("Complies")).toBeInTheDocument());
    expect(screen.queryByTestId("technical-verdict-waiting")).not.toBeInTheDocument();
  });

  it("shows the verdict and its note as text to anyone who is not the in-charge", async () => {
    judgeAll("complies");
    db.internal.rowsOf("costing_components")[0].compliance = "deviates";
    db.internal.rowsOf("costing_matrices")[0].compliance_note = "Narrower strap";
    const someoneElse = makeEmployee({ name: "Sales Person" });
    authUser = { id: someoneElse.id };
    await mount({ tier: "price", bands: ["sales"], actorId: someoneElse.id });

    const read = await screen.findByTestId("technical-verdict-read");
    expect(within(read).getByText("Deviates")).toBeInTheDocument();
    expect(within(read).getByText("Narrower strap")).toBeInTheDocument();
    expect(screen.queryByLabelText(VERDICT_CHOICE)).not.toBeInTheDocument();
  });

  it("asks for a Technical in-charge first when none is named", async () => {
    db.internal.rowsOf("costing_matrices")[0].technical_incharge_id = null;
    await mount();
    expect(await screen.findByTestId("technical-no-incharge")).toHaveTextContent("Name the Technical in-charge first.");
    expect(screen.queryByLabelText(VERDICT_CHOICE)).not.toBeInTheDocument();
  });

  // The Technical in-charge is picked under People, with the Sales and Purchasing in-charge.
  it("says no one is in Technical when the sub-department is empty", async () => {
    const user = await mount();
    await user.click(screen.getByRole("button", { name: "People" }));
    expect(await screen.findByTestId("technical-empty")).toHaveTextContent("No one in Technical. Ask HR to set the sub-department.");
  });

  it("offers the Technical in-charge picker, listing the Technical sub-department", async () => {
    makeEmployee({ name: "Tech Person", sub_department: " technical " });
    const user = await mount();
    await user.click(screen.getByRole("button", { name: "People" }));
    expect(await screen.findByLabelText("Technical in-charge")).toBeInTheDocument();
    expect(screen.queryByTestId("technical-empty")).not.toBeInTheDocument();
  });

  describe("the approval", () => {
    it("offers the button to someone on the evaluation list, disabled until the Technical verdict is given", async () => {
      // The in-charge never approves their own SOR (#911), so the approver is a different employee on the list.
      const approver = makeEmployee({ name: "Approving Reviewer", has_purchasing_flow: true });
      db.seed("costing_signer_lists", { list_key: "evaluation", employee_id: approver.id });
      authUser = { id: approver.id };
      await mount({ actorId: approver.id });
      const button = await screen.findByRole("button", { name: "Approve the evaluation" });
      expect(button).toBeDisabled();
      expect(screen.getByTestId("evaluation-waiting")).toHaveTextContent("The Technical verdict is not given yet.");
      expect(screen.getByText("Not approved")).toBeInTheDocument();
    });

    it("approves once the Technical verdict is given, and says who and when", async () => {
      db.internal.rowsOf("costing_matrices")[0].compliance = "complies";
      // The verdict's giver cannot approve it (#908), so the approver is a different employee on the list.
      const approver = makeEmployee({ name: "Approving Reviewer", has_purchasing_flow: true });
      db.seed("costing_signer_lists", { list_key: "evaluation", employee_id: approver.id });
      authUser = { id: approver.id };
      const user = await mount({ actorId: approver.id });
      await user.click(await screen.findByRole("button", { name: "Approve the evaluation" }));
      const approval = await screen.findByTestId("evaluation-approval");
      await waitFor(() => expect(within(approval).getByText("Evaluation approved")).toBeInTheDocument());
      expect(approval).toHaveTextContent("Approving Reviewer");
      expect(screen.queryByRole("button", { name: "Approve the evaluation" })).not.toBeInTheDocument();
      expect(db.rows("costing_signoffs")).toHaveLength(1);
    });

    it("has no button for someone off the list", async () => {
      await mount();
      await openLines();
      await screen.findAllByTestId("component");
      expect(screen.queryByRole("button", { name: "Approve the evaluation" })).not.toBeInTheDocument();
    });

    it("has no button for the Technical in-charge, even on the list, and says someone else approves", async () => {
      db.seed("costing_signer_lists", { list_key: "evaluation", employee_id: reviewer.id });
      db.internal.rowsOf("costing_matrices")[0].compliance = "complies";
      await mount();
      expect(await screen.findByTestId("evaluation-incharge-note")).toHaveTextContent("someone else");
      expect(screen.queryByRole("button", { name: "Approve the evaluation" })).not.toBeInTheDocument();
    });

    it("says why the approval went when a specification changes, and offers to approve again", async () => {
      const approver = makeEmployee({ name: "Approving Reviewer", has_purchasing_flow: true });
      db.seed("costing_signer_lists", { list_key: "evaluation", employee_id: approver.id });
      db.internal.rowsOf("costing_matrices")[0].compliance = "complies";
      db.seed("costing_signoffs", { matrix_id: matrix.id, role: "evaluation_approved", signed_by: approver.id });
      authUser = { id: approver.id };
      const user = await mount({ actorId: approver.id });
      expect(await screen.findByText("Evaluation approved")).toBeInTheDocument();
      await openLines();

      const rows = await screen.findAllByTestId("component");
      const offer = within(rows[1]).getByLabelText("Offer Specification 1.2");
      await user.clear(offer);
      await user.type(offer, "Head, 3 m");
      await user.tab();
      await closeLine();
      await openStep("Specs");

      expect(await screen.findByTestId("evaluation-cleared")).toHaveTextContent("The last approval was cleared: an Offer Specification changed.");
      expect(screen.getByRole("button", { name: "Approve the evaluation" })).toBeEnabled();
    });
  });
});
