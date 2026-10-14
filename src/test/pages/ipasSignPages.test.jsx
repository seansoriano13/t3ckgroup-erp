import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { MemoryRouter, Route, Routes, RouterProvider, createMemoryRouter } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import { renderWithProviders } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubEdgeFunction } from "@/test/msw/server";
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc";

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

describe("IPAS signing with the evidence in view", () => {
  let purchaser, approver, other;
  let toastSpy = null;

  const signIn = (person, opts = {}) => {
    mockUser.current = person;
    stubIpasRpcs({ actorId: person.id, purchasing: Boolean(person.has_purchasing_flow), ...opts });
  };

  beforeEach(() => {
    counter = 80;
    purchaser = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    approver = makeEmployee({ name: "Boss Lito" });
    other = makeEmployee({ name: "Co Approver" });
    seedIpasOptions((table, row) => db.seed(table, row));
    onList("s1_approved", approver);
    signIn(purchaser);
    stubEdgeFunction("odoo-po-ipas", (body) => ({ success: true, found: true, ...poCopy(body.poNumber) }));
  });

  afterEach(() => {
    toastSpy?.mockRestore();
    toastSpy = null;
  });

  describe("the drawer", () => {
    it("shows the viewer's moves for the section in a pinned footer, and the body only reads", async () => {
      const row = ipas();
      renderDetail(row.id, "purchasing");

      const drawer = await screen.findByRole("dialog", { name: "1 · Purchasing" });
      const body = within(drawer).getByTestId("ipas-signoffs-1");
      expect(within(body).queryByRole("button")).not.toBeInTheDocument();
      expect(within(body).getByText("Not prepared")).toBeInTheDocument();

      // The footer holds the move, with its consequence, and nothing for other sections.
      expect(within(drawer).getByRole("button", { name: "Prepare section 1 · Purchasing" })).toBeInTheDocument();
      expect(within(drawer).getByText(/Marks section 1 · Purchasing ready to approve/)).toBeInTheDocument();
      expect(within(drawer).queryByRole("button", { name: /section 2/ })).not.toBeInTheDocument();
    });

    it("hides the in-body buttons of the filing section, and its footer gives the steps", async () => {
      const row = ipas();
      onList("s7_received", approver);
      signoff(row.id, 1, "prepared", purchaser);
      signoff(row.id, 1, "approved", approver);
      signoff(row.id, 3, "prepared", purchaser);
      signoff(row.id, 3, "approved", approver);
      signIn(approver);
      renderDetail(row.id, "filing");

      const drawer = await screen.findByRole("dialog", { name: "4 · Filing" });
      expect(within(drawer).getByTestId("ipas-filing")).toBeInTheDocument();
      expect(within(drawer).queryByTestId("ipas-give-received")).not.toBeInTheDocument();
      expect(within(drawer).getByRole("button", { name: "Receive section 4 · Filing" })).toBeInTheDocument();
    });

    it("has no footer for a section with no sign-off", async () => {
      const row = ipas();
      renderDetail(row.id, "history");

      const drawer = await screen.findByRole("dialog", { name: "History" });
      expect(within(drawer).queryByRole("button", { name: /^Prepare|^Approve|^Send|^Edit section/ })).not.toBeInTheDocument();
    });

    // #533: money reads in the drawer; editing is in the edit view.
    it("shows the money read-only in the drawer, with no add or edit control", async () => {
      const row = ipas();
      renderDetail(row.id, "purchasing");

      const drawer = await screen.findByRole("dialog", { name: "1 · Purchasing" });
      expect(within(drawer).queryByRole("button", { name: "Add payment" })).not.toBeInTheDocument();
      expect(within(drawer).queryByRole("button", { name: /^Edit P\.I/ })).not.toBeInTheDocument();
      expect(within(drawer).getByRole("button", { name: "Edit section" })).toBeInTheDocument();
    });

    it("offers no Edit section to a viewer with no edit rights on the section", async () => {
      const row = ipas();
      signIn(approver);
      renderDetail(row.id, "purchasing");
      const drawer = await screen.findByRole("dialog", { name: "1 · Purchasing" });
      expect(within(drawer).queryByRole("button", { name: "Edit section" })).not.toBeInTheDocument();
    });

    it("Edit section opens the edit view with the tables editable, and Back to overview focuses the row", async () => {
      const row = ipas();
      renderRouted(row.id);
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: /^1 · Purchasing/ }));
      const drawer = await screen.findByRole("dialog", { name: "1 · Purchasing" });
      await user.click(within(drawer).getByRole("button", { name: "Edit section" }));

      expect(await screen.findByRole("button", { name: "Add payment" })).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Your move" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Back to overview" }));
      const trigger = await screen.findByRole("button", { name: /^1 · Purchasing/ });
      expect(trigger).toHaveFocus();
      expect(screen.queryByRole("button", { name: "Add payment" })).not.toBeInTheDocument();
    });

    it("Edit section from the drawer, then Back, lands on the overview with the row focused and no drawer", async () => {
      const row = ipas();
      const router = renderRouted(row.id);
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: /^1 · Purchasing/ }));
      const drawer = await screen.findByRole("dialog", { name: "1 · Purchasing" });
      await user.click(within(drawer).getByRole("button", { name: "Edit section" }));
      await screen.findByRole("button", { name: "Back to overview" });
      // The drawer's entry was replaced, not stacked under the edit view.
      expect(router.state.location.search).toBe("?edit=purchasing");

      await act(() => router.navigate(-1));
      await waitFor(() => expect(router.state.location.search).toBe(""));
      expect(await screen.findByRole("button", { name: /^1 · Purchasing/ })).toHaveFocus();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add payment" })).not.toBeInTheDocument();
    });

    it("a failed change in the edit view shows its error in the view's header, and Retry runs it again", async () => {
      const row = ipas({ computation_status: "encoding" });
      // The page offers the change to Purchasing; the database refuses it for this caller.
      signIn(purchaser, { purchasing: false });
      const router = renderRouted(row.id);
      const user = userEvent.setup();

      await act(() => router.navigate(`/purchasing/ipas/${row.id}?edit=costing`));
      await user.click(await screen.findByRole("button", { name: "Costs complete" }));
      const alert = await screen.findByRole("alert");
      expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
      expect(rowOf(row.id).computation_status).toBe("encoding");

      signIn(purchaser);
      await user.click(within(alert).getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(rowOf(row.id).computation_status).toBe("costs_complete"));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });

    it("Back leaves the edit view for the overview, with the section row focused", async () => {
      const row = ipas();
      const router = renderRouted(row.id);
      await screen.findByRole("button", { name: /^2 · Purchasing & Finance/ });

      await act(() => router.navigate(`/purchasing/ipas/${row.id}?edit=finance`));
      expect(await screen.findByRole("button", { name: "Back to overview" })).toBeInTheDocument();
      await act(() => router.navigate(-1));

      await waitFor(() => expect(router.state.location.search).toBe(""));
      expect(await screen.findByRole("button", { name: /^2 · Purchasing & Finance/ })).toHaveFocus();
    });

    it("signs from the footer without a second question", async () => {
      const row = ipas();
      renderDetail(row.id, "purchasing");
      const user = userEvent.setup();

      const drawer = await screen.findByRole("dialog", { name: "1 · Purchasing" });
      await user.click(within(drawer).getByRole("button", { name: "Prepare section 1 · Purchasing" }));

      await waitFor(() => expect(db.rows("ipas_signoffs").filter((s) => s.role === "prepared")).toHaveLength(1));
      expect(screen.queryByRole("dialog", { name: "Prepare section 1 · Purchasing?" })).not.toBeInTheDocument();
    });

    it("steps with J and K, and Back closes it (opening pushed the entry)", async () => {
      const row = ipas();
      const router = renderRouted(row.id);
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: /^1 · Purchasing/ }));
      await screen.findByRole("dialog", { name: "1 · Purchasing" });
      expect(router.state.location.search).toBe("?open=purchasing");

      fireEvent.keyDown(window, { key: "j" });
      expect(await screen.findByRole("dialog", { name: "2 · Purchasing & Finance" })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "k" });
      expect(await screen.findByRole("dialog", { name: "1 · Purchasing" })).toBeInTheDocument();
      // K at the first section does nothing.
      fireEvent.keyDown(window, { key: "k" });
      expect(screen.getByRole("dialog", { name: "1 · Purchasing" })).toBeInTheDocument();

      await act(() => router.navigate(-1));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(router.state.location.search).toBe("");
    });

    it("ignores J while a field has the focus", async () => {
      const row = ipas();
      renderDetail(row.id, "purchasing");
      await screen.findByRole("dialog", { name: "1 · Purchasing" });
      // A field outside React's tree, so the page's own markup is left alone.
      const field = document.createElement("input");
      document.body.appendChild(field);
      field.focus();

      fireEvent.keyDown(field, { key: "j" });
      field.remove();
      expect(screen.getByRole("dialog", { name: "1 · Purchasing" })).toBeInTheDocument();
    });

    it("has no N of 9 caption", async () => {
      const row = ipas();
      renderDetail(row.id, "purchasing");
      const drawer = await screen.findByRole("dialog", { name: "1 · Purchasing" });
      expect(within(drawer).queryByText(/\d+ of \d+/)).not.toBeInTheDocument();
    });
  });

  describe("the card", () => {
    it("asks first with the restatement, and signs only after the yes", async () => {
      signIn(approver);
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);
      renderDetail(row.id);
      const user = userEvent.setup();

      const region = await yourMove();
      await user.click(within(region).getByRole("button", { name: "Approve section 1 · Purchasing" }));

      const dialog = await screen.findByRole("dialog", { name: "Approve section 1 · Purchasing?" });
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
      const user = userEvent.setup();

      await user.click(within(await yourMove()).getByRole("button", { name: "Approve section 1 · Purchasing" }));
      const dialog = await screen.findByRole("dialog", { name: "Approve section 1 · Purchasing?" });
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(db.rows("ipas_signoffs").filter((s) => s.role === "approved")).toEqual([]);
    });

    it("offers a Review section link that opens the drawer for that move's section", async () => {
      const row = ipas();
      renderDetail(row.id);
      const user = userEvent.setup();

      await user.click(within(await yourMove()).getByRole("button", { name: "Review section 1 · Purchasing" }));
      const drawer = await screen.findByRole("dialog", { name: "1 · Purchasing" });
      expect(within(drawer).getByRole("button", { name: "Prepare section 1 · Purchasing" })).toBeInTheDocument();
    });

    it("marks costs complete with no question, toasts with Undo, and Undo restores the status", async () => {
      const row = ipas({ computation_status: "encoded" });
      // No Toaster in the page tests: draw the undoable toast where it is asked for.
      toastSpy = vi.spyOn(toast, "custom").mockImplementation((render) => {
        renderWithProviders(render({ id: "undo", visible: true }));
        return "undo";
      });
      renderDetail(row.id);
      const user = userEvent.setup();

      await user.click(within(await yourMove()).getByRole("button", { name: "Mark costs complete" }));
      // Undoable from its toast, so it asks nothing first.
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await waitFor(() => expect(rowOf(row.id).computation_status).toBe("costs_complete"));
      expect(toastSpy).toHaveBeenCalled();
      await user.click(await screen.findByRole("button", { name: "Undo" }));

      await waitFor(() => expect(rowOf(row.id).computation_status).toBe("encoded"));
    });

    it("a failed sign-off shows the error under its move, with Retry running it again", async () => {
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);
      // The page thinks the viewer may approve; the database says they aren't on the list.
      signIn(approver, { actorId: other.id });
      renderDetail(row.id);
      const user = userEvent.setup();

      await user.click(within(await yourMove()).getByRole("button", { name: "Approve section 1 · Purchasing" }));
      await user.click(within(await screen.findByRole("dialog", { name: "Approve section 1 · Purchasing?" })).getByRole("button", { name: "Approve" }));

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
      const user = userEvent.setup();

      const drawer = await screen.findByRole("dialog", { name: "1 · Purchasing" });
      await user.click(within(drawer).getByRole("button", { name: "Approve section 1 · Purchasing" }));

      const alert = await within(drawer).findByRole("alert");
      // The drawer is modal, so the card is out of reach; check its markup directly: no error there.
      expect(document.getElementById("your-move").querySelector('[role="alert"]')).toBeNull();
      await user.click(within(alert).getByRole("button", { name: "Dismiss" }));
      await waitFor(() => expect(within(drawer).queryByRole("alert")).not.toBeInTheDocument());
    });

    it("a failed send back keeps the dialog open with the reason and the error in it, and Retry sends it", async () => {
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);
      // The page offers the send back; the database says the viewer isn't on the list.
      signIn(approver, { actorId: other.id });
      renderDetail(row.id);
      const user = userEvent.setup();

      await user.click(within(await yourMove()).getByRole("button", { name: "Send section 1 · Purchasing back" }));
      const dialog = await screen.findByRole("dialog", { name: "Send section 1 · Purchasing back?" });
      await user.type(within(dialog).getByPlaceholderText(/What does the preparer need to fix/), "Wrong supplier");
      await user.click(within(dialog).getByRole("button", { name: "Send back" }));

      const alert = await within(dialog).findByRole("alert");
      expect(within(dialog).getByPlaceholderText(/What does the preparer need to fix/)).toHaveValue("Wrong supplier");
      expect(db.rows("ipas_signoffs").some((s) => s.cleared_reason)).toBe(false);

      signIn(approver);
      await user.click(within(alert).getByRole("button", { name: "Retry" }));

      await waitFor(() => expect(db.rows("ipas_signoffs").some((s) => s.cleared_reason === "Sent back: Wrong supplier")).toBe(true));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("names the next IPAS waiting for the viewer after a sign-off, and none when there is none", async () => {
      signIn(approver);
      const first = ipas();
      const second = ipas();
      signoff(first.id, 1, "prepared", purchaser);
      signoff(second.id, 1, "prepared", purchaser);
      renderDetail(first.id);
      const user = userEvent.setup();

      expect(screen.queryByRole("link", { name: /Next IPAS waiting for me/ })).not.toBeInTheDocument();
      await user.click(within(await yourMove()).getByRole("button", { name: "Approve section 1 · Purchasing" }));
      await user.click(within(await screen.findByRole("dialog", { name: "Approve section 1 · Purchasing?" })).getByRole("button", { name: "Approve" }));

      const link = await screen.findByRole("link", { name: `Next IPAS waiting for me: ${second.number}` });
      expect(link).toHaveAttribute("href", `/purchasing/ipas/${second.id}`);
    });

    it("shows no next link when the viewer has nothing else waiting", async () => {
      signIn(approver);
      const only = ipas();
      signoff(only.id, 1, "prepared", purchaser);
      renderDetail(only.id);
      const user = userEvent.setup();

      await user.click(within(await yourMove()).getByRole("button", { name: "Approve section 1 · Purchasing" }));
      await user.click(within(await screen.findByRole("dialog", { name: "Approve section 1 · Purchasing?" })).getByRole("button", { name: "Approve" }));

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
      const user = userEvent.setup();

      // A sign-off on the first IPAS succeeds, which names the second as the next one waiting.
      await user.click(within(await yourMove()).getByRole("button", { name: "Approve section 1 · Purchasing" }));
      await user.click(within(await screen.findByRole("dialog", { name: "Approve section 1 · Purchasing?" })).getByRole("button", { name: "Approve" }));
      await screen.findByRole("link", { name: `Next IPAS waiting for me: ${second.number}` });

      // The database refuses the next one on the first IPAS, so its failure is on the card.
      signIn(approver, { actorId: other.id });
      await user.click(within(await yourMove()).getByRole("button", { name: "Approve section 2 · Purchasing & Finance" }));
      await user.click(within(await screen.findByRole("dialog", { name: "Approve section 2 · Purchasing & Finance?" })).getByRole("button", { name: "Approve" }));
      expect(await within(await yourMove()).findByRole("alert")).toBeInTheDocument();

      await user.click(screen.getByRole("link", { name: `Next IPAS waiting for me: ${second.number}` }));
      await waitFor(() => expect(screen.getByRole("heading", { name: second.number })).toBeInTheDocument());
      const region = await yourMove();
      // The second IPAS offers the same move, but shows none of the first one's failure.
      await within(region).findByRole("button", { name: "Approve section 2 · Purchasing & Finance" });
      expect(within(region).queryByRole("alert")).not.toBeInTheDocument();
      expect(within(region).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });
  });
});
