import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { MemoryRouter, Route, Routes, RouterProvider, createMemoryRouter } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import { confirmMove, renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubEdgeFunction } from "@/test/msw/server";
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc";
import { queryOtherDialog } from "@/test/support/dialogs"

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

/**
 * Signing with the evidence in view (#532): the drawer's pinned footer carries
 * the viewer's moves and the body only reads; a card move asks first, with a
 * restatement; a failure shows where it was started, with Retry; J and K step
 * between sections and Back closes the drawer; after a sign-off the card names
 * the next IPAS waiting for the viewer.
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

/** Stubs the wide breakpoint (xl, 1280px) on: jsdom reports no match, which collapses the card. */
function stubWide() {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: true,
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
  let toastSpy = null;

  const originalMatchMedia = window.matchMedia;

  const signIn = (person, opts = {}) => {
    mockUser.current = person;
    stubIpasRpcs({ actorId: person.id, purchasing: Boolean(person.has_purchasing_flow), ...opts });
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
    toastSpy?.mockRestore();
    toastSpy = null;
  });

  describe("the section blocks", () => {
    it("keeps Submit out of the section: the body only reads, and the foot holds Edit section", async () => {
      const row = ipas();
      renderDetail(row.id, "purchasing");

      const drawer = await screen.findByRole("region", { name: "1 · Purchasing" });
      const body = within(drawer).getByTestId("ipas-signoffs-1");
      expect(within(body).queryByRole("button")).not.toBeInTheDocument();
      expect(within(body).getByText("Not submitted")).toBeInTheDocument();

      // Submit lives only in Your move; the section keeps its Edit section button.
      expect(within(drawer).queryByRole("button", { name: /^Submit/ })).not.toBeInTheDocument();
      expect(within(drawer).getByRole("button", { name: "Edit section" })).toBeInTheDocument();
      expect(within(await yourMove()).getByRole("button", { name: "Submit section 1" })).toBeInTheDocument();
    });

    it("hides the in-body buttons of the filing section, and its footer gives the steps", async () => {
      const row = ipas();
      onList("s7_received", approver);
      signoff(row.id, 1, "prepared", purchaser);
      signoff(row.id, 1, "approved", approver);
      signoff(row.id, 3, "prepared", purchaser);
      signoff(row.id, 3, "approved", approver);
      signoff(row.id, 6, "prepared", purchaser);
      signoff(row.id, 6, "approved", approver);
      signIn(approver);
      renderDetail(row.id, "filing");

      const drawer = await screen.findByRole("region", { name: "4 · Filing" });
      expect(within(drawer).getByTestId("ipas-filing")).toBeInTheDocument();
      expect(within(drawer).queryByTestId("ipas-give-received")).not.toBeInTheDocument();
      expect(within(drawer).getByRole("button", { name: "Receive section 4" })).toBeInTheDocument();
    });

    it("gives History no moves and no Edit section: it expands under its row", async () => {
      const row = ipas();
      renderDetail(row.id, "history");

      const trigger = await screen.findByRole("button", { name: /^History/ });
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(queryOtherDialog()).not.toBeInTheDocument();
      const section = trigger.closest("li");
      expect(within(section).queryByRole("button", { name: /^Submit|^Approve|^Return|^Undo|^Edit section/ })).not.toBeInTheDocument();
    });

    // #533: money reads in the drawer; editing is in the edit view.
    it("shows the money read-only in the drawer, with no add or edit control", async () => {
      const row = ipas();
      renderDetail(row.id, "purchasing");

      const drawer = await screen.findByRole("region", { name: "1 · Purchasing" });
      expect(within(drawer).queryByRole("button", { name: "Add payment" })).not.toBeInTheDocument();
      expect(within(drawer).queryByRole("button", { name: /^Edit P\.I/ })).not.toBeInTheDocument();
      expect(within(drawer).getByRole("button", { name: "Edit section" })).toBeInTheDocument();
    });

    it("offers no Edit section to a viewer with no edit rights on the section", async () => {
      const row = ipas();
      signIn(approver);
      renderDetail(row.id, "purchasing");
      const drawer = await screen.findByRole("region", { name: "1 · Purchasing" });
      expect(within(drawer).queryByRole("button", { name: "Edit section" })).not.toBeInTheDocument();
    });

    it("Edit section opens the edit view with the tables editable, and Back to preview returns to that section, open", async () => {
      const row = ipas();
      renderRouted(row.id);
      const user = setupUser();

      // Section 1 is the one waiting on the purchaser, so it is open on arrival.
      const header = await screen.findByRole("button", { name: /^1 · Purchasing/ });
      await waitFor(() => expect(header).toHaveAttribute("aria-expanded", "true"));
      const drawer = await screen.findByRole("region", { name: "1 · Purchasing" });
      await user.click(within(drawer).getByRole("button", { name: "Edit section" }));

      expect(await screen.findByRole("button", { name: "Add payment" })).toBeInTheDocument();
      expect(queryOtherDialog()).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Your move" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Back to preview" }));
      // The section it was edited from comes back open, with its read-only body.
      expect(await screen.findByRole("button", { name: /^1 · Purchasing/ })).toHaveAttribute("aria-expanded", "true");
      expect(screen.queryByRole("button", { name: "Add payment" })).not.toBeInTheDocument();
    });

    it("Edit section, then Back, lands on the overview with the section's header focused", async () => {
      const row = ipas();
      const router = renderRouted(row.id);
      const user = setupUser();

      const header = await screen.findByRole("button", { name: /^1 · Purchasing/ });
      await waitFor(() => expect(header).toHaveAttribute("aria-expanded", "true"));
      const drawer = await screen.findByRole("region", { name: "1 · Purchasing" });
      await user.click(within(drawer).getByRole("button", { name: "Edit section" }));
      await screen.findByRole("button", { name: "Back to preview" });
      expect(router.state.location.search).toBe("?edit=purchasing");

      await act(() => router.navigate(-1));
      await waitFor(() => expect(router.state.location.search).toBe(""));
      expect(await screen.findByRole("button", { name: /^1 · Purchasing/ })).toHaveFocus();
      expect(queryOtherDialog()).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add payment" })).not.toBeInTheDocument();
    });

    it("a failed change in the edit view shows its error in the view's header, and Retry runs it again", async () => {
      const row = ipas({ computation_status: "encoding" });
      // The page offers the change to Purchasing; the database refuses it for this caller.
      signIn(purchaser, { purchasing: false });
      const router = renderRouted(row.id);
      const user = setupUser();

      await act(() => router.navigate(`/purchasing/ipas/${row.id}?edit=costing`));
      await user.click(await screen.findByRole("button", { name: "Encoded" }));
      await user.click(screen.getByRole("button", { name: /^Save all/ }));
      const alert = await screen.findByRole("alert");
      expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
      expect(rowOf(row.id).computation_status).toBe("encoding");

      signIn(purchaser);
      await user.click(within(alert).getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(rowOf(row.id).computation_status).toBe("encoded"));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });

    it("Back leaves the edit view for the overview, with the section row focused", async () => {
      const row = ipas();
      const router = renderRouted(row.id);
      await screen.findByRole("button", { name: /^2 · Purchasing & Finance/ });

      await act(() => router.navigate(`/purchasing/ipas/${row.id}?edit=finance`));
      expect(await screen.findByRole("button", { name: "Back to preview" })).toBeInTheDocument();
      await act(() => router.navigate(-1));

      await waitFor(() => expect(router.state.location.search).toBe(""));
      expect(await screen.findByRole("button", { name: /^2 · Purchasing & Finance/ })).toHaveFocus();
    });

    it("asks in a dialog that names the section and the signer, then signs from Your move", async () => {
      const row = ipas();
      renderDetail(row.id, "purchasing");
      const user = setupUser();

      await user.click(within(await yourMove()).getByRole("button", { name: "Submit section 1" }));

      const dialog = await screen.findByRole("dialog", { name: "Submit section 1?" });
      expect(within(dialog).getByText(/^You sign/)).toBeInTheDocument();
      expect(db.rows("ipas_signoffs").filter((s) => s.role === "prepared")).toHaveLength(0);
      await user.click(within(dialog).getByRole("button", { name: "Submit" }));

      await waitFor(() => expect(db.rows("ipas_signoffs").filter((s) => s.role === "prepared")).toHaveLength(1));
    });

    it("toggling a section leaves the address alone, so Back leaves the page rather than replaying toggles", async () => {
      const row = ipas();
      const router = renderRouted(row.id);
      const user = setupUser();

      await user.click(await screen.findByRole("button", { name: /^6 · Logistics/ }));
      expect(screen.getByRole("button", { name: /^6 · Logistics/ })).toHaveAttribute("aria-expanded", "true");
      expect(router.state.location.search).toBe("");
    });

    it("has no N of 9 caption", async () => {
      const row = ipas();
      renderDetail(row.id, "purchasing");
      const drawer = await screen.findByRole("region", { name: "1 · Purchasing" });
      expect(within(drawer).queryByText(/\d+ of \d+/)).not.toBeInTheDocument();
    });
  });

  describe("the card", () => {
    it("asks first with the restatement, and signs only after the yes", async () => {
      signIn(approver);
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);
      renderDetail(row.id);
      const user = setupUser();

      const region = await yourMove();
      await user.click(within(region).getByRole("button", { name: "Approve section 1" }));

      const dialog = await screen.findByRole("dialog", { name: "Approve section 1?" });
      expect(within(dialog).getByText("1 line · no payments yet")).toBeInTheDocument();
      expect(within(dialog).getByText("You sign as Boss Lito.")).toBeInTheDocument();
      expect(db.rows("ipas_signoffs").filter((s) => s.role === "approved")).toEqual([]);

      await user.click(within(dialog).getByRole("button", { name: "Approve" }));
      await waitFor(() => expect(db.rows("ipas_signoffs").filter((s) => s.role === "approved")).toHaveLength(1));
    });

    it("cancelling the question signs nothing", async () => {
      signIn(approver);
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);
      renderDetail(row.id);
      const user = setupUser();

      await user.click(within(await yourMove()).getByRole("button", { name: "Approve section 1" }));
      const dialog = await screen.findByRole("dialog", { name: "Approve section 1?" });
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(queryOtherDialog()).not.toBeInTheDocument());
      expect(db.rows("ipas_signoffs").filter((s) => s.role === "approved")).toEqual([]);
    });

    it("offers a Review section link that opens that move's section", async () => {
      const row = ipas();
      renderDetail(row.id);
      const user = setupUser();

      await user.click(within(await yourMove()).getByRole("button", { name: "Review section 1 · Purchasing" }));
      const drawer = await screen.findByRole("region", { name: "1 · Purchasing" });
      expect(within(drawer).getByRole("button", { name: "Edit section" })).toBeInTheDocument();
      expect(within(drawer).queryByRole("button", { name: "Submit section 1" })).not.toBeInTheDocument();
    });

    it("marks the next LC step with no question, toasts with Undo, and Undo restores the status", async () => {
      const row = ipas({ computation_status: "encoded" });
      // No Toaster in the page tests: draw the undoable toast where it is asked for.
      toastSpy = vi.spyOn(toast, "custom").mockImplementation((render) => {
        renderWithProviders(render({ id: "undo", visible: true }));
        return "undo";
      });
      renderDetail(row.id);
      const user = setupUser();

      await user.click(within(await yourMove()).getByRole("button", { name: "Mark LC GS Done" }));
      // Undoable from its toast, so it asks nothing first.
      expect(queryOtherDialog()).not.toBeInTheDocument();

      await waitFor(() => expect(rowOf(row.id).computation_status).toBe("lc_gs_done"));
      expect(toastSpy).toHaveBeenCalled();
      await user.click(await screen.findByRole("button", { name: "Undo" }));

      await waitFor(() => expect(rowOf(row.id).computation_status).toBe("encoded"));
    });

    it("goes on to LC Odoo Done from LC GS Done, which makes Landed Cost final", async () => {
      const row = ipas({ computation_status: "lc_gs_done" });
      toastSpy = vi.spyOn(toast, "custom").mockImplementation((render) => {
        renderWithProviders(render({ id: "undo", visible: true }));
        return "undo";
      });
      renderDetail(row.id);
      const user = setupUser();

      await user.click(within(await yourMove()).getByRole("button", { name: "Mark LC Odoo Done" }));

      await waitFor(() => expect(rowOf(row.id).computation_status).toBe("lc_odoo_done"));
      expect(within(await yourMove()).queryByRole("button", { name: /^Mark LC/ })).not.toBeInTheDocument();
    });

    it("a failed sign-off shows the error under its move, with Retry running it again", async () => {
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);
      // The page thinks the viewer may approve; the database says they aren't on the list.
      signIn(approver, { actorId: other.id });
      renderDetail(row.id);
      const user = setupUser();

      await user.click(within(await yourMove()).getByRole("button", { name: "Approve section 1" }));
      await user.click(within(await screen.findByRole("dialog", { name: "Approve section 1?" })).getByRole("button", { name: "Approve" }));

      const alert = await within(await yourMove()).findByRole("alert");
      expect(alert).toHaveTextContent(/^you are not on the list that may give this sign-off/i);
      expect(db.rows("ipas_signoffs").filter((s) => s.role === "approved")).toEqual([]);

      // The database accepts the viewer now; Retry runs the same sign-off again.
      signIn(approver);
      await user.click(within(alert).getByRole("button", { name: "Retry" }));

      await waitFor(() => expect(db.rows("ipas_signoffs").filter((s) => s.role === "approved")).toHaveLength(1));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });

    it("a failed sign-off from the footer shows the error there, and Dismiss clears it", async () => {
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);
      signIn(approver, { actorId: other.id });
      renderDetail(row.id, "purchasing");
      const user = setupUser();

      const card = await yourMove();
      const drawer = await screen.findByRole("region", { name: "1 · Purchasing" });
      await user.click(within(drawer).getByRole("button", { name: "Approve section 1" }));
      await confirmMove(user, "Approve section 1", "Approve");

      const alert = await within(drawer).findByRole("alert");
      // The failure shows where the move was started: none under Your move.
      expect(card.querySelector('[role="alert"]')).toBeNull();
      await user.click(within(alert).getByRole("button", { name: "Dismiss" }));
      await waitFor(() => expect(within(drawer).queryByRole("alert")).not.toBeInTheDocument());
    });

    it("a failed return closes the dialog at once, puts the section back with the error and Retry, and Retry returns it", async () => {
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);
      // The page offers the return; the database says the viewer isn't on the list.
      signIn(approver, { actorId: other.id });
      renderDetail(row.id);
      const user = setupUser();

      await user.click(within(await yourMove()).getByRole("button", { name: "Return…" }));
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

    it("offers one Return button that asks which section, and makes a hard-to-get section 4 sign-off a deliberate click", async () => {
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
        expect.stringContaining("Undo approval · 1 · Purchasing"),
        expect.stringContaining("Undo approval · 2 · Purchasing & Finance"),
      ]);

      // Section 4 has begun: what goes with it is named, and needs its own click.
      expect(within(dialog).getByText("4 · Filing: Received by Co Approver")).toBeInTheDocument();
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

    it("asks for no second click when section 4 had not begun", async () => {
      const row = ipas({ created_by: purchaser.id });
      signoff(row.id, 1, "prepared", purchaser);
      signIn(approver);
      renderDetail(row.id);
      const user = setupUser();

      await user.click(within(await yourMove()).getByRole("button", { name: "Return…" }));
      const dialog = await screen.findByRole("dialog", { name: "Return section 1?" });
      expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
      expect(within(dialog).queryByText(/hard to get again/)).not.toBeInTheDocument();
    });

    it("names the next IPAS waiting for the viewer after a sign-off, and none when there is none", async () => {
      signIn(approver);
      const first = ipas();
      const second = ipas();
      signoff(first.id, 1, "prepared", purchaser);
      signoff(second.id, 1, "prepared", purchaser);
      renderDetail(first.id);
      const user = setupUser();

      expect(screen.queryByRole("link", { name: /Next IPAS waiting for me/ })).not.toBeInTheDocument();
      await user.click(within(await yourMove()).getByRole("button", { name: "Approve section 1" }));
      await user.click(within(await screen.findByRole("dialog", { name: "Approve section 1?" })).getByRole("button", { name: "Approve" }));

      const link = await screen.findByRole("link", { name: `Next IPAS waiting for me: ${second.number}` });
      expect(link).toHaveAttribute("href", `/purchasing/ipas/${second.id}`);
    });

    it("shows no next link when the viewer has nothing else waiting", async () => {
      signIn(approver);
      const only = ipas();
      signoff(only.id, 1, "prepared", purchaser);
      renderDetail(only.id);
      const user = setupUser();

      await user.click(within(await yourMove()).getByRole("button", { name: "Approve section 1" }));
      await user.click(within(await screen.findByRole("dialog", { name: "Approve section 1?" })).getByRole("button", { name: "Approve" }));

      await waitFor(() => expect(db.rows("ipas_signoffs").filter((s) => s.role === "approved")).toHaveLength(1));
      expect(screen.queryByRole("link", { name: /Next IPAS waiting for me/ })).not.toBeInTheDocument();
    });

    it("following Next IPAS leaves no failure of the last IPAS behind: no alert, and Retry is not carried over", async () => {
      signIn(approver);
      const first = ipas();
      const second = ipas();
      for (const row of [first, second]) {
        signoff(row.id, 1, "prepared", purchaser);
        signoff(row.id, 3, "prepared", purchaser);
      }
      onList("s3_approved", approver);
      renderDetail(first.id);
      const user = setupUser();

      // A sign-off on the first IPAS succeeds, which names the second as the next one waiting.
      await user.click(within(await yourMove()).getByRole("button", { name: "Approve section 1" }));
      await user.click(within(await screen.findByRole("dialog", { name: "Approve section 1?" })).getByRole("button", { name: "Approve" }));
      await screen.findByRole("link", { name: `Next IPAS waiting for me: ${second.number}` });

      // The database refuses the next one on the first IPAS, so its failure is on the card.
      signIn(approver, { actorId: other.id });
      await user.click(within(await yourMove()).getByRole("button", { name: "Approve section 2" }));
      await user.click(within(await screen.findByRole("dialog", { name: "Approve section 2?" })).getByRole("button", { name: "Approve" }));
      expect(await within(await yourMove()).findByRole("alert")).toBeInTheDocument();

      await user.click(screen.getByRole("link", { name: `Next IPAS waiting for me: ${second.number}` }));
      await waitFor(() => expect(screen.getByRole("heading", { name: second.number })).toBeInTheDocument());
      const region = await yourMove();
      // The second IPAS offers its earliest move, but shows none of the first one's failure.
      await within(region).findByRole("button", { name: "Approve section 1" });
      expect(within(region).queryByRole("alert")).not.toBeInTheDocument();
      expect(within(region).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });
  });

  // #586: section 3 (stored 6) is a sign-off of its own, shown as section 3.
  describe("section 3, the Landed Cost sign-off", () => {
    const TITLE = "3 · Computation status & Landed Cost";

    it("offers no Submit before LC Odoo Done, and Submit once it is reached", async () => {
      const early = ipas({ computation_status: "lc_gs_done" });
      const view = renderDetail(early.id, "costing");
      await screen.findByRole("region", { name: TITLE });
      expect(within(await yourMove()).queryByRole("button", { name: /^Submit section 3/ })).not.toBeInTheDocument();
      view.unmount();

      const ready = ipas({ computation_status: "lc_odoo_done" });
      renderDetail(ready.id, "costing");
      const open = await screen.findByRole("region", { name: TITLE });
      expect(within(open).queryByRole("button", { name: /^Submit section 3/ })).not.toBeInTheDocument();
      expect(await within(await yourMove()).findByRole("button", { name: `Submit section 3` })).toBeInTheDocument();
    });

    it("submits as section 3, stored as section 6, and tells the section 3 list", async () => {
      const row = ipas({ computation_status: "lc_odoo_done" });
      onList("s6_approved", other);
      renderDetail(row.id, "costing");
      const user = setupUser();

      await screen.findByRole("region", { name: TITLE });
      await user.click(await within(await yourMove()).findByRole("button", { name: `Submit section 3` }));
      const dialog = await screen.findByRole("dialog", { name: `Submit section 3?` });
      await user.click(within(dialog).getByRole("button", { name: "Submit" }));

      await waitFor(() =>
        expect(db.rows("ipas_signoffs").filter((s) => s.section === 6 && s.role === "prepared")).toHaveLength(1),
      );
    });

    it("lets a section 3 list member approve it, but not the person who submitted it", async () => {
      const row = ipas({ computation_status: "lc_odoo_done" });
      onList("s6_approved", approver, purchaser);
      signoff(row.id, 6, "prepared", purchaser);

      signIn(purchaser);
      const mine = renderDetail(row.id, "costing");
      const own = await screen.findByRole("region", { name: TITLE });
      expect(within(own).queryByRole("button", { name: `Approve section 3` })).not.toBeInTheDocument();
      mine.unmount();

      signIn(approver);
      renderDetail(row.id, "costing");
      const user = setupUser();
      const drawer = await screen.findByRole("region", { name: TITLE });
      await user.click(await within(drawer).findByRole("button", { name: `Approve section 3` }));
      const dialog = await screen.findByRole("dialog", { name: `Approve section 3?` });
      await user.click(within(dialog).getByRole("button", { name: "Approve" }));
      await waitFor(() =>
        expect(db.rows("ipas_signoffs").filter((s) => s.section === 6 && s.role === "approved")).toHaveLength(1),
      );
    });

    it("reads Submitted and Approved with who gave them, in the section's body", async () => {
      const row = ipas({ computation_status: "lc_odoo_done" });
      signoff(row.id, 6, "prepared", purchaser);
      signoff(row.id, 6, "approved", approver);
      renderDetail(row.id, "costing");

      const body = await screen.findByTestId("ipas-signoffs-6");
      expect(within(body).getByText("Boss Lito")).toBeInTheDocument();
      expect(within(body).getByText("Buyer")).toBeInTheDocument();
    });
  });
});
