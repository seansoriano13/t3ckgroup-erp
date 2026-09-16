/**
 * #132: with SOR reads narrowed to the people attached to a deal (#130), a
 * salesperson with none of their own gets a genuinely empty result set from
 * the service rather than a company-wide list filtered in the browser. This
 * proves the register, board and overview render a plain empty state for
 * that result instead of looking broken.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OpportunitiesPage from "@/pages/crm/index";
import { renderWithProviders } from "@/test/support";
import { makeEmployee } from "@/test/factories";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mockUser.current,
    isAuthLoading: false,
  }),
}));

describe("OpportunitiesPage with nothing the caller may see", () => {
  beforeEach(() => {
    const employee = makeEmployee({ name: "Narrowed Salesperson" });
    mockUser.current = employee;
  });

  it("renders an empty state on the List tab instead of an error or a blank table", async () => {
    renderWithProviders(
      <MemoryRouter>
        <OpportunitiesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/No opportunities registered yet/i)).toBeInTheDocument();
  });

  it("renders the same empty state on the Board tab", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter>
        <OpportunitiesPage />
      </MemoryRouter>,
    );
    await screen.findByText(/No opportunities registered yet/i);

    await user.click(screen.getByRole("button", { name: /Board/i }));

    expect(screen.getByText(/No opportunities registered yet/i)).toBeInTheDocument();
  });

  it("renders a plain empty state on the Overview tab", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter>
        <OpportunitiesPage />
      </MemoryRouter>,
    );
    await screen.findByText(/No opportunities registered yet/i);

    await user.click(screen.getByRole("button", { name: /Overview/i }));

    expect(await screen.findByText(/Nothing to show yet/i)).toBeInTheDocument();
  });
});
