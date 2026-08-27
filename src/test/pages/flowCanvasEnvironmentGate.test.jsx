import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../support";

/**
 * Issue #36 — "The canvas and its Scratch SORs live on staging. Production is
 * never the drafting surface." isProductionSupabase (src/lib/supabase.js) is
 * mocked directly rather than through an env var, since it is derived once
 * from VITE_SUPABASE_URL at module load — by the time a test runs, the real
 * module has already read whatever the test harness's own URL resolved to.
 *
 * A stub `supabase` client is enough to satisfy the module's shape; it is
 * queried at all only in the non-production case, where getSaleTypes()'s
 * `.from().select().order().is()` chain needs something to await.
 */
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", name: "Admin", is_super_admin: true } }),
}));

function chainable() {
  const query = {
    select: () => query,
    order: () => query,
    is: () => query,
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return { from: () => query };
}

let mockIsProduction = false;
vi.mock("../../lib/supabase.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    supabase: chainable(),
    get isProductionSupabase() {
      return mockIsProduction;
    },
  };
});

import FlowCanvasAdminPage from "../../pages/super-admin/flow-canvas/index.jsx";

describe("FlowCanvasAdminPage", () => {
  it("shows the canvas when the build is not pointed at production", async () => {
    mockIsProduction = false;
    
    renderWithProviders(<FlowCanvasAdminPage />);

    // The canvas names its own empty state; the Sale Type menu is the control
    // that only ever exists on the drawable canvas.
    expect(await screen.findByText("No Sale Types yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sale Type options" })).toBeInTheDocument();
    expect(screen.queryByText("The Flow Canvas is not available here")).not.toBeInTheDocument();
  });

  it("refuses to draw against production", async () => {
    mockIsProduction = true;
    
    renderWithProviders(<FlowCanvasAdminPage />);

    expect(await screen.findByText("The Flow Canvas is not available here")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sale Type options" })).not.toBeInTheDocument();
  });
});
