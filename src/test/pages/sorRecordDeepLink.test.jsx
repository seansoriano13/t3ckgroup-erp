/**
 * Sharing an SOR: `/sors?record=<id>` is rewritten to `?open=sor:<id>` (#1020), which the
 * global window opens.
 */
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OpportunitiesPage from "@/pages/sors/index";
import { opportunityService } from "@/services/opportunityService";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

vi.mock("@/components/sor/OpportunityFormModal", () => ({ default: () => null }));

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

  it("rewrites a plain /sors?record=<id> link to ?open=sor:<id> (#1025)", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={[`/sors?record=${LINKED.id}`]}>
        <OpportunitiesPage />
        <LocationProbe />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("search")).toHaveTextContent(`open=sor%3A${LINKED.id}`));
    expect(screen.getByTestId("search")).not.toHaveTextContent("record=");
  });
});

describe("SOR register addresses", () => {
  beforeEach(() => {
    mockUser.current = makeEmployee({ name: "Link Opener", is_super_admin: true });
    sessionStorage.clear();
    localStorage.clear();
    vi.clearAllMocks();
    vi.spyOn(opportunityService, "getOpportunities").mockResolvedValue([
      { ...LINKED, status: "LEAD", created_at: "2026-11-01T00:00:00Z" },
    ]);
  });

  it("rewrites a bare ?view=mine to ?scope=mine", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={["/sors?view=mine"]}>
        <OpportunitiesPage />
        <LocationProbe />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("search")).toHaveTextContent("?scope=mine"));
    expect(screen.getByTestId("search")).not.toHaveTextContent("view=");
  });

  it("keeps ?view=<tab> next to ?open= alone: it is the SOR's tab, not the register's", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={[`/sors?open=sor:${LINKED.id}&view=pms`]}>
        <OpportunitiesPage />
        <LocationProbe />
      </MemoryRouter>,
    );

    await waitFor(() => expect(opportunityService.getOpportunities).toHaveBeenCalled());
    expect(screen.getByTestId("search")).toHaveTextContent("view=pms");
    expect(screen.getByTestId("search")).not.toHaveTextContent("scope=");
  });

  it("a list row opens the shared window through the event, not a page-own ?record=", async () => {
    const opened = vi.fn();
    const onOpen = (e) => opened(e.detail);
    window.addEventListener("OPEN_ENTITY_DETAILS", onOpen);
    try {
      const user = setupUser();
      renderWithProviders(
        <MemoryRouter initialEntries={["/sors"]}>
          <OpportunitiesPage />
          <LocationProbe />
        </MemoryRouter>,
      );
      await user.click(await screen.findByRole("tab", { name: /^list/i }));
      await user.click(await screen.findByText("Linked Co"));

      expect(opened).toHaveBeenCalledWith(expect.objectContaining({ id: LINKED.id, type: "OPPORTUNITY" }));
      expect(screen.getByTestId("search")).not.toHaveTextContent("record=");
    } finally {
      window.removeEventListener("OPEN_ENTITY_DETAILS", onOpen);
    }
  });
});
