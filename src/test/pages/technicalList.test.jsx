import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { renderWithProviders, setupUser } from "@/test/support";
import { stubRpc } from "@/test/msw/server";
import TechnicalList from "@/components/technical/TechnicalList";

/**
 * The Technical list for the Evaluation list (spec #907, decision 10). Someone who approves evaluations lands on
 * "Waiting for approval": the S0 Evaluations with a verdict and no approval yet. The in-charge keeps landing on
 * "To check". Which rows each person is sent is the database's (893-technical-list.test.js).
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

const row = (over) => ({
  opportunity_id: "o1", sor_code: "SOR-1", sales_reference: "S01", project_title: "Fire", client_name: "Marikina", stage: "Bid",
  team: "Technical", rows_total: 3, rows_judged: 0, approved: false, is_mine: false, ...over,
});

const ROWS = [
  row({ opportunity_id: "open", sor_code: "SOR-1", project_title: "Still open" }),
  row({ opportunity_id: "judged", sor_code: "SOR-2", project_title: "Verdict in", rows_judged: 3 }),
  row({ opportunity_id: "signed", sor_code: "SOR-3", project_title: "Already signed", rows_judged: 3, approved: true }),
];

describe("the Technical list", () => {
  beforeEach(() => {
    stubRpc("costing_technical_list", () => ROWS);
  });

  const mount = (user) => {
    authUser = user;
    renderWithProviders(
      <MemoryRouter>
        <TechnicalList />
      </MemoryRouter>,
    );
    return setupUser();
  };

  const selectedTab = () => screen.getByRole("tab", { selected: true });
  const shown = () => screen.queryAllByTestId("technical-row");

  it("opens a member of the Evaluation list on Waiting for approval, with only the evaluation that needs them", async () => {
    mount({ id: "e1", is_on_evaluation_list: true });
    await screen.findAllByTestId("technical-row");
    expect(selectedTab()).toHaveTextContent("Waiting for approval");
    expect(shown()).toHaveLength(1);
    expect(within(shown()[0]).getByText("Verdict in")).toBeInTheDocument();
  });

  it("lets a member of the Evaluation list look at everything else", async () => {
    const user = mount({ id: "e1", is_on_evaluation_list: true });
    await screen.findAllByTestId("technical-row");
    await user.click(screen.getByRole("tab", { name: /^All/ }));
    expect(shown()).toHaveLength(3);
  });

  it("keeps the Technical in-charge on To check, with no approval tab", async () => {
    mount({ id: "t1", is_technical_incharge: true });
    await screen.findAllByTestId("technical-row");
    expect(selectedTab()).toHaveTextContent("To check");
    expect(screen.queryByRole("tab", { name: /Waiting for approval/ })).not.toBeInTheDocument();
    expect(shown()).toHaveLength(1);
    expect(within(shown()[0]).getByText("Still open")).toBeInTheDocument();
  });

  it("opens someone who is both on To check, since the verdict is theirs to give first", async () => {
    mount({ id: "b1", is_technical_incharge: true, is_on_evaluation_list: true });
    await screen.findAllByTestId("technical-row");
    expect(selectedTab()).toHaveTextContent("To check");
    expect(screen.getByRole("tab", { name: /Waiting for approval/ })).toBeInTheDocument();
  });
});
