import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { renderWithProviders, setupUser, chooseOption } from "@/test/support";
import { db } from "@/test/db/store";
import { makeEmployee } from "@/test/factories";
import EvaluationSection from "./EvaluationSection";
import CostingMatrixSettings from "./CostingMatrixSettings";

/**
 * The Evaluation of Specification settings (#271): the group task template that calls Technical
 * in, and the evaluation list that approves. Super Admins change them; the database refuses
 * anyone else (proven in 82-costing-evaluation.test.js).
 */
describe("the Evaluation of Specification settings", () => {
  let boss;
  let template;

  beforeEach(() => {
    boss = makeEmployee({ name: "Purchasing Reviewer", is_super_admin: true });
    template = db.seed("group_task_templates", { name: "Evaluation of Specification", created_by: boss.id });
    db.seed("group_task_templates", { name: "Site survey", created_by: boss.id });
    db.seed("costing_evaluation_settings", { id: true });
  });

  it("shows no template chosen and nobody on the list to begin with", async () => {
    renderWithProviders(<EvaluationSection />);
    const section = await screen.findByTestId("costing-evaluation-settings");
    expect(within(section).getByText(/No template chosen/)).toBeInTheDocument();
    expect(within(section).getByText("Nobody yet.")).toBeInTheDocument();
  });

  it("saves the template that is picked", async () => {
    const user = setupUser();
    renderWithProviders(<EvaluationSection />);
    const section = await screen.findByTestId("costing-evaluation-settings");
    await chooseOption(user, within(section).getByRole("combobox"), "Evaluation of Specification");

    await waitFor(() => expect(db.rows("costing_evaluation_settings")[0].evaluation_template_id).toBe(template.id));
    expect(await within(section).findByText(/Members of a task made from this template/)).toBeInTheDocument();

    await chooseOption(user, within(section).getByRole("combobox"), "None");
    await waitFor(() => expect(db.rows("costing_evaluation_settings")[0].evaluation_template_id).toBeNull());
  });

  it("shows who is on the evaluation list", async () => {
    db.seed("costing_signer_lists", { list_key: "evaluation", employee_id: boss.id });
    db.seed("costing_signer_lists", { list_key: "final_acquire", employee_id: makeEmployee({ name: "Someone Else" }).id });
    renderWithProviders(<EvaluationSection />);
    const list = await screen.findByTestId("costing-evaluation-list");
    expect(await within(list).findByText("Purchasing Reviewer")).toBeInTheDocument();
    expect(within(list).queryByText("Someone Else")).not.toBeInTheDocument();
    expect(within(list).queryByText("Nobody yet.")).not.toBeInTheDocument();
  });

  it("sits in the S0 Evaluation settings", async () => {
    renderWithProviders(<CostingMatrixSettings isSuperAdmin />);
    expect(await screen.findByTestId("costing-matrix-settings")).toBeInTheDocument();
    expect(await screen.findByTestId("costing-evaluation-settings")).toBeInTheDocument();
  });
});
