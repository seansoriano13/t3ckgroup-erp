import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { screen, waitFor } from "@testing-library/react";

import { db } from "@/test/db/store";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { makeEmployee } from "@/test/factories";
import { renderWithProviders } from "@/test/support";
import CostingDesk from "@/components/costing/desk/CostingDesk";
import { costingMatrixService } from "@/services/costingMatrixService";
import { stubRoomyScreen } from "@/test/roomyScreen";

/**
 * An S0 Evaluation started from an S0 alone (#966), opened right after it was made. The window reads the matrix
 * and the evaluation's header side by side, and the matrix can arrive first. The desk must not mistake the
 * evaluation for a SOR's in that gap: it has no SOR to fill from, so asking one to fill is refused
 * ("this SOR has no S0 Evaluation yet") and nothing about it should show as a refusal.
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

const header = (matrixId) => ({ id: matrixId, standalone: true, project_title: "S08819", sales_reference: "S08819" });

describe("a new evaluation from an S0 alone", () => {
  it("never asks a SOR to fill it, even before its header has loaded", async () => {
    stubRoomyScreen();
    const owner = makeEmployee();
    authUser = { id: owner.id, isSuperAdmin: true };
    const matrix = db.seed("costing_matrices", { opportunity_id: null, s0_number: "S08819", created_by: owner.id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1, tender_specification: "Fire Hose Nozzle Pistol Grip", unit: "pc", quantity: 1, odoo_product_id: 4242, source: "typed" });
    db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Fire Hose Nozzle Pistol Grip", quantity: 1, unit: "pc", odoo_product_id: 4242 });
    stubCostingMatrixRpcs({ tier: "price", bands: ["sales"] });
    const fillFromSor = vi.spyOn(costingMatrixService, "fillFromSor");

    // The header (`opportunity`) has not arrived yet: the desk is first drawn without it.
    const { rerender } = renderWithProviders(
      <MemoryRouter>
        <CostingDesk opportunityId={matrix.id} opportunity={undefined} />
      </MemoryRouter>,
    );
    await screen.findByTestId("costing-desk");
    await waitFor(() => expect(screen.getByTestId("fill-note")).toBeInTheDocument());
    rerender(
      <MemoryRouter>
        <CostingDesk opportunityId={matrix.id} opportunity={header(matrix.id)} />
      </MemoryRouter>,
    );
    await screen.findByTestId("standalone-bar");

    expect(fillFromSor).not.toHaveBeenCalled();
    expect(screen.queryByText(/no S0 Evaluation yet/i)).not.toBeInTheDocument();
  });
});
