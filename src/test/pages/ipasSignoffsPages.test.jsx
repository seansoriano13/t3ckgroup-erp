import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import SettingsPage from "@/pages/settings";
import IpasSignoffsQueuePage from "@/pages/approvals/ipas";
import { confirmMove, renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { waitForNetworkIdle } from "@/test/network";
import { stubEdgeFunction } from "@/test/msw/server";
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc";
import { findOtherDialog } from "@/test/support/dialogs"

const mockUser = vi.hoisted(() => ({ current: null }));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("react-hot-toast", async (importOriginal) => {
  const actual = await importOriginal();
  const toast = Object.assign((...args) => actual.default(...args), actual.default, { error: toastError });
  return { ...actual, default: toast };
});

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

/**
 * IPAS sign-offs (#247) as the people at the screens meet them: the IPAS page's
 * Prepare, Approve and Return, the Super Admin's signer lists in settings,
 * and the Approval Center's IPAS queue. The database decides who may sign
 * (policy tier 61); this proves each screen offers only what it will let a
 * person do, and that what they do lands.
 */

const poCopy = (po) => ({
  po: { id: 1, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
  supplier: { id: 5, name: "Scorpe Technologies", contact: "Ms. K. Tan" },
  lines: [
    { line_id: 11, name: "Greenspirit 2 Cutter", brand: "SCORPE", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [] },
  ],
  receipts: { status: "pending", done: 0, total: 1 },
  bills: { count: 0, draft: 0 },
});

let counter = 48;
function ipas(overrides = {}) {
  counter += 1;
  const po = overrides.po_number ?? `P0${3000 + counter}`;
  return db.seed("ipas", {
    number: `TGIPAS_${String(counter).padStart(3, "0")}`,
    po_number: po,
    priority: "high",
    source: "local",
    purpose: "inventory",
    odoo_copy: poCopy(po),
    odoo_fetched_at: "2026-10-13T02:00:00.000Z",
    state: "open",
    landed_cost_split: "value",
    computation_status: "encoding",
    ...overrides,
  });
}

const signoff = (ipasId, section, role, signedBy, over = {}) =>
  db.seed("ipas_signoffs", { ipas_id: ipasId, section, role, signed_by: signedBy.id, ...over });
const onList = (listKey, ...people) => people.forEach((p) => db.seed("ipas_signer_lists", { list_key: listKey, employee_id: p.id }));

function renderDetail(id, section, param = "open") {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/purchasing/ipas/${id}${section ? `?${param}=${section}` : ""}`]}>
      <Routes>
        <Route path="/purchasing/ipas/:id" element={<IpasDetailPage />} />
        <Route path="/purchasing/ipas" element={<p>The IPAS list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("IPAS sign-offs", () => {
  let purchaser, approver, other, superAdmin;

  /** Signs in as someone: the page's identity and the stubbed database's. */
  const signIn = (person, opts = {}) => {
    mockUser.current = person;
    stubIpasRpcs({ actorId: person.id, purchasing: Boolean(person.has_purchasing_flow), ...opts });
  };

  beforeEach(() => {
    counter = 48;
    toastError.mockClear();
    purchaser = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    approver = makeEmployee({ name: "Boss Lito" });
    other = makeEmployee({ name: "Co Approver" });
    superAdmin = makeEmployee({ name: "Super Admin", is_super_admin: true });
    seedIpasOptions((table, row) => db.seed(table, row));
    signIn(purchaser);
    stubEdgeFunction("odoo-po-ipas", (body) => ({ success: true, found: true, ...poCopy(body.poNumber) }));
  });

  describe("on the IPAS page", () => {
    it("lets Purchasing prepare a section, which then waits for approval and tells the approvers", async () => {
      onList("s1_approved", approver, other);
      const row = ipas({ created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "purchasing");
      // The drawer's footer carries the move; the body only reads.
      const drawer = await screen.findByRole("dialog", { name: "1 · Purchasing" });
      const one = within(drawer).getByTestId("ipas-signoffs-1");
      expect(within(one).getByText("Not submitted")).toBeInTheDocument();
      expect(within(one).queryByRole("button", { name: /Approve section 1/ })).not.toBeInTheDocument();

      await user.click(within(drawer).getByRole("button", { name: "Submit section 1" }));
      await confirmMove(user, "Submit section 1", "Submit");

      await waitFor(() => expect(within(screen.getByTestId("ipas-signoffs-1")).getByText("Awaiting approval")).toBeInTheDocument());
      expect(within(screen.getByTestId("ipas-signoff-1-prepared")).getByText("Buyer")).toBeInTheDocument();
      expect(within(drawer).queryByRole("button", { name: "Submit section 1" })).not.toBeInTheDocument();
      await waitForNetworkIdle();
      expect(db.rows("notifications").map((n) => n.recipient_id).sort()).toEqual([approver.id, other.id].sort());
    });

    it("offers Approve to a list member after Submitted, and shows who approved", async () => {
      onList("s1_approved", approver);
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);
      signIn(approver);
      const user = setupUser();

      renderDetail(row.id, "purchasing");
      const drawer = await screen.findByRole("dialog", { name: "1 · Purchasing" });
      const one = within(drawer).getByTestId("ipas-signoffs-1");
      expect(within(one).queryByRole("button", { name: /Submit section/ })).not.toBeInTheDocument();
      await user.click(within(drawer).getByRole("button", { name: "Approve section 1" }));
      await confirmMove(user, "Approve section 1", "Approve");

      await waitFor(() => expect(within(screen.getByTestId("ipas-signoffs-1")).getByText("Approved", { selector: "span" })).toBeInTheDocument());
      expect(within(screen.getByTestId("ipas-signoff-1-approved")).getByText("Boss Lito")).toBeInTheDocument();
      expect(within(drawer).queryByRole("button", { name: "Approve section 1" })).not.toBeInTheDocument();
    });

    it("doesn't offer Approve to the preparer, and says why", async () => {
      onList("s1_approved", purchaser, approver);
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);

      renderDetail(row.id, "purchasing");

      const drawer = await screen.findByRole("dialog", { name: "1 · Purchasing" });
      const one = within(drawer).getByTestId("ipas-signoffs-1");
      expect(within(drawer).queryByRole("button", { name: "Approve section 1" })).not.toBeInTheDocument();
      expect(within(one).getByText(/You submitted this section, so someone else approves it/)).toBeInTheDocument();
      // They are on the list, so they may still return it: from the footer.
      expect(within(drawer).getByRole("button", { name: "Return section 1" })).toBeInTheDocument();
    });

    it("offers nothing to someone off the list, a Super Admin included", async () => {
      onList("s1_approved", approver);
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);
      signIn(superAdmin);

      renderDetail(row.id, "purchasing");

      const one = await screen.findByTestId("ipas-signoffs-1");
      expect(within(one).getByText("Awaiting approval")).toBeInTheDocument();
      expect(within(one).queryByRole("button")).not.toBeInTheDocument();
    });

    it("returns a prepared section with a reason that is required, and shows what was cleared and why", async () => {
      onList("s3_approved", approver);
      const row = ipas();
      signoff(row.id, 3, "prepared", purchaser);
      signIn(approver);
      const user = setupUser();

      renderDetail(row.id, "finance");
      const drawer = await screen.findByRole("dialog", { name: "2 · Purchasing & Finance" });
      await user.click(within(drawer).getByRole("button", { name: "Return section 2" }));

      const dialog = await screen.findByRole("dialog", { name: "Return section 2?" });
      const send = within(dialog).getByRole("button", { name: "Return" });
      expect(send).toBeDisabled();
      await user.type(within(dialog).getByPlaceholderText(/What does the submitter need to fix/), "  Freight is missing ");
      expect(send).toBeEnabled();
      await user.click(send);

      // UI first: the section reads Not submitted at once.
      await waitFor(() => expect(within(screen.getByTestId("ipas-signoffs-3")).getByText("Not submitted")).toBeInTheDocument());
      const history = screen.getByTestId("ipas-signoff-history-3");
      expect(within(history).getAllByText(/Returned: Freight is missing/)).toHaveLength(1);
      await waitForNetworkIdle();
      const notice = db.rows("notifications").find((n) => n.type === "IPAS_SENT_BACK");
      expect(notice).toMatchObject({ recipient_id: purchaser.id, reference_id: row.id });
      expect(notice.title).toBe("IPAS returned");
    });

    it("undoes an approval with a reason, leaving Submitted so it waits for an approver again", async () => {
      onList("s3_approved", approver);
      const row = ipas();
      signoff(row.id, 3, "prepared", purchaser);
      signoff(row.id, 3, "approved", approver);
      signIn(approver);
      const user = setupUser();

      renderDetail(row.id, "finance");
      const drawer = await screen.findByRole("dialog", { name: "2 · Purchasing & Finance" });
      // Once approved it is Undo approval, never Return.
      expect(within(drawer).queryByRole("button", { name: "Return section 2" })).not.toBeInTheDocument();
      await user.click(within(drawer).getByRole("button", { name: "Undo approval of section 2" }));

      const dialog = await screen.findByRole("dialog", { name: "Undo approval of section 2?" });
      const undo = within(dialog).getByRole("button", { name: "Undo approval" });
      expect(undo).toBeDisabled();
      await user.type(within(dialog).getByPlaceholderText(/Why is this approval being taken back/), "Approved too fast");
      await user.click(undo);

      await waitFor(() => expect(within(screen.getByTestId("ipas-signoffs-3")).getByText("Awaiting approval")).toBeInTheDocument());
      await waitForNetworkIdle();
      const live = db.rows("ipas_signoffs").filter((s) => !s.cleared_at).map((s) => s.role);
      expect(live).toEqual(["prepared"]);
      expect(db.rows("ipas_signoffs").find((s) => s.cleared_at)).toMatchObject({
        role: "approved",
        cleared_reason: "Approval undone: Approved too fast",
        cleared_by: approver.id,
      });
    });

    it("shows what an Odoo change cleared, and awaiting approval again", async () => {
      onList("s1_approved", approver);
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);
      signoff(row.id, 1, "approved", approver, {
        cleared_at: "2026-10-13T05:00:00.000Z",
        cleared_reason: "PO changed in Odoo",
      });

      renderDetail(row.id, "purchasing");

      const one = await screen.findByTestId("ipas-signoffs-1");
      expect(within(one).getByText("Awaiting approval")).toBeInTheDocument();
      expect(within(screen.getByTestId("ipas-signoff-history-1")).getByText(/PO changed in Odoo/)).toBeInTheDocument();
    });

    it("writes the sign-offs, send-backs and clearings into History in words", async () => {
      const row = ipas();
      db.seed("ipas_events", [
        { ipas_id: row.id, actor_id: purchaser.id, kind: "signed", detail: { section: 1, role: "prepared", signature_declined: false } },
        { ipas_id: row.id, actor_id: approver.id, kind: "signed", detail: { section: 1, role: "approved", signature_declined: true } },
        { ipas_id: row.id, actor_id: approver.id, kind: "sent_back", detail: { section: 3, reason: "Freight is missing", cleared: ["prepared"] } },
        { ipas_id: row.id, actor_id: purchaser.id, kind: "approvals_cleared", detail: { reason: "PO changed in Odoo", sections: [1, 3] } },
      ]);

      renderDetail(row.id, "history");

      expect(await screen.findByText("Section 1 · Purchasing submitted")).toBeInTheDocument();
      expect(screen.getByText("Section 1 · Purchasing approved · without a signature")).toBeInTheDocument();
      expect(screen.getByText("Section 2 · Purchasing & Finance · “Freight is missing”")).toBeInTheDocument();
      expect(screen.getByText("PO changed in Odoo · 1 · Purchasing and 2 · Purchasing & Finance back to awaiting approval")).toBeInTheDocument();
    });

    it("offers no sign-off action on a filed IPAS", async () => {
      onList("s1_approved", approver);
      const row = ipas({ state: "filed", filed_at: "2026-10-14T00:00:00.000Z" });
      signoff(row.id, 1, "prepared", purchaser);
      signIn(approver);

      renderDetail(row.id, "purchasing");

      const one = await screen.findByTestId("ipas-signoffs-1");
      expect(within(one).queryByRole("button")).not.toBeInTheDocument();
    });

    it("words the database's refusal in a sentence, not a code", async () => {
      onList("s1_approved", approver);
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);
      // The page thinks the viewer is on the list; the database disagrees.
      signIn(approver, { actorId: other.id });
      const user = setupUser();

      renderDetail(row.id, "purchasing");
      const drawer = await screen.findByRole("dialog", { name: "1 · Purchasing" });
      await user.click(within(drawer).getByRole("button", { name: "Approve section 1" }));
      await confirmMove(user, "Approve section 1", "Approve");

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/^you are not on the list that may give this sign-off/i)));
      expect(toastError.mock.calls.at(-1)[0]).not.toMatch(/ipas_sign|42501/);
      expect(db.rows("ipas_signoffs").filter((s) => s.role === "approved")).toEqual([]);
    });

    it("names every section by its number and name, never by a bare number", async () => {
      onList("s1_approved", approver);
      onList("s3_approved", approver);
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);
      signoff(row.id, 1, "approved", approver);
      signoff(row.id, 3, "prepared", purchaser);
      db.seed("ipas_events", [
        { ipas_id: row.id, actor_id: approver.id, kind: "sent_back", detail: { section: 3, reason: "Freight is missing", cleared: ["prepared"] } },
        { ipas_id: row.id, actor_id: purchaser.id, kind: "approvals_cleared", detail: { reason: "PO changed in Odoo", sections: [1, 3] } },
      ]);
      signIn(approver);
      const user = setupUser();

      const view = renderDetail(row.id, "finance");
      const drawer = await screen.findByRole("dialog", { name: "2 · Purchasing & Finance" });
      await user.click(within(drawer).getByRole("button", { name: "Return section 2" }));
      await screen.findByRole("dialog", { name: "Return section 2?" });

      const text = document.body.textContent ?? "";
      expect(text).toContain("Return section 2?");
      expect(text).toContain("Opens once 1 · Purchasing, 2 · Purchasing & Finance and 3 · Computation status & Landed Cost are approved");
      // Apart from the short move names (#593), a section is named with its number and its name, or not by number at all.
      const prose = text.replace(/(?:Return section|Undo approval of section) \d/g, "");
      expect(prose).not.toMatch(/\b(?:sections?|send|waiting for|and|for)\s+\d+\b(?!\s*·)/i);
      view.unmount();

      // History names the same sections the same way.
      renderDetail(row.id, "history");
      expect(await screen.findByText("Section 2 · Purchasing & Finance · “Freight is missing”")).toBeInTheDocument();
      expect(screen.getByText("PO changed in Odoo · 1 · Purchasing and 2 · Purchasing & Finance back to awaiting approval")).toBeInTheDocument();
    });
  });

  describe("the sign-off lists in settings", () => {
    const renderSettings = () =>
      renderWithProviders(
        <MemoryRouter initialEntries={["/settings?tab=purchasing"]}>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/purchasing/ipas" element={<p>The IPAS list</p>} />
            <Route path="/" element={<p>Home</p>} />
          </Routes>
        </MemoryRouter>,
      );

    it("offers the lists to a Super Admin only", async () => {
      signIn(superAdmin);
      const first = renderSettings();
      expect(await screen.findByRole("tab", { name: "Sign-off lists" })).toBeInTheDocument();
      first.unmount();

      signIn(purchaser);
      renderSettings();
      expect(await screen.findByRole("tab", { name: "Payment methods" })).toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: "Sign-off lists" })).not.toBeInTheDocument();
    });

    it("shows who is on each list, and takes someone off one", async () => {
      onList("s1_approved", approver, other);
      onList("s3_approved", approver);
      signIn(superAdmin, { superAdmin: true });
      const user = setupUser();

      renderSettings();
      await user.click(await screen.findByRole("tab", { name: "Sign-off lists" }));

      const one = await screen.findByTestId("ipas-signer-list-s1_approved");
      expect(await within(one).findByText("Boss Lito")).toBeInTheDocument();
      expect(within(one).getByText("Co Approver")).toBeInTheDocument();
      expect(within(screen.getByTestId("ipas-signer-list-s7_noted")).getByText("Nobody yet.")).toBeInTheDocument();
      expect(within(one).getByText("Section 1 · Approved")).toBeInTheDocument();
      expect(within(screen.getByTestId("ipas-signer-list-s3_approved")).getByText("Section 2 · Approved")).toBeInTheDocument();
      expect(within(screen.getByTestId("ipas-signer-list-s7_noted")).getByText("Section 4 · Noted")).toBeInTheDocument();

      await user.click(within(one).getByRole("button", { name: "Remove Co Approver" }));

      await waitFor(() => expect(within(screen.getByTestId("ipas-signer-list-s1_approved")).queryByText("Co Approver")).not.toBeInTheDocument());
      expect(db.rows("ipas_signer_lists").filter((l) => l.list_key === "s1_approved").map((l) => l.employee_id)).toEqual([approver.id]);
      expect(db.rows("ipas_signer_lists").filter((l) => l.list_key === "s3_approved")).toHaveLength(1);
    });

    it("shows who changed the lists, newest first, and adds to it as lists change", async () => {
      onList("s1_approved", approver);
      db.seed("ipas_signer_list_log", { list_key: "s7_noted", employee_id: other.id, action: "added", actor_id: superAdmin.id, created_at: "2026-10-12T02:00:00.000Z" });
      signIn(superAdmin, { superAdmin: true });
      const user = setupUser();

      renderSettings();
      await user.click(await screen.findByRole("tab", { name: "Sign-off lists" }));

      const history = await screen.findByTestId("ipas-signer-list-log");
      const first = await within(history).findAllByTestId("ipas-signer-list-log-entry");
      expect(first).toHaveLength(1);
      expect(first[0]).toHaveTextContent("Super Admin added Co Approver to");

      await user.click(within(await screen.findByTestId("ipas-signer-list-s1_approved")).getByRole("button", { name: "Remove Boss Lito" }));

      await waitFor(() => expect(within(screen.getByTestId("ipas-signer-list-log")).getAllByTestId("ipas-signer-list-log-entry")).toHaveLength(2));
      expect(within(screen.getByTestId("ipas-signer-list-log")).getAllByTestId("ipas-signer-list-log-entry")[0]).toHaveTextContent(
        "Super Admin removed Boss Lito from",
      );
    });

    it("says there are no changes yet when the log is empty", async () => {
      signIn(superAdmin, { superAdmin: true });
      const user = setupUser();

      renderSettings();
      await user.click(await screen.findByRole("tab", { name: "Sign-off lists" }));

      expect(await within(await screen.findByTestId("ipas-signer-list-log")).findByText("No changes yet.")).toBeInTheDocument();
    });
  });

  describe("the Approval Center queue", () => {
    const renderQueue = (initial = "/approvals/ipas") =>
      renderWithProviders(
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route path="/approvals/ipas" element={<IpasSignoffsQueuePage />} />
            <Route path="/purchasing/ipas/:id" element={<p>The IPAS page</p>} />
            <Route path="/" element={<p>Home</p>} />
          </Routes>
        </MemoryRouter>,
      );

    it("lists the IPAS waiting on the approver, with the preparer", async () => {
      onList("s1_approved", approver);
      const row = ipas({ created_by: purchaser.id });
      signoff(row.id, 1, "prepared", purchaser);
      const mine = ipas({ created_by: purchaser.id });
      signoff(mine.id, 1, "prepared", approver);
      signIn(approver, { purchasing: false });
      mockUser.current = { ...approver, isIpasApprover: true };

      renderQueue();

      const rows = await screen.findAllByRole("row");
      expect(rows.some((r) => within(r).queryByText(row.number))).toBe(true);
      expect(screen.getByText("Scorpe Technologies")).toBeInTheDocument();
      expect(screen.getByText("Buyer")).toBeInTheDocument();
      // What they prepared themselves isn't theirs to approve.
      expect(screen.queryByText(mine.number)).not.toBeInTheDocument();
    });

    it("approves from the row, and the IPAS leaves the queue", async () => {
      onList("s1_approved", approver);
      const row = ipas({ created_by: purchaser.id });
      signoff(row.id, 1, "prepared", purchaser);
      signIn(approver);
      mockUser.current = { ...approver, isIpasApprover: true };
      const user = setupUser();

      renderQueue();
      await user.click(await screen.findByRole("button", { name: `Approve ${row.number} section 1` }));

      await waitFor(() => expect(screen.getByText("Nothing waiting on you right now")).toBeInTheDocument());
      expect(db.rows("ipas_signoffs").filter((s) => !s.cleared_at).map((s) => s.role).sort()).toEqual(["approved", "prepared"]);
    });

    it("returns from the row with a reason, and tells the preparer", async () => {
      onList("s3_approved", approver);
      const row = ipas({ created_by: purchaser.id });
      signoff(row.id, 3, "prepared", purchaser);
      signIn(approver);
      mockUser.current = { ...approver, isIpasApprover: true };
      const user = setupUser();

      renderQueue();
      await user.click(await screen.findByRole("button", { name: `Return ${row.number} section 2` }));
      const dialog = await findOtherDialog();
      await user.type(within(dialog).getByPlaceholderText(/What does the submitter need to fix/), "Wrong supplier");
      await user.click(within(dialog).getByRole("button", { name: "Return" }));

      await waitFor(() => expect(screen.getByText("Nothing waiting on you right now")).toBeInTheDocument());
      await waitForNetworkIdle();
      expect(db.rows("ipas_signoffs")[0]).toMatchObject({ cleared_reason: "Returned: Wrong supplier", cleared_by: approver.id });
      expect(db.rows("notifications").find((n) => n.type === "IPAS_SENT_BACK")).toMatchObject({ recipient_id: purchaser.id });
    });

    it("opens a review sheet that links to the IPAS", async () => {
      onList("s1_approved", approver);
      const row = ipas({ created_by: purchaser.id });
      signoff(row.id, 1, "prepared", purchaser);
      signIn(approver);
      mockUser.current = { ...approver, isIpasApprover: true };
      const user = setupUser();

      renderQueue();
      await user.click(await screen.findByText("Scorpe Technologies"));

      const sheet = await findOtherDialog();
      expect(within(sheet).getByText("Submitted it")).toBeInTheDocument();
      expect(within(sheet).getByText(row.po_number)).toBeInTheDocument();
      expect(within(sheet).getByRole("link", { name: "Open the IPAS" })).toHaveAttribute("href", `/purchasing/ipas/${row.id}`);
      expect(within(sheet).getByRole("button", { name: "Approve" })).toBeInTheDocument();
      expect(within(sheet).getByRole("button", { name: "Return" })).toBeInTheDocument();
    });

    it("sends someone who isn't on an approval list away", async () => {
      signIn(superAdmin);
      mockUser.current = { ...superAdmin, isSuperAdmin: true, isIpasApprover: false };

      renderQueue();

      expect(await screen.findByText("Home")).toBeInTheDocument();
    });
  });
});
