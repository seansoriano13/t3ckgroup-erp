import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders, setupUser } from "@/test/support";
import { stubRpc } from "@/test/msw/server";
import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import TechnicalSheet from "@/components/technical/TechnicalSheet";
import TechnicalVerdict from "@/components/costing/TechnicalVerdict";

/** #1035: a bulk verdict asks before it changes judged products; Complies clears an old deviation; the Specs step links to Technical. */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

describe("a careful bulk verdict on the Technical sheet", () => {
  let inCharge;
  let deal;
  let deviating;
  let fresh;

  const stored = (c) => db.internal.rowsOf("costing_components").find((r) => r.id === c.id);

  beforeEach(() => {
    inCharge = makeEmployee({ name: "Sherwin Technical", sub_department: "Technical" });
    deal = makeOpportunity({ registered_by: inCharge.id, deal_owner_id: inCharge.id });
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id, technical_incharge_id: inCharge.id, compliance: null });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Vest", quantity: 2 });
    deviating = db.seed("costing_components", {
      tender_line_id: line.id, position: 1, name: "Vest A", compliance: "deviates",
      compliance_note: "Client asks for Aramid IIIA", recommended_alternative: "Aramid IIIA vest",
    });
    fresh = db.seed("costing_components", { tender_line_id: line.id, position: 2, name: "Vest B" });
    stubRpc("costing_technical_list", () => [
      { opportunity_id: deal.id, sor_code: "SOR-9", sales_reference: "S09", project_title: "Vests", client_name: "Marikina", stage: "Bid", team: "Technical", rows_total: 2, rows_judged: 1, approved: false, is_mine: false },
    ]);
    authUser = { id: inCharge.id };
    stubCostingMatrixRpcs({ tier: "participant", bands: [], actorId: inCharge.id });
  });

  it("asks first, and 'Only the unjudged' leaves the deviation alone", async () => {
    renderWithProviders(<TechnicalSheet opportunityId={deal.id} />);
    const user = setupUser();
    await user.click(await screen.findByLabelText("Check all products"));
    await user.click(screen.getByRole("button", { name: "Complies" }));

    expect(screen.getByTestId("bulk-verdict-ask")).toHaveTextContent("1 is already judged (1 Deviates). Change it too?");
    await user.click(screen.getByRole("button", { name: "Only the unjudged" }));

    await waitFor(() => expect(stored(fresh).compliance).toBe("complies"));
    expect(stored(deviating)).toMatchObject({ compliance: "deviates", compliance_note: "Client asks for Aramid IIIA" });
  });

  it("'All checked' turns the deviation to Complies and clears its remark and alternative", async () => {
    renderWithProviders(<TechnicalSheet opportunityId={deal.id} />);
    const user = setupUser();
    await user.click(await screen.findByLabelText("Check all products"));
    await user.click(screen.getByRole("button", { name: "Complies" }));
    await user.click(screen.getByRole("button", { name: "All checked" }));

    await waitFor(() => expect(stored(deviating).compliance).toBe("complies"));
    expect(stored(deviating).compliance_note ?? null).toBeNull();
    expect(stored(deviating).recommended_alternative ?? null).toBeNull();
    expect(stored(fresh).compliance).toBe("complies");
  });
});

describe("the Specs step's way to the Technical page", () => {
  const matrix = (inCharge) => ({
    matrixId: "m1",
    matrix: { opportunity_id: "opp-1", technical_incharge_id: inCharge, compliance_note: "" },
    tenderLines: [{ components: [{ id: "c1", compliance: null }] }],
  });

  it("gives the Technical in-charge a button to the record", () => {
    renderWithProviders(
      <MemoryRouter>
        <TechnicalVerdict matrix={matrix("u1")} actorId="u1" writes={{ refresh: vi.fn() }} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("judge-products")).toHaveAttribute("href", "/technical/opp-1");
    expect(screen.getByTestId("technical-verdict-waiting")).toHaveTextContent("0 of 1 judged");
  });

  it("tells everyone else where the products are judged", () => {
    renderWithProviders(<TechnicalVerdict matrix={matrix("u1")} actorId="u2" writes={{ refresh: vi.fn() }} />);
    expect(screen.queryByTestId("judge-products")).not.toBeInTheDocument();
    expect(screen.getByTestId("judge-products-hint")).toHaveTextContent("The Technical in-charge judges the products on the Technical page.");
  });
});
