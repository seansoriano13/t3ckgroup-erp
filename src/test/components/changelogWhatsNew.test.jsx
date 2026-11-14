import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }) },
}));

import ChangelogModal from "@/components/ChangelogModal";
import { useReleaseNotesDot } from "@/hooks/useReleaseNotesDot";
import { entryTouchesUser, getUnreadVersion } from "@/utils/changelogAccess";
import changelog from "@/data/changelog.json";

const latest = changelog[0];
const salesExec = { id: "sales-1", role: "EMPLOYEE", department: "Sales", has_sales_flow: true, last_seen_changelog_version: "1.0.0" };
const purchaser = { id: "buyer-1", role: "EMPLOYEE", department: "Purchasing", has_purchasing_flow: true, last_seen_changelog_version: "1.0.0" };

function Dot() {
  return useReleaseNotesDot(auth.user) ? <span data-testid="dot" /> : null;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <ChangelogModal />
      <Dot />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("What's New by module (#1011)", () => {
  it("tags the latest release for Canvass only, and every entry is still listed", () => {
    expect(latest.version).toBe("1.10.6");
    expect(latest.modules).toEqual(["purchasing.canvasses"]);
    expect(changelog.length).toBeGreaterThan(10);
  });

  it("entries with no modules are for everyone", () => {
    expect(entryTouchesUser({ version: "9.9.9" }, salesExec)).toBe(true);
    expect(entryTouchesUser({ modules: [] }, salesExec)).toBe(true);
  });

  it("a Sales Executive gets no popup for 1.10.6, but a dot on Release Notes", async () => {
    auth.user = salesExec;
    renderApp();

    expect(screen.queryByText("What's New")).not.toBeInTheDocument();
    expect(await screen.findByTestId("dot")).toBeInTheDocument();
    expect(getUnreadVersion(salesExec.id)).toBe(latest.version);
    // Recorded as seen, so it does not ask again.
    expect(localStorage.getItem(`changelog_dismissed_${salesExec.id}`)).toBe(latest.version);
  });

  it("a purchaser is shown the popup and no dot", async () => {
    auth.user = purchaser;
    renderApp();

    expect(await screen.findByText("What's New")).toBeInTheDocument();
    expect(screen.queryByTestId("dot")).not.toBeInTheDocument();
  });
});
