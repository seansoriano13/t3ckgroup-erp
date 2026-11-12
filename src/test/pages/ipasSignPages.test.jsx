import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, RouterProvider, createMemoryRouter } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubEdgeFunction } from "@/test/msw/server";
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc";
import { makeReady } from "@/test/support/ipasReady";
import { openSignReview } from "@/test/support/ipasSignRow";
import { queryOtherDialog } from "@/test/support/dialogs";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

/**
 * Signing with the evidence in view: the sections only read (and edit in place); every
 * sign-off is given from the rail's "Sign the final IPAS", after reading the final form
 * in a window, and one press signs everything the viewer may sign. A refusal stays in
 * that window beside its button; a Send back asks in its own dialog; after a sign-off the
 * rail names the next IPAS waiting for the viewer.
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

let counter = 80;
function ipas(overrides = {}) {
  counter += 1;
  const po = overrides.po_number ?? `P0${3700 + counter}`;
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
  db.seed("ipas_signoffs", { ipas_id: ipasId, section, role, signed_by: signedBy.id, signed_at: "2026-09-05T06:40:00.000Z", ...over });
const onList = (listKey, ...people) => people.forEach((p) => db.seed("ipas_signer_lists", { list_key: listKey, employee_id: p.id }));
const rowOf = (id) => db.rows("ipas").find((r) => r.id === id);
const live = (role) => db.rows("ipas_signoffs").filter((s) => s.role === role && !s.cleared_at);

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

/** The same page under a data router, so the test can navigate Back. */
function renderRouted(id) {
  const router = createMemoryRouter(
    [
      { path: "/purchasing/ipas/:id", element: <IpasDetailPage /> },
      { path: "/purchasing/ipas", element: <p>The IPAS list</p> },
    ],
    { initialEntries: [`/purchasing/ipas/${id}`] },
  );
  renderWithProviders(<RouterProvider router={router} />);
  return router;
}

const yourMove = () => screen.findByRole("region", { name: "Your move" });
const step = async (key) => within(await yourMove()).findByTestId(`ipas-journey-${key}`);

