/**
 * Sharing an SOR: `/sors?record=<id>` is rewritten to `?open=sor:<id>` (#1020), which the
 * global window opens.
 */
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OpportunitiesPage from "@/pages/sors/index";
import { opportunityService } from "@/services/opportunityService";
import { renderWithProviders } from "@/test/support";
import { makeEmployee } from "@/test/factories";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

vi.mock("@/components/sor/OpportunityFormModal", () => ({ default: () => null }));

// The details modal has its own suite; here it only shows which SOR it opened.
vi.mock("@/components/sor/OpportunityDetailsModal", () => ({
  default: ({ isOpen, opportunity }) =>
    isOpen && opportunity ? <div role="dialog">Details for {opportunity.sor_code}</div> : null,
}));

vi.mock("@/components/sor/DeletedOpportunitiesView", () => ({
  default: () => <div>Deleted SORs body</div>,
}));

const LINKED = { id: "opp-linked-7", sor_code: "SOR-7", client_name: "Linked Co" };

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="search">{location.search}</output>;
}

describe("SOR deep link: /sors?record=<id>", () => {
  beforeEach(() => {
    mockUser.current = makeEmployee({ name: "Link Opener" });
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.spyOn(opportunityService, "getOpportunities").mockResolvedValue([]);
    vi.spyOn(opportunityService, "getOpportunityById").mockResolvedValue({ ...LINKED });
  });

  it("rewrites an old ?record= link to ?open=sor:<id>, keeping the tab", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={[`/sors?record=${LINKED.id}&view=pms`]}>
        <OpportunitiesPage />
        <LocationProbe />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("search")).toHaveTextContent(`view=pms&open=sor%3A${LINKED.id}`),
    );
    expect(screen.getByTestId("search")).not.toHaveTextContent("record=");
  });
});
