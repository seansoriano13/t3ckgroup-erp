import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateUserPreferences = vi.fn();
let mockUser;
const eq = vi.fn(() => Promise.resolve({ error: null }));
const update = vi.fn(() => ({ eq }));

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser, updateUserPreferences }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: () => ({ update }) } }));
vi.mock("@/data/changelog.json", () => ({
  default: [{ version: "9.9.9", date: "2026-11-14", title: "Test release", changes: ["A change"] }],
}));
vi.mock("../../../scripts/lib/changelog.mjs", () => ({ visibleEntries: (all) => all }));
vi.mock("@/lib/appEnv", () => ({ isStaging: false }));

import ChangelogModal from "@/components/ChangelogModal";

const show = () => render(<MemoryRouter><ChangelogModal /></MemoryRouter>);

describe("ChangelogModal seen flag (#1041)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockUser = { id: "u1", lastSeenChangelogVersion: null };
  });

  it("stays closed when the account already saw the version, with empty browser storage", async () => {
    mockUser = { id: "u1", lastSeenChangelogVersion: "9.9.9" };
    show();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("What's New")).not.toBeInTheDocument();
  });

  it("opens for a new version, and dismissing saves it on the account and the cached user", async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole("button", { name: "Continue to App" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ last_seen_changelog_version: "9.9.9" }));
    expect(updateUserPreferences).toHaveBeenCalledWith({ lastSeenChangelogVersion: "9.9.9" });
  });
});
