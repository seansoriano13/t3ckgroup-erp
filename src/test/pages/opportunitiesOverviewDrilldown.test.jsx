/**
 * Clicking a stage count or a person on the SORS Overview navigates to the
 * register carrying `filterEmployeeId` and drops the user on the List. The view
 * the page remembers has to follow, or a reload restores the Overview that was
 * saved before the click.
 */
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OpportunitiesPage from "@/pages/sors/index";
import { renderWithProviders } from "@/test/support";
import { makeEmployee } from "@/test/factories";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mockUser.current,
    isAuthLoading: false,
  }),
}));

describe("SORS Overview drill-down", () => {
  beforeEach(() => {
    mockUser.current = makeEmployee({ name: "Drill Down" });
    sessionStorage.clear();
  });

  it("remembers List, not the Overview it left", async () => {
    sessionStorage.setItem("opportunitiesView", "overview");

    renderWithProviders(
      <MemoryRouter
        initialEntries={[{ pathname: "/sors", state: { filterEmployeeId: mockUser.current.id } }]}
      >
        <OpportunitiesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("tab", { name: /^List/i, selected: true })).toBeInTheDocument();
    expect(sessionStorage.getItem("opportunitiesView")).toBe("list");
  });
});
