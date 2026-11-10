import { describe, it, expect, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";

import { renderWithProviders } from "@/test/support";
import { db } from "@/test/db/store";
import { makeEmployee } from "@/test/factories";
import EvaluationSection from "./EvaluationSection";
import CostingMatrixSettings from "./CostingMatrixSettings";

/**
 * The Evaluation of Specification settings (#271): the evaluation list that approves. Super Admins
 * change it; the database refuses anyone else (proven in 82-costing-evaluation.test.js). The task
 * template that used to sit beside it is retired (spec #907).
 */
describe("the Evaluation of Specification settings", () => {
  let boss;

  beforeEach(() => {
    boss = makeEmployee({ name: "Purchasing Reviewer", is_super_admin: true });
  });

  it("shows nobody on the list to begin with, and no task template to choose", async () => {
    renderWithProviders(<EvaluationSection />);
    const section = await screen.findByTestId("costing-evaluation-settings");
    expect(within(section).getByText("Nobody yet.")).toBeInTheDocument();
    expect(within(section).queryByText(/template/i)).not.toBeInTheDocument();
    expect(within(section).queryByRole("combobox")).not.toBeInTheDocument();
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