/** Stubs the wide breakpoint (xl, 1280px) on: jsdom reports no match, which collapses the card. */
function stubWide() {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: true && !/max-/.test(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("IPAS signing with the evidence in view", () => {
  let purchaser, approver, other;

  const originalMatchMedia = window.matchMedia;

  const signIn = (person, opts = {}) => {
    mockUser.current = person;
    stubIpasRpcs({ actorId: person.id, purchasing: Boolean(person.has_purchasing_flow), ...opts });
  };

  /** Everything ready (files, Landed Cost final, Logistics signed), not yet sent. */
  const readyIpas = (overrides = {}) => {
    const row = ipas({ computation_status: "lc_odoo_done", ...overrides });
    makeReady(row, approver);
    return row;
  };
  /** Ready, and sent for signing by the purchaser (sections 1, 2 and 3 prepared). */
  const sentIpas = (overrides = {}) => {
    const row = readyIpas(overrides);
    signoff(row.id, 1, "prepared", purchaser);
    signoff(row.id, 3, "prepared", purchaser);
    signoff(row.id, 6, "prepared", purchaser);
    return row;
  };

  beforeEach(() => {
    counter = 80;
    stubWide();
    purchaser = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    approver = makeEmployee({ name: "Boss Lito" });
    other = makeEmployee({ name: "Co Approver" });
    seedIpasOptions((table, row) => db.seed(table, row));
    onList("s1_approved", approver);
    signIn(purchaser);
    stubEdgeFunction("odoo-po-ipas", (body) => ({ success: true, found: true, ...poCopy(body.poNumber) }));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  describe("the section blocks", () => {
    it("keeps signing out of the sections: they only read, and the foot holds Edit section", async () => {
      const row = readyIpas();
      renderDetail(row.id, "order");

      const section = await screen.findByRole("region", { name: "1 · Order" });
      expect(within(section).queryByRole("button", { name: /^(Submit|Approve|Send for signing|Review and)/ })).not.toBeInTheDocument();
      expect(within(section).getByRole("button", { name: "Edit section" })).toBeInTheDocument();
      // Signing starts in the rail.
      expect(within(await step("send")).getByRole("button", { name: "Go to sign-off" })).toBeInTheDocument();
    });

    it("lists the four sign-offs in the Sign-offs section, with who gives each, and no give buttons: the rail has them", async () => {
      const row = readyIpas();
      onList("s7_received", approver);
      signoff(row.id, 1, "prepared", purchaser);
      signoff(row.id, 1, "approved", approver);
      signoff(row.id, 3, "prepared", purchaser);
      signoff(row.id, 3, "approved", approver);
      signoff(row.id, 6, "prepared", purchaser);
      signoff(row.id, 6, "approved", approver);
      signIn(approver);
      renderDetail(row.id, "signoffs");

      const section = await screen.findByRole("region", { name: "6 · Sign-offs" });
      expect(within(section).getByText("Send for signing")).toBeInTheDocument();
      expect(within(section).getByText("Sent by Buyer.")).toBeInTheDocument();
      expect(within(section).getByText("Check")).toBeInTheDocument();
      expect(within(section).getByText("Approve and file")).toBeInTheDocument();
      expect(within(section).queryByRole("button", { name: /^(Receive|Note|Check|Review and)/ })).not.toBeInTheDocument();
      expect(within(await step("check")).getByRole("button", { name: "Go to sign-off" })).toBeInTheDocument();
    });

    it("gives History no moves and no Edit section: it expands under its row", async () => {
      const row = ipas();
      renderDetail(row.id, "history");

      const trigger = await screen.findByRole("button", { name: /^History/ });
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(queryOtherDialog()).not.toBeInTheDocument();
      const section = trigger.closest("li");
      expect(within(section).queryByRole("button", { name: /^Submit|^Approve|^Send back|^Undo|^Edit section/ })).not.toBeInTheDocument();
    });

    it("shows the money read-only until Edit section, with no add or edit control", async () => {
      const row = ipas();
      renderDetail(row.id, "payments");

      const section = await screen.findByRole("region", { name: "2 · Payments" });
      expect(within(section).queryByRole("button", { name: "Add payment" })).not.toBeInTheDocument();
      expect(within(section).getByRole("button", { name: "Edit section" })).toBeInTheDocument();
    });

    it("offers no Edit section to a viewer with no edit rights on the section", async () => {
      const row = ipas();
      signIn(approver);
      renderDetail(row.id, "order");
      const section = await screen.findByRole("region", { name: "1 · Order" });
      expect(within(section).queryByRole("button", { name: "Edit section" })).not.toBeInTheDocument();
    });

    it("Edit section types in place, with the tables editable, and Done comes back to that section, open", async () => {
      const row = ipas();
      renderDetail(row.id, "payments");
      const user = setupUser();

      const section = await screen.findByRole("region", { name: "2 · Payments" });
      await user.click(within(section).getByRole("button", { name: "Edit section" }));

      expect(await screen.findByRole("button", { name: "Add payment" })).toBeInTheDocument();
      // No dialog and no separate page: the rail stays.
      expect(queryOtherDialog()).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Your move" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Done" }));
      expect(await screen.findByRole("button", { name: /^2 · Payments/ })).toHaveAttribute("aria-expanded", "true");
      expect(screen.queryByRole("button", { name: "Add payment" })).not.toBeInTheDocument();
    });

    it("Edit section, then Back, lands on the overview with the section's header focused", async () => {
      const row = ipas();
      const router = renderRouted(row.id);
      const user = setupUser();

      await user.click(await screen.findByRole("button", { name: /^1 · Order/ }));
      const section = await screen.findByRole("region", { name: "1 · Order" });
      await user.click(within(section).getByRole("button", { name: "Edit section" }));
      await screen.findByRole("button", { name: "Done" });
      expect(router.state.location.search).toBe("?edit=order");

      await act(() => router.navigate(-1));
      await waitFor(() => expect(router.state.location.search).toBe(""));
      expect(await screen.findByRole("button", { name: /^1 · Order/ })).toHaveFocus();
      expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    });

    it("a failed change while editing shows its error in the bar, and Retry runs it again", async () => {
      const row = ipas();
      // The page offers the change to Purchasing; the database refuses it for this caller.
      signIn(purchaser, { purchasing: false });
      const router = renderRouted(row.id);
      const user = setupUser();

      await act(() => router.navigate(`/purchasing/ipas/${row.id}?edit=order`));
      await user.type(await screen.findByRole("textbox", { name: /^Remarks/ }), "Rush order");
      await user.click(screen.getByRole("button", { name: /^Save all/ }));
      const alert = await screen.findByRole("alert");
      expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
      expect(rowOf(row.id).remarks ?? null).toBeNull();

      signIn(purchaser);
      await user.click(within(alert).getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(rowOf(row.id).remarks).toBe("Rush order"));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });

    it("Back leaves the edit view for the overview, with the section row focused", async () => {
      const row = ipas();
      const router = renderRouted(row.id);
      await screen.findByRole("button", { name: /^2 · Payments/ });

      await act(() => router.navigate(`/purchasing/ipas/${row.id}?edit=payments`));
      expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
      await act(() => router.navigate(-1));

      await waitFor(() => expect(router.state.location.search).toBe(""));
      expect(await screen.findByRole("button", { name: /^2 · Payments/ })).toHaveFocus();
    });

    it("toggling a section leaves the address alone, so Back leaves the page rather than replaying toggles", async () => {
      const row = ipas();
      const router = renderRouted(row.id);
      const user = setupUser();

      await user.click(await screen.findByRole("button", { name: /^4 · Delivery/ }));
      expect(screen.getByRole("button", { name: /^4 · Delivery/ })).toHaveAttribute("aria-expanded", "true");
      expect(router.state.location.search).toBe("");
    });

    it("has no N of 9 caption", async () => {
      const row = ipas();
      renderDetail(row.id, "order");
      const section = await screen.findByRole("region", { name: "1 · Order" });
      expect(within(section).queryByText(/\d+ of \d+/)).not.toBeInTheDocument();
    });
  });

  describe("the rail", () => {
    it("reads the final form first, names what the press does, and sends all three sections for signing", async () => {
      const row = readyIpas();
      const user = setupUser();
      renderDetail(row.id);

      await openSignReview(user, "send");

      const dialog = await screen.findByRole("dialog", { name: "Send for signing" });
      expect(within(dialog).getByText(/the approvers are told it is ready/)).toBeInTheDocument();
      expect(within(dialog).getByText(/You sign as Buyer\./)).toBeInTheDocument();
      expect(live("prepared")).toHaveLength(0);
      await user.click(within(dialog).getByRole("button", { name: "Send for signing" }));

      await waitFor(() => expect(live("prepared").map((s) => s.section).sort()).toEqual([1, 3, 6]));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Send for signing" })).not.toBeInTheDocument());
    });

    it("approves with one press what the viewer's lists allow, and leaves the rest to their approvers", async () => {
      onList("s3_approved", approver);
      const row = sentIpas();
      signIn(approver);
      renderDetail(row.id);
      const user = setupUser();

      await openSignReview(user, "approve");
      const dialog = await screen.findByRole("dialog", { name: "Approve" });
      expect(within(dialog).getByText(/you approve the sections on your list; the rest wait for their approvers/)).toBeInTheDocument();
      expect(within(dialog).getByText(/You sign as Boss Lito\./)).toBeInTheDocument();
      expect(live("approved").filter((s) => s.section !== 8)).toEqual([]);

      await user.click(within(dialog).getByRole("button", { name: "Approve" }));
      await waitFor(() => expect(live("approved").filter((s) => s.section !== 8).map((s) => s.section).sort()).toEqual([1, 3]));
    });

    it("cancelling the window signs nothing", async () => {
      const row = sentIpas();
      signIn(approver);
      renderDetail(row.id);
      const user = setupUser();

      await openSignReview(user, "approve");
      const dialog = await screen.findByRole("dialog", { name: "Approve" });
      await user.click(within(dialog).getByRole("button", { name: "Not yet" }));

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Approve" })).not.toBeInTheDocument());
      expect(live("approved").filter((s) => s.section !== 8)).toEqual([]);
    });

    it("marks Landed Cost final from its item with no question, and the status changes", async () => {
      const row = ipas({ computation_status: "lc_gs_done" });
      renderDetail(row.id);
      const user = setupUser();

      await user.click(within(await step("landed")).getByRole("button", { name: "Mark Landed Cost final" }));
      // No question first.
      expect(queryOtherDialog()).not.toBeInTheDocument();

      await waitFor(() => expect(rowOf(row.id).computation_status).toBe("lc_odoo_done"));
      await waitFor(() => expect(within(screen.getByTestId("ipas-journey-landed")).queryByRole("button")).not.toBeInTheDocument());
    });

    it("a refused sign-off keeps its error in the window beside the button, and pressing again signs", async () => {
      const row = sentIpas();
      // The page thinks the viewer may approve; the database says they aren't on the list.
      signIn(approver, { actorId: other.id });
      renderDetail(row.id);
      const user = setupUser();

      await openSignReview(user, "approve");
      const dialog = await screen.findByRole("dialog", { name: "Approve" });
      await user.click(within(dialog).getByRole("button", { name: "Approve" }));

      const alert = await within(dialog).findByRole("alert");
      expect(alert).toHaveTextContent(/you are not on the list that may give this sign-off/i);
      expect(live("approved").filter((s) => s.section !== 8)).toEqual([]);

      // The database accepts the viewer now; pressing the button again runs the sign-off again.
      signIn(approver);
      await user.click(within(dialog).getByRole("button", { name: "Approve" }));

      await waitFor(() => expect(live("approved").filter((s) => s.section !== 8)).toHaveLength(1));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Approve" })).not.toBeInTheDocument());
    });

    it("a failed send back closes the dialog at once, puts the section back with the error and Retry, and Retry returns it", async () => {
      const row = sentIpas();
      // The page offers the return; the database says the viewer isn't on the list.
      signIn(approver, { actorId: other.id });
      renderDetail(row.id);
      const user = setupUser();

      await user.click(within(await yourMove()).getByRole("button", { name: "Send back…" }));
      const dialog = await screen.findByRole("dialog", { name: "Return section 1?" });
      await user.type(within(dialog).getByPlaceholderText(/What does the submitter need to fix/), "Wrong supplier");
      await user.click(within(dialog).getByRole("button", { name: "Return" }));

      // UI first: the dialog is gone, the failure is kept on the page with Retry.
      await waitFor(() => expect(queryOtherDialog()).not.toBeInTheDocument());
      const alert = await screen.findByRole("alert");
      expect(db.rows("ipas_signoffs").some((s) => s.cleared_reason)).toBe(false);

      signIn(approver);
      await user.click(within(alert).getByRole("button", { name: "Retry" }));

      await waitFor(() => expect(db.rows("ipas_signoffs").some((s) => s.cleared_reason === "Returned: Wrong supplier")).toBe(true));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });

    it("offers one Undo approval button that asks which section, and makes a hard-to-get Filing sign-off a deliberate click", async () => {
      onList("s3_approved", approver);
      const row = ipas({ created_by: purchaser.id });
      signoff(row.id, 1, "prepared", purchaser);
      signoff(row.id, 1, "approved", approver);
      signoff(row.id, 3, "prepared", purchaser);
      signoff(row.id, 3, "approved", approver);
      signoff(row.id, 7, "received", other);
      signIn(approver);
      renderDetail(row.id);
      const user = setupUser();

      // One button, not one per section.
      const region = await yourMove();
      expect(within(region).queryByRole("button", { name: /^Return section/ })).not.toBeInTheDocument();
      expect(within(region).getAllByRole("button", { name: "Undo approval…" })).toHaveLength(1);
      await user.click(within(region).getByRole("button", { name: "Undo approval…" }));

      const dialog = await screen.findByRole("dialog", { name: "Return or undo an approval" });
      const choices = within(dialog).getAllByRole("radio");
      expect(choices.map((choice) => choice.textContent)).toEqual([
        expect.stringContaining("Undo approval · 1 · Order"),
        expect.stringContaining("Undo approval · 2 · Payments"),
      ]);

      // Filing has begun: what goes with it is named, and needs its own click.
      expect(within(dialog).getByText("6 · Sign-offs: Received by Co Approver")).toBeInTheDocument();
      const submit = within(dialog).getByRole("button", { name: "Undo approval" });
      await user.type(within(dialog).getByPlaceholderText(/Why is this approval being taken back/), "Wrong PO");
      expect(submit).toBeDisabled();
      await user.click(within(dialog).getByRole("checkbox", { name: /They will have to be given again/ }));
      expect(submit).toBeEnabled();
      await user.click(submit);

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Return or undo an approval" })).not.toBeInTheDocument());
      await waitFor(() =>
        expect(db.rows("ipas_signoffs").filter((r) => !r.cleared_at).map((r) => `${r.section}/${r.role}`).sort()).toEqual([
          "1/prepared",
          "3/approved",
          "3/prepared",
        ]),
      );
      const received = db.rows("ipas_signoffs").find((r) => r.section === 7 && r.role === "received");
      expect(received.cleared_reason).toBe("Section 1 approval undone: Wrong PO");
    });

    it("asks for no second click when Filing had not begun", async () => {
      const row = sentIpas({ created_by: purchaser.id });
      signIn(approver);
      renderDetail(row.id);
      const user = setupUser();

      await user.click(within(await yourMove()).getByRole("button", { name: "Send back…" }));
      const dialog = await screen.findByRole("dialog", { name: "Return section 1?" });
      expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
      expect(within(dialog).queryByText(/hard to get again/)).not.toBeInTheDocument();
    });

    it("names the next IPAS waiting for the viewer after a sign-off, and none when there is none", async () => {
      signIn(approver);
      const first = sentIpas();
      const second = sentIpas();
      renderDetail(first.id);
      const user = setupUser();

      expect(screen.queryByRole("link", { name: /Next IPAS waiting for me/ })).not.toBeInTheDocument();
      await openSignReview(user, "approve");
      await user.click(within(await screen.findByRole("dialog", { name: "Approve" })).getByRole("button", { name: "Approve" }));

      const link = await screen.findByRole("link", { name: `Next IPAS waiting for me: ${second.number}` });
      expect(link).toHaveAttribute("href", `/purchasing/ipas/${second.id}`);
    });

    it("shows no next link when the viewer has nothing else waiting", async () => {
      signIn(approver);
      const only = sentIpas();
      renderDetail(only.id);
      const user = setupUser();

      await openSignReview(user, "approve");
      await user.click(within(await screen.findByRole("dialog", { name: "Approve" })).getByRole("button", { name: "Approve" }));

      await waitFor(() => expect(live("approved").filter((s) => s.section !== 8)).toHaveLength(1));
      expect(screen.queryByRole("link", { name: /Next IPAS waiting for me/ })).not.toBeInTheDocument();
    });

    it("following Next IPAS leaves no failure of the last IPAS behind: no alert, and no stale Retry", async () => {
      signIn(approver);
      const first = sentIpas();
      const second = sentIpas();
      renderDetail(first.id);
      const user = setupUser();

      // A sign-off on the first IPAS succeeds, which names the second as the next one waiting.
      await openSignReview(user, "approve");
      await user.click(within(await screen.findByRole("dialog", { name: "Approve" })).getByRole("button", { name: "Approve" }));
      await screen.findByRole("link", { name: `Next IPAS waiting for me: ${second.number}` });

      // A failed undo on the first IPAS leaves its error on the page.
      signIn(approver, { actorId: other.id });
      await user.click(await within(await yourMove()).findByRole("button", { name: "Undo approval…" }));
      const returning = await screen.findByRole("dialog", { name: "Undo approval of section 1?" });
      await user.type(within(returning).getByPlaceholderText(/Why is this approval being taken back/), "Wrong supplier");
      await user.click(within(returning).getByRole("button", { name: "Undo approval" }));
      expect(await screen.findByRole("alert")).toBeInTheDocument();

      await user.click(screen.getByRole("link", { name: `Next IPAS waiting for me: ${second.number}` }));
      await waitFor(() => expect(screen.getByRole("heading", { name: second.number })).toBeInTheDocument());
      const region = await yourMove();
      // The second IPAS offers its own sign-off, but shows none of the first one's failure.
      await within(region).findByRole("button", { name: "Go to sign-off" });
      expect(within(region).queryByRole("alert")).not.toBeInTheDocument();
      expect(within(region).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });
  });

  // Section 3 (stored 6) is still a sign-off of its own, shown as section 3.
  describe("section 3, the Costs sign-off", () => {
    it("opens Send for signing only once Landed Cost is final", async () => {
      const early = ipas({ computation_status: "lc_gs_done" });
      makeReady(early, approver);
      const view = renderDetail(early.id);
      expect(await within(await yourMove()).findByTestId("ipas-journey-landed")).toHaveTextContent("Mark Landed Cost final");
      expect(within(await yourMove()).queryByRole("button", { name: "Go to sign-off" })).not.toBeInTheDocument();
      view.unmount();

      const ready = readyIpas();
      renderDetail(ready.id);
      expect(await within(await step("send")).findByRole("button", { name: "Go to sign-off" })).toBeInTheDocument();
    });

    it("lets a section 3 list member approve it, but not the person who sent it", async () => {
      const row = sentIpas();
      onList("s6_approved", approver, purchaser);

      signIn(purchaser);
      const mine = renderDetail(row.id);
      const own = await step("approve");
      expect(within(own).queryByRole("button", { name: "Go to sign-off" })).not.toBeInTheDocument();
      expect(own).toHaveTextContent("Buyer sent it, so someone else on the list approves it.");
      mine.unmount();

      signIn(approver);
      renderDetail(row.id);
      const user = setupUser();
      await openSignReview(user, "approve");
      const dialog = await screen.findByRole("dialog", { name: "Approve" });
      await user.click(within(dialog).getByRole("button", { name: "Approve" }));
      await waitFor(() => expect(db.rows("ipas_signoffs").filter((s) => s.section === 6 && s.role === "approved")).toHaveLength(1));
    });

    it("reads who sent it and that it is approved, in the Sign-offs section's list", async () => {
      const row = readyIpas();
      signoff(row.id, 1, "prepared", purchaser);
      signoff(row.id, 3, "prepared", purchaser);
      signoff(row.id, 6, "prepared", purchaser);
      signoff(row.id, 1, "approved", approver);
      signoff(row.id, 3, "approved", approver);
      signoff(row.id, 6, "approved", approver);
      renderDetail(row.id, "signoffs");

      const section = await screen.findByRole("region", { name: "6 · Sign-offs" });
      expect(within(section).getByText("Sent by Buyer.")).toBeInTheDocument();
      expect(within(section).getByText("Approved.")).toBeInTheDocument();
    });
  });
});
