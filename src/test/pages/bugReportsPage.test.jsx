import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import BugReportsPage from "@/pages/bug-reports/index";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubRpc } from "@/test/msw/server";
import { seedStorageObject } from "@/test/msw/storage";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

function renderPage(entry = "/bug-reports") {
  return renderWithProviders(
    <MemoryRouter initialEntries={[entry]}>
      <BugReportsPage />
    </MemoryRouter>,
  );
}

// Bug Reports: the list the IT Team and Super Admins read. Open reports by
// default; Resolved ones behind "Show resolved".
describe("Bug Reports page", () => {
  let reader;
  let reporter;

  beforeEach(() => {
    reader = makeEmployee({ name: "Ian", has_bug_report_access: true });
    reporter = makeEmployee({ name: "Ana Reyes" });
    mockUser.current = reader;
  });

  function report(overrides = {}) {
    return db.seed("bug_reports", {
      reporter_id: reporter.id,
      description: "Save does nothing\nOn the task form",
      page_url: "/tasks",
      environment: "staging",
      ...overrides,
    });
  }

  it("lists open reports by their first line and hides resolved ones until asked", async () => {
    report();
    report({ description: "Old crash", resolved_at: new Date().toISOString(), resolved_by: reader.id });
    const user = setupUser();

    renderPage();

    expect(await screen.findByText("Save does nothing")).toBeInTheDocument();
    expect(screen.getByText("Ana Reyes")).toBeInTheDocument();
    expect(screen.queryByText("Old crash")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Show resolved" }));
    expect(await screen.findByText("Old crash")).toBeInTheDocument();
  });

  it("opens a report with its full text and attachments, and ticks it Resolved", async () => {
    const r = report({
      attachments: [{ path: `${reporter.id}/a.png`, name: "shot.png", type: "image/png", bytes: 3 }],
    });
    seedStorageObject("bug-reports", `${reporter.id}/a.png`, { bytes: new Uint8Array([1]).buffer });
    const calls = [];
    stubRpc("set_bug_report_resolved", (args) => {
      calls.push(args);
      return null;
    });
    const user = setupUser();

    renderPage(`/bug-reports?record=${r.id}`);

    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByText(/On the task form/)).toBeInTheDocument();
    expect(await within(sheet).findByAltText("shot.png")).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Mark resolved" }));
    await waitFor(() => expect(calls).toEqual([{ p_id: r.id, p_resolved: true }]));
  });

  it("turns away someone without the access right", async () => {
    mockUser.current = reporter;

    renderPage();

    expect(await screen.findByText("You don't have access to Bug Reports")).toBeInTheDocument();
  });
});
