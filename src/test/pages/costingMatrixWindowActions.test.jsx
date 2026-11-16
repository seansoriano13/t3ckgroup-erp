import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { render, screen } from "@testing-library/react";

/**
 * The S0 Evaluation window's header (#1038): "SOR PMS tab" and "Print" are offered only when the evaluation can be read.
 */

let matrix;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", isSuperAdmin: true } }) }));
vi.mock("@/components/costing/useCostingMatrix", () => ({ useCostingMatrix: () => ({ data: matrix }) }));
vi.mock("@/components/ProtectedRoute", () => ({ default: ({ children }) => children }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { id: "o1", sor_code: "SOR1", standalone: false }, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("react-router", async (orig) => ({ ...(await orig()), useParams: () => ({ id: "o1" }) }));
vi.mock("@/components/ui/ModalShell", () => ({ default: ({ headerActions, children }) => <div><div data-testid="actions">{headerActions}</div>{children}</div> }));
vi.mock("@/components/costing/desk/PrintButton", () => ({ default: () => <button type="button">Print</button> }));
vi.mock("@/components/costing/desk/CostingDesk", () => ({ default: () => null }));
vi.mock("@/pages/costing-matrix/index", () => ({ CostingMatrixList: () => null }));

import CostingMatrixWindow from "@/pages/costing-matrix/[id]";

describe("S0 Evaluation window header", () => {
  it("offers SOR PMS tab and Print when the evaluation is readable", () => {
    matrix = { id: "m1" };
    render(<MemoryRouter><CostingMatrixWindow /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "SOR PMS tab" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
  });

  it("hides SOR PMS tab and Print when it cannot be read", () => {
    matrix = null;
    render(<MemoryRouter><CostingMatrixWindow /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "SOR PMS tab" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /print/i })).not.toBeInTheDocument();
  });
});
