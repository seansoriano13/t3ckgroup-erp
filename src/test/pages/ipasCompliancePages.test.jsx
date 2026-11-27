import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubEdgeFunction } from "@/test/msw/server";
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc";
import { makeReady } from "@/test/support/ipasReady";
import { openSignReview } from "@/test/support/ipasSignRow";
import { stubRoomyScreen } from "@/test/roomyScreen";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

/**
 * Compliance Requirements (spec #1247, #1257) as people meet them on the IPAS page: the line near the top in
 * every state, the day and note on hover, and Filing's warning beside its step on the rail. (The section's foot
 * holds only Return and Undo moves, so Filing's warning has no second place there.) It never blocks. The SOR's own line is covered in IpasSorSection.test.jsx.
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

let counter = 600;
function ipas(overrides = {}) {
  counter += 1;
  const po = `P0${5000 + counter}`;
  return db.seed("ipas", {
    number: `TGIPAS_${counter}`,
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
const signoff = (ipasId, section, role, signedBy) =>
  db.seed("ipas_signoffs", { ipas_id: ipasId, section, role, signed_by: signedBy.id, signed_at: `2026-10-13T0${(tick += 1) % 10}:00:00.000Z` });

function renderDetail(id, open) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/purchasing/ipas/${id}${open ? `?open=${open}` : ""}`]}>
      <Routes>
        <Route path="/purchasing/ipas/:id" element={<IpasDetailPage />} />
        <Route path="/purchasing/ipas" element={<p>The IPAS list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Compliance Requirements on the IPAS page", () => {
  let purchaser, boss, receiver, noter, checker, kinds;

  const signIn = (person) => {
    mockUser.current = { ...person, isIpasApprover: true };
    stubIpasRpcs({ actorId: person.id, purchasing: Boolean(person.has_purchasing_flow) });
  };

  /** An open IPAS that asks, with the given answer and kinds: `[label, doneOn, note]`. */
  const asking = (needed, picked = [], overrides = {}) => {
    const row = ipas({ compliance_asked: true, compliance_needed: needed, ...overrides });
    for (const [label, doneOn = null, note = null] of picked) {
      db.seed("ipas_compliance_requirements", { ipas_id: row.id, kind_id: kinds[label].id, done_on: doneOn, note, done_by: doneOn ? purchaser.id : null });
    }
    return row;
  };

  /** Everything signed through Check, so the boss holds the last turn: Approve and file. */
  const readyToFile = (row) => {
    for (const section of [1, 3, 6]) {
      signoff(row.id, section, "prepared", purchaser);
      signoff(row.id, section, "approved", boss);
    }
    makeReady(row, boss);
    signoff(row.id, 7, "received", receiver);
    signoff(row.id, 7, "noted", noter);
    signoff(row.id, 7, "checked", checker);
  };

  beforeEach(() => {
    counter = 600;
    tick = 0;
    stubRoomyScreen();
    purchaser = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    boss = makeEmployee({ name: "Boss Lito" });
    receiver = makeEmployee({ name: "Rita Receiver" });
    noter = makeEmployee({ name: "Nina Noter" });
    checker = makeEmployee({ name: "Carl Checker" });
    seedIpasOptions((table, row) => db.seed(table, row));
    kinds = Object.fromEntries(
      ["DENR", "MARINA", "FDA"].map((label, index) => [label, db.seed("ipas_options", { list: "compliance_kind", label, sort: (index + 1) * 10, active: true })]),
    );
    for (const [key, person] of [["s1_approved", boss], ["s3_approved", boss], ["s7_received", receiver], ["s7_noted", noter], ["s7_checked", checker], ["s7_approved", boss]]) {
      db.seed("ipas_signer_lists", { list_key: key, employee_id: person.id });
    }
    signIn(purchaser);
    stubEdgeFunction("odoo-po-ipas", (body) => ({ success: true, found: true, ...poCopy(body.poNumber) }));
  });

  describe("the line near the top", () => {
    it("says each kind is done with a tick or open", async () => {
      const row = asking(true, [["DENR", "2020-11-02", "ECC no. 5"], ["MARINA"]]);
      renderDetail(row.id);

      const line = await screen.findByTestId("ipas-compliance-line");
      expect(line).toHaveTextContent("Compliance Requirements");
      expect(within(line).getByTestId("ipas-compliance-kind-done")).toHaveTextContent("DENR ✓");
      expect(within(line).getByTestId("ipas-compliance-kind-open")).toHaveTextContent("MARINA open");
    });

    it("says None needed after a No", async () => {
      const row = asking(false);
      renderDetail(row.id);

      expect(await screen.findByTestId("ipas-compliance-line")).toHaveTextContent("None needed");
    });

    it("says Not answered yet while the question is open", async () => {
      const row = asking(null);
      renderDetail(row.id);

      expect(await screen.findByTestId("ipas-compliance-line")).toHaveTextContent("Not answered yet");
    });

    it("shows nothing on an old IPAS that does not ask", async () => {
      const row = ipas({ compliance_asked: false });
      renderDetail(row.id);

      await screen.findByRole("region", { name: "Your move" });
      expect(screen.queryByTestId("ipas-compliance-line")).not.toBeInTheDocument();
    });

    it("shows the day and the note when a done kind is hovered", async () => {
      const row = asking(true, [["DENR", "2020-11-02", "ECC no. 5"]]);
      const user = setupUser();
      renderDetail(row.id);

      await user.hover(await screen.findByTestId("ipas-compliance-kind-done"));

      expect(await screen.findByText("Done Nov 2, 2020 · ECC no. 5")).toBeInTheDocument();
    });
  });

  describe("Filing's warning", () => {
    const fileStep = async () => within(await screen.findByRole("region", { name: "Your move" })).findByTestId("ipas-journey-file");

    it("names the open kinds beside the file step on the rail, and still offers the sign-off", async () => {
      const row = asking(true, [["DENR", "2020-11-02"], ["MARINA"], ["FDA"]]);
      readyToFile(row);
      signIn(boss);
      renderDetail(row.id);

      const step = await fileStep();
      expect(within(step).getByText("Compliance Requirements still open: MARINA, FDA.")).toBeInTheDocument();
      expect(within(step).getByRole("button", { name: "Go to sign-off" })).toBeEnabled();
    });

    it("warns when the question is not answered yet", async () => {
      const row = asking(null);
      readyToFile(row);
      signIn(boss);
      renderDetail(row.id);

      expect(within(await fileStep()).getByText("Compliance Requirements not answered yet.")).toBeInTheDocument();
    });

    it.each([
      ["every kind is done", () => asking(true, [["DENR", "2020-11-02"]])],
      ["the answer is No", () => asking(false)],
      ["the IPAS is an old one that does not ask", () => ipas({ compliance_asked: false })],
    ])("says nothing when %s", async (_name, make) => {
      const row = make();
      readyToFile(row);
      signIn(boss);
      renderDetail(row.id);

      const step = await fileStep();
      expect(within(step).getByRole("button", { name: "Go to sign-off" })).toBeInTheDocument();
      expect(step).not.toHaveTextContent("Compliance Requirements");
    });

    it("still files while a kind is open", async () => {
      const row = asking(true, [["MARINA"]]);
      readyToFile(row);
      signIn(boss);
      const user = setupUser();
      renderDetail(row.id);

      await openSignReview(user, "file");
      const dialog = await screen.findByRole("dialog", { name: "Approve and file" });
      await user.click(within(dialog).getByRole("button", { name: "Approve and file" }));

      await waitFor(() => expect(screen.getByTestId("ipas-filed-notice")).toBeInTheDocument());
      expect(db.rows("ipas").find((r) => r.id === row.id).state).toBe("filed");
    });
  });
});
