import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import SettingsPage from "@/pages/settings/index";
import { renderWithProviders } from "@/test/support";
import { makeEmployee, makeSuperAdmin } from "@/test/factories";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mockUser.current,
    logout: vi.fn(),
  }),
}));

// Issue #177: configuration that used to live on eight different screens is
// now sectioned inside Settings, gated by the same capability each screen
// already had. These tests are the seam that proves the gating, not the
// moved screens' own behaviour — each keeps its own tests for that.
describe("SettingsPage", () => {
  beforeEach(() => {
    mockUser.current = null;
  });

  it("shows an ordinary employee only the sections they may use", async () => {
    mockUser.current = makeEmployee({ name: "Rank And File" });

    renderWithProviders(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("App Preferences")).toBeInTheDocument();
    expect(screen.getByText("Account Actions")).toBeInTheDocument();

    expect(screen.queryByText("Customization")).not.toBeInTheDocument();
    expect(screen.queryByText("Lead Sources")).not.toBeInTheDocument();
    expect(screen.queryByText("System Announcements")).not.toBeInTheDocument();
    expect(screen.queryByText("Content")).not.toBeInTheDocument();
    expect(screen.queryByText("FAQ Editor")).not.toBeInTheDocument();
  });

  it("shows a Super Admin every moved section", async () => {
    mockUser.current = makeSuperAdmin({ name: "Root Access" });

    renderWithProviders(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Customization")).toBeInTheDocument();
    expect(screen.getByText("Lead Sources")).toBeInTheDocument();
    expect(screen.getByText("System Announcements")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Ops Manager Marketing Approvals")).toBeInTheDocument();
    });
  });

  it("shows the FAQ Editor entry only to a person the FAQ capability names", async () => {
    mockUser.current = makeEmployee({ id: "101", name: "Named Editor" });

    renderWithProviders(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("FAQ Editor")).toBeInTheDocument();
  });

  it("no longer offers a notification toggle with nothing behind it", async () => {
    mockUser.current = makeSuperAdmin({ name: "Root Access" });

    renderWithProviders(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await screen.findByText("Customization");
    expect(screen.queryByText(/email notification/i)).not.toBeInTheDocument();
  });
});
