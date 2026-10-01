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

// Bug Reports: the list the IT Team and Super Admins read (anyone else sees
// their own, as My Bug Reports). Open reports by default; Resolved ones behind
// "Show resolved". Each report carries a thread of Notes.
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

  it("shows the thread on a report and sends a note", async () => {
    const r = report();
    db.seed("bug_report_notes", { report_id: r.id, author_id: reader.id, kind: "note", body: "Fixed, can you check?" });
    db.seed("bug_report_notes", { report_id: r.id, author_id: reporter.id, kind: "note", body: "Yes, works now" });
    const calls = [];
    stubRpc("add_bug_report_note", (args) => {
      calls.push(args);
      return "note-1";
    });
    const user = setupUser();

    renderPage(`/bug-reports?record=${r.id}`);

    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByText("Fixed, can you check?")).toBeInTheDocument();
    expect(within(sheet).getByText("Yes, works now")).toBeInTheDocument();

    await user.type(within(sheet).getByRole("textbox", { name: "Note" }), "  Thanks!  ");
    await user.click(within(sheet).getByRole("button", { name: "Send note" }));
    await waitFor(() => expect(calls).toEqual([{ p_report_id: r.id, p_body: "Thanks!" }]));
  });

  it("shows someone without the access right their own reports, to reply, but not Mark resolved", async () => {
    mockUser.current = reporter;
    const r = report();

    renderPage(`/bug-reports?record=${r.id}`);

    expect(await screen.findByText(/Bugs you reported with the bug button/)).toBeInTheDocument();
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByRole("textbox", { name: "Note" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Mark resolved" })).not.toBeInTheDocument();
  });
});
