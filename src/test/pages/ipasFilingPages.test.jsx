import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import IpasSignoffsQueuePage from "@/pages/approvals/ipas";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { waitForNetworkIdle } from "@/test/network";
import { stubEdgeFunction } from "@/test/msw/server";
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc";
import { makeReady } from "@/test/support/ipasReady";
import { openSignReview } from "@/test/support/ipasSignRow";
import { findOtherDialog } from "@/test/support/dialogs";

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
 * IPAS section 7 and Filing (#248) as the people at the screens meet them: the
 * four sign-offs and what each person is offered, the Approve dialog that lists
 * the documents nobody has ticked, the filed page (banner, no edit controls,
 * "Odoo has changed since filing") with the Super Admin's Reopen, and section
 * 7's steps in the Approval Center. The database decides every rule (policy
 * tier 62); this proves each screen offers only what it will allow and that
 * what a person does lands.
 */

const poCopy = (po, extraLine = false) => ({
  po: { id: 1, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
  supplier: { id: 5, name: "Scorpe Technologies", contact: "Ms. K. Tan" },
  lines: [
    { line_id: 11, name: "Greenspirit 2 Cutter", brand: "SCORPE", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [] },
    ...(extraLine
      ? [{ line_id: 12, name: "Spare blade", brand: "SCORPE", quantity: 3, unit: "Unit", price_unit: 100, price_subtotal: 300, taxes: [], analytic: [] }]
      : []),
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
    computation_status: "lc_odoo_done",
    ...overrides,
  });
}

let tick = 0;
const signoff = (ipasId, section, role, signedBy, over = {}) =>
  db.seed("ipas_signoffs", {
    ipas_id: ipasId,
    section,
    role,
    signed_by: signedBy.id,
    signed_at: `2026-10-13T0${(tick += 1) % 10}:00:00.000Z`,
    ...over,
  });
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

describe("IPAS section 7 and Filing", () => {
  let purchaser, boss, receiver, noter, checker, superAdmin;

  /** Signs in as someone: the page's identity and the stubbed database's. */
  const signIn = (person, opts = {}) => {
    mockUser.current = { ...person, isIpasApprover: true };
    stubIpasRpcs({ actorId: person.id, purchasing: Boolean(person.has_purchasing_flow), ...opts });
  };

  /** Sections 1, 2 and 3 (stored 1, 3 and 6) prepared by the purchaser and approved by the boss. */
  const approvedFirstSections = (row) => {
    signoff(row.id, 1, "prepared", purchaser);
    signoff(row.id, 1, "approved", boss);
    signoff(row.id, 3, "prepared", purchaser);
    signoff(row.id, 3, "approved", boss);
    signoff(row.id, 6, "prepared", purchaser);
    signoff(row.id, 6, "approved", boss);
    // Files attached and Logistics signed: the IPAS is ready for the signers.
    makeReady(row, boss);
  };
  const givenThroughChecked = (row) => {
    signoff(row.id, 7, "received", receiver);
    signoff(row.id, 7, "noted", receiver);
    signoff(row.id, 7, "checked", receiver);
  };
  const quotation = (row, over = {}) => {
    const kind = db.rows("ipas_options").find((o) => o.list === "document_kind" && o.label === "Quotation (Local)");
    return db.seed("ipas_documents", {
      ipas_id: row.id,
      kind_id: kind.id,
      purchasing_has: false,
      finance_has: false,
      ...over,
    });
  };

  beforeEach(() => {
    counter = 48;
    tick = 0;
    toastError.mockClear();
    purchaser = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    boss = makeEmployee({ name: "Boss Lito" });
    receiver = makeEmployee({ name: "Rita Receiver" });
    noter = makeEmployee({ name: "Nina Noter" });
    checker = makeEmployee({ name: "Carl Checker" });
    superAdmin = makeEmployee({ name: "Super Admin", is_super_admin: true });
    seedIpasOptions((table, row) => db.seed(table, row));
    onList("s1_approved", boss);
    onList("s3_approved", boss);
    onList("s7_received", receiver);
    onList("s7_noted", noter);
    onList("s7_checked", checker);
    onList("s7_approved", boss);
    signIn(purchaser);
    stubEdgeFunction("odoo-po-ipas", (body) => ({ success: true, found: true, ...poCopy(body.poNumber) }));
  });

  describe("on the IPAS page", () => {
    const step = async (key) => within(await screen.findByRole("region", { name: "Your move" })).findByTestId(`ipas-journey-${key}`);
    const live7 = () => db.rows("ipas_signoffs").filter((s) => s.section === 7 && !s.cleared_at);

    it("shows Check waiting for Order, Payments, Costs and Logistics, with nothing to give", async () => {
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);
      signoff(row.id, 1, "approved", boss);
      signIn(receiver);

      renderDetail(row.id, "signoffs");

      const check = await step("check");
      expect(check).toHaveTextContent("waiting");
      expect(within(check).queryByRole("button")).not.toBeInTheDocument();
      const section = await screen.findByRole("region", { name: "6 · Sign-offs" });
      expect(within(section).queryByRole("button", { name: /^(Review and|Send back|Receive|Note|Check)/ })).not.toBeInTheDocument();
    });

    it("offers Check to anyone on the Received, Noted or Checked list, and one press gives all three", async () => {
      const row = ipas();
      approvedFirstSections(row);
      signIn(receiver);
      const user = setupUser();

      renderDetail(row.id);
      expect(within(await step("check")).getByRole("button", { name: "Go to sign-off" })).toBeInTheDocument();
      expect(within(await step("file")).queryByRole("button")).not.toBeInTheDocument();

      await openSignReview(user, "check");
      const dialog = await screen.findByRole("dialog", { name: "Check" });
      expect(within(dialog).getByText(/it goes to the filing approver/)).toBeInTheDocument();
      expect(live7()).toHaveLength(0);
      await user.click(within(dialog).getByRole("button", { name: "Check" }));

      await waitFor(() => expect(live7().map((s) => s.role).sort()).toEqual(["checked", "noted", "received"]));
      expect(live7().every((s) => s.signed_by === receiver.id)).toBe(true);
      await waitFor(() => expect(screen.getByTestId("ipas-journey-check")).toHaveTextContent("Checked by Rita Receiver."));
      expect(within(screen.getByTestId("ipas-journey-check")).queryByRole("button")).not.toBeInTheDocument();
      await waitForNetworkIdle();
      expect(db.rows("notifications").filter((n) => n.type === "IPAS_SECTION_7_READY").map((n) => n.recipient_id)).toEqual([boss.id]);
    });

    it("lets a Filing signer send the Check back with a reason, and tells who gave it", async () => {
      const row = ipas();
      approvedFirstSections(row);
      givenThroughChecked(row);
      signIn(noter);
      const user = setupUser();

      renderDetail(row.id);
      await user.click(await within(await screen.findByRole("region", { name: "Your move" })).findByRole("button", { name: "Send back…" }));

      const dialog = await screen.findByRole("dialog", { name: "Return section 6?" });
      const submit = within(dialog).getByRole("button", { name: "Return" });
      expect(submit).toBeDisabled();
      await user.type(within(dialog).getByPlaceholderText(/What needs fixing before it is filed/), "Landed cost is off");
      await user.click(submit);

      await waitFor(() => expect(live7()).toHaveLength(0));
      const cleared = db.rows("ipas_signoffs").filter((s) => s.section === 7);
      expect(cleared.map((s) => s.role).sort()).toEqual(["checked", "noted", "received"]);
      expect(cleared.every((s) => s.cleared_reason === "Returned: Landed cost is off")).toBe(true);
      // Checked is open again for the lists, and nobody has checked it.
      await waitFor(() => expect(screen.getByTestId("ipas-journey-check")).not.toHaveTextContent("Checked by"));
      await waitForNetworkIdle();
      expect(db.rows("notifications").filter((n) => n.type === "IPAS_SENT_BACK").map((n) => n.recipient_id)).toEqual([receiver.id]);
    });

    it("offers no Send back before Check, to someone on no list, or on a filed IPAS", async () => {
      const sendBack = /^Send back…/;
      const early = ipas();
      approvedFirstSections(early);
      signIn(noter);
      const { unmount } = renderDetail(early.id);
      const region = await screen.findByRole("region", { name: "Your move" });
      expect(within(region).queryByRole("button", { name: sendBack })).not.toBeInTheDocument();
      unmount();

      const given = ipas();
      approvedFirstSections(given);
      signoff(given.id, 7, "received", receiver);
      signIn(superAdmin, { superAdmin: true });
      const second = renderDetail(given.id);
      const region2 = await screen.findByRole("region", { name: "Your move" });
      expect(within(region2).queryByRole("button", { name: sendBack })).not.toBeInTheDocument();
      second.unmount();

      const filed = ipas({ state: "filed", filed_at: "2026-10-14T00:00:00.000Z" });
      approvedFirstSections(filed);
      givenThroughChecked(filed);
      signoff(filed.id, 7, "approved", boss);
      signIn(noter);
      renderDetail(filed.id);
      await screen.findByTestId("ipas-filed-notice");
      expect(within(await screen.findByRole("region", { name: "Your move" })).queryByRole("button", { name: sendBack })).not.toBeInTheDocument();
    });

    it("offers a person on neither list nothing, and a Super Admin off the lists the same", async () => {
      const row = ipas();
      approvedFirstSections(row);
      signIn(superAdmin, { superAdmin: true });

      renderDetail(row.id);

      const region = await screen.findByRole("region", { name: "Your move" });
      expect(await step("check")).toHaveTextContent("waiting");
      expect(within(region).queryByRole("button", { name: /^(Review and|Send back|Undo approval)/ })).not.toBeInTheDocument();
    });

    it("holds Approve and file until Landed Cost is final, and says what it waits on", async () => {
      const row = ipas({ computation_status: "encoded" });
      approvedFirstSections(row);
      givenThroughChecked(row);
      signIn(boss);

      renderDetail(row.id);

      const file = await step("file");
      expect(within(file).queryByRole("button", { name: "Go to sign-off" })).not.toBeInTheDocument();
      expect(file).toHaveTextContent("waiting");
      expect(screen.getByTestId("ipas-journey-headline")).toHaveTextContent("Getting it ready. Waiting on Purchasing: Mark Landed Cost final.");
    });

    it("reads the final form first, and files on the one press", async () => {
      const row = ipas();
      approvedFirstSections(row);
      givenThroughChecked(row);
      signIn(boss);
      const user = setupUser();

      renderDetail(row.id);
      await openSignReview(user, "file");

      const dialog = await screen.findByRole("dialog", { name: "Approve and file" });
      expect(within(dialog).getByText(/the IPAS is filed and frozen/)).toBeInTheDocument();
      expect(db.rows("ipas").find((r) => r.id === row.id).state).toBe("open");
      await user.click(within(dialog).getByRole("button", { name: "Approve and file" }));

      await waitFor(() => expect(screen.getByTestId("ipas-filed-notice")).toBeInTheDocument());
      expect(db.rows("ipas").find((r) => r.id === row.id)).toMatchObject({ state: "filed" });
      expect(toastError).not.toHaveBeenCalled();
    });

    it("words the database's refusal in a sentence when Filing is refused", async () => {
      const row = ipas();
      approvedFirstSections(row);
      givenThroughChecked(row);
      signIn(boss);
      const user = setupUser();

      renderDetail(row.id);
      await openSignReview(user, "file");
      const dialog = await screen.findByRole("dialog", { name: "Approve and file" });
      // The page still reads Landed Cost as final; the status moves underneath it.
      db.internal.rowsOf("ipas").find((r) => r.id === row.id).computation_status = "encoding";
      await user.click(within(dialog).getByRole("button", { name: "Approve and file" }));

      // The refusal stays in the window beside the button.
      const alert = await within(dialog).findByRole("alert");
      expect(alert).toHaveTextContent(/can't be filed until LC Odoo Done/);
      expect(alert.textContent).not.toMatch(/ipas_sign|55000/);
      expect(db.rows("ipas").find((r) => r.id === row.id).state).toBe("open");
    });
  });

  describe("a filed IPAS", () => {
    const filedRow = (over = {}) => {
      const row = ipas({ state: "filed", filed_at: "2026-10-14T00:00:00.000Z", ...over });
      approvedFirstSections(row);
      givenThroughChecked(row);
      signoff(row.id, 7, "approved", boss);
      return row;
    };

    it("says it is filed and offers no edit, tick or sign-off", async () => {
      const row = filedRow();
      signIn(purchaser);

      renderDetail(row.id, "signoffs");

      const notice = await screen.findByTestId("ipas-filed-notice");
      expect(within(notice).getByText(/^Filed /)).toBeInTheDocument();
      expect(within(notice).getByText(/approved by Boss Lito/)).toBeInTheDocument();
      expect(within(notice).queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancel IPAS" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Purpose and SORs" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add payment|Add charge/ })).not.toBeInTheDocument();
      const region = await screen.findByRole("region", { name: "Your move" });
      expect(within(region).queryAllByRole("button")).toHaveLength(0);
      expect(within(screen.getByRole("region", { name: "6 · Sign-offs" })).queryByRole("button", { name: /^(Edit section|Review and|Send back|Undo)/ })).not.toBeInTheDocument();
      // The header badge and the Sign-offs row both say so.
      expect(screen.getAllByText("Filed").length).toBeGreaterThanOrEqual(2);
    });

    it("shows 'Odoo has changed since filing' and leaves the filed copy as it was", async () => {
      // Odoo has a second line now; the filed copy has one.
      stubEdgeFunction("odoo-po-ipas", (body) => ({ success: true, found: true, ...poCopy(body.poNumber, true) }));
      const row = filedRow();
      signIn(purchaser);

      renderDetail(row.id);

      expect(await screen.findByText("Odoo has changed since filing", { selector: "p" })).toBeInTheDocument();
      expect(screen.getByText("The filed copy below is unchanged.")).toBeInTheDocument();
      const stored = db.rows("ipas").find((r) => r.id === row.id);
      expect(stored.odoo_copy.lines).toHaveLength(1);
      expect(stored.state).toBe("filed");
      expect(screen.queryByText("Spare blade")).not.toBeInTheDocument();
    });

    it("writes Filing, a reopening and an Odoo change since filing into History in words", async () => {
      const row = filedRow();
      db.seed("ipas_events", [
        { ipas_id: row.id, actor_id: boss.id, kind: "filed", detail: { computation_status: "lc_odoo_done" } },
        {
          ipas_id: row.id,
          actor_id: purchaser.id,
          kind: "odoo_changed_since_filing",
          detail: { note: { added: [{ line_id: 12 }], removed: [], changed: [] } },
        },
        {
          ipas_id: row.id,
          actor_id: superAdmin.id,
          kind: "reopened",
          detail: { reason: "Charges were misread", cleared: ["approved", "checked"] },
        },
      ]);
      signIn(purchaser);

      renderDetail(row.id, "history");

      expect(await screen.findByText("Section 6 · Sign-offs approved · LC Odoo Done")).toBeInTheDocument();
      expect(screen.getByText("1 added")).toBeInTheDocument();
      expect(screen.getByText("“Charges were misread” · cleared section 6 · Sign-offs: approved, checked")).toBeInTheDocument();
    });

    it("lets a Super Admin reopen it with a required reason, and the edit controls come back", async () => {
      const row = filedRow();
      signIn(superAdmin, { superAdmin: true });
      const user = setupUser();

      renderDetail(row.id);
      await user.click(await within(await screen.findByTestId("ipas-filed-notice")).findByRole("button", { name: "Reopen" }));

      const dialog = await findOtherDialog();
      const submit = within(dialog).getByRole("button", { name: "Reopen" });
      expect(submit).toBeDisabled();
      await user.type(within(dialog).getByPlaceholderText(/Why is this filed IPAS being reopened/), "Charges were misread");
      await user.click(submit);

      await waitFor(() => expect(screen.queryByTestId("ipas-filed-notice")).not.toBeInTheDocument());
      expect(db.rows("ipas").find((r) => r.id === row.id)).toMatchObject({ state: "open", filed_at: null });
      const cleared = db.rows("ipas_signoffs").filter((s) => s.cleared_at);
      expect(cleared.map((s) => s.role).sort()).toEqual(["approved", "checked", "noted", "received"]);
      expect(cleared.every((s) => s.cleared_reason === "Reopened: Charges were misread")).toBe(true);
      // Sections 1, 2 and 3 stay approved; Check and Approve and file start again.
      const rail = await screen.findByRole("region", { name: "Your move" });
      expect(within(rail).getByTestId("ipas-journey-approve")).toHaveTextContent("Approved.");
      expect(within(rail).getByTestId("ipas-journey-check")).not.toHaveTextContent("Checked by");
      expect(within(rail).getByTestId("ipas-journey-file")).not.toHaveTextContent("Filed by");
    });
  });

  describe("the Approval Center queue", () => {
    const renderQueue = () =>
      renderWithProviders(
        <MemoryRouter initialEntries={["/approvals/ipas"]}>
          <Routes>
            <Route path="/approvals/ipas" element={<IpasSignoffsQueuePage />} />
            <Route path="/purchasing/ipas/:id" element={<p>The IPAS page</p>} />
            <Route path="/" element={<p>Home</p>} />
          </Routes>
        </MemoryRouter>,
      );

    it("lists section 7's Received for its list and gives it from the row", async () => {
      const row = ipas();
      approvedFirstSections(row);
      signIn(receiver);
      const user = setupUser();

      renderQueue();
      await user.click(await screen.findByRole("button", { name: `Receive ${row.number} section 6` }));

      await waitFor(() => expect(screen.getByText("Nothing waiting on you right now")).toBeInTheDocument());
      expect(db.rows("ipas_signoffs").filter((s) => s.section === 7).map((s) => s.role)).toEqual(["received"]);
    });

    it("offers no Return on a section 7 step", async () => {
      const row = ipas();
      approvedFirstSections(row);
      signIn(receiver);

      renderQueue();

      await screen.findByRole("button", { name: `Receive ${row.number} section 6` });
      expect(screen.queryByRole("button", { name: /^Return/ })).not.toBeInTheDocument();
    });

    it("offers Return on a section 7 step once Received is given, and returns the section", async () => {
      const row = ipas();
      approvedFirstSections(row);
      signoff(row.id, 7, "received", receiver);
      signIn(noter);
      const user = setupUser();

      renderQueue();
      await user.click(await screen.findByRole("button", { name: `Return ${row.number} section 6` }));

      const dialog = await findOtherDialog();
      await user.type(within(dialog).getByPlaceholderText(/What needs fixing before it is filed/), "Wrong supplier");
      await user.click(within(dialog).getByRole("button", { name: "Return" }));

      await waitFor(() => expect(db.rows("ipas_signoffs").filter((s) => s.section === 7 && !s.cleared_at)).toHaveLength(0));
      expect(db.rows("ipas_signoffs").find((s) => s.role === "received")).toMatchObject({
        cleared_reason: "Returned: Wrong supplier",
        cleared_by: noter.id,
      });
    });

    it("asks before filing from the row, listing what isn't ticked", async () => {
      const row = ipas();
      approvedFirstSections(row);
      givenThroughChecked(row);
      quotation(row);
      signIn(boss);
      const user = setupUser();

      renderQueue();
      await user.click(await screen.findByRole("button", { name: `Approve ${row.number} section 6` }));

      const dialog = await findOtherDialog();
      expect(await within(dialog).findByTestId("ipas-filing-warnings")).toBeInTheDocument();
      expect(db.rows("ipas").find((r) => r.id === row.id).state).toBe("open");
      await user.click(within(dialog).getByRole("button", { name: "File anyway" }));

      await waitFor(() => expect(screen.getByText("Nothing waiting on you right now")).toBeInTheDocument());
      expect(db.rows("ipas").find((r) => r.id === row.id).state).toBe("filed");
    });

    it("opens a review sheet that names the step and has no Return before Received", async () => {
      const row = ipas();
      approvedFirstSections(row);
      signIn(receiver);
      const user = setupUser();

      renderQueue();
      await user.click(await screen.findByText("Scorpe Technologies"));

      const sheet = await findOtherDialog();
      expect(within(sheet).getByText("Your step")).toBeInTheDocument();
      expect(within(sheet).getByText("Gave the sign-off before yours")).toBeInTheDocument();
      expect(within(sheet).getByRole("button", { name: "Receive" })).toBeInTheDocument();
      expect(within(sheet).queryByRole("button", { name: "Return" })).not.toBeInTheDocument();
    });
  });
});
