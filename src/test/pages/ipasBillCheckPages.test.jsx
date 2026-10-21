import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import IpasSignoffsQueuePage from "@/pages/approvals/ipas";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubEdgeFunction } from "@/test/msw/server";
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc";
import { findOtherDialog } from "@/test/support/dialogs";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

/**
 * The Supplier bill check (#603) as people meet it: the money summary at the top
 * of the IPAS, and the warning beside section 1's Approve on the record and in
 * the Approval Center's review. It warns and never blocks.
 */

const poCopy = (po, { stated = true } = {}) => ({
  po: {
    id: 1,
    name: po,
    state: "purchase",
    company: "T3ck Trading",
    company_id: 1,
    currency: "Php",
    origin: null,
    partner_ref: null,
    // A copy stored before #596 states no totals.
    ...(stated ? { amount_untaxed: 10000, amount_tax: 1200, amount_total: 11200 } : {}),
  },
  supplier: { id: 5, name: "Scorpe Technologies", contact: "Ms. K. Tan" },
  lines: [
    { line_id: 11, name: "Greenspirit 2 Cutter", brand: "SCORPE", quantity: 8, unit: "Unit", price_unit: 1250, price_subtotal: 10000, taxes: [], analytic: [] },
  ],
  receipts: { status: "pending", done: 0, total: 1 },
  bills: { count: 0, draft: 0 },
});

let counter = 80;
function ipas(overrides = {}) {
  counter += 1;
  const po = overrides.po_number ?? `P0${4000 + counter}`;
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

const signoff = (ipasId, section, role, signedBy) =>
  db.seed("ipas_signoffs", { ipas_id: ipasId, section, role, signed_by: signedBy.id, signed_at: "2026-09-05T06:40:00.000Z" });

function renderDetail(id) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/purchasing/ipas/${id}`]}>
      <Routes>
        <Route path="/purchasing/ipas/:id" element={<IpasDetailPage />} />
        <Route path="/purchasing/ipas" element={<p>The IPAS list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function stubWide(wide) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: wide,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("IPAS Supplier bill check", () => {
  let purchaser, approver, options;
  const originalMatchMedia = window.matchMedia;

  const signIn = (person) => {
    mockUser.current = person;
    stubIpasRpcs({ actorId: person.id, purchasing: Boolean(person.has_purchasing_flow) });
  };

  beforeEach(() => {
    counter = 80;
    stubWide(true);
    purchaser = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    approver = makeEmployee({ name: "Boss Lito" });
    options = seedIpasOptions((table, row) => db.seed(table, row));
    db.seed("ipas_signer_lists", { list_key: "s1_approved", employee_id: approver.id });
    signIn(purchaser);
    stubEdgeFunction("odoo-po-ipas", (body) => ({ success: true, found: true, ...poCopy(body.poNumber) }));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  describe("the money summary", () => {
    it("compares the Odoo PO total with the P.I/QT Amount, and says they match", async () => {
      const row = ipas({ pi_qt_amount: 11200 });
      renderDetail(row.id);

      const box = await screen.findByTestId("ipas-bill-check");
      expect(within(box).getByRole("heading", { name: "Supplier bill check" })).toBeInTheDocument();
      expect(within(box).getByTestId("bill-check-po")).toHaveTextContent("₱11,200.00");
      expect(within(box).getByTestId("bill-check-pi")).toHaveTextContent("₱11,200.00");
      expect(within(box).getByTestId("bill-check-verdict")).toHaveTextContent("Matches the Odoo PO");
      const summary = screen.getByTestId("ipas-money-summary");
      expect(within(summary).getByText("Paid")).toBeInTheDocument();
      expect(within(summary).getByText("Remaining balance")).toBeInTheDocument();
      expect(within(summary).getByText("Landed Cost")).toBeInTheDocument();
    });

    it("says how much more the P.I is when it differs", async () => {
      const row = ipas({ pi_qt_amount: 16200 });
      renderDetail(row.id);

      const box = await screen.findByTestId("ipas-bill-check");
      expect(within(box).getByTestId("bill-check-verdict")).toHaveTextContent("P.I is ₱5,000.00 more than the Odoo PO");
    });

    it("says the P.I/QT Amount is not typed yet when it is blank", async () => {
      const row = ipas();
      renderDetail(row.id);

      const box = await screen.findByTestId("ipas-bill-check");
      expect(within(box).getByTestId("bill-check-verdict")).toHaveTextContent("P.I/QT Amount not typed yet");
      expect(within(box).getByTestId("bill-check-po")).toHaveTextContent("₱11,200.00");
    });

    it("says the PO figure is before tax for an old copy, instead of calling it a mismatch", async () => {
      const row = ipas({ pi_qt_amount: 11200, odoo_copy: poCopy("P04999", { stated: false }), po_number: "P04999" });
      stubEdgeFunction("odoo-po-ipas", { success: false, message: "Odoo is rate-limiting requests" });
      renderDetail(row.id);

      const box = await screen.findByTestId("ipas-bill-check");
      expect(within(box).getByText("Odoo PO, before tax")).toBeInTheDocument();
      expect(within(box).getByTestId("bill-check-verdict")).toHaveTextContent(/before tax/);
      expect(within(box).getByTestId("bill-check-verdict")).not.toHaveTextContent("≠");
    });

    it("shows a payment and the remaining balance", async () => {
      const row = ipas({ pi_qt_amount: 11200 });
      db.seed("ipas_payments", {
        ipas_id: row.id,
        kind: "down_payment",
        amount: 4200,
        paid_on: "2026-10-01",
        method_id: options.payment_method["Bank TT"].id,
        created_by: purchaser.id,
      });
      renderDetail(row.id);

      const summary = await screen.findByTestId("ipas-money-summary");
      expect(await within(summary).findByText("₱4,200.00")).toBeInTheDocument();
      expect(within(summary).getByText("₱7,000.00")).toBeInTheDocument();
      expect(within(summary).getByText("Bank TT")).toBeInTheDocument();
    });
  });

  describe("beside section 1's approval", () => {
    it("warns an approver of the difference in words, and still offers Approve", async () => {
      const row = ipas({ pi_qt_amount: 16200 });
      signoff(row.id, 1, "prepared", purchaser);
      signIn(approver);
      renderDetail(row.id);

      const card = await screen.findByRole("region", { name: "Your move" });
      const approve = within(card).getByRole("button", { name: "Approve section 1" });
      const warning = within(card).getByTestId("move-warning-card-approve-1");
      expect(warning).toHaveTextContent("the P.I is ₱5,000.00 more than the Odoo PO");
      // It sits beside the button, and never blocks it.
      expect(approve).toBeEnabled();
      expect(approve.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("warns when the P.I/QT Amount is blank", async () => {
      const row = ipas();
      signoff(row.id, 1, "prepared", purchaser);
      signIn(approver);
      renderDetail(row.id);

      const card = await screen.findByRole("region", { name: "Your move" });
      expect(within(card).getByTestId("move-warning-card-approve-1")).toHaveTextContent("P.I/QT Amount is not typed yet");
      expect(within(card).getByRole("button", { name: "Approve section 1" })).toBeEnabled();
    });

    it("shows no warning when the bill matches", async () => {
      const row = ipas({ pi_qt_amount: 11200 });
      signoff(row.id, 1, "prepared", purchaser);
      signIn(approver);
      renderDetail(row.id);

      const card = await screen.findByRole("region", { name: "Your move" });
      expect(within(card).getByRole("button", { name: "Approve section 1" })).toBeInTheDocument();
      expect(within(card).queryByTestId("move-warning-card-approve-1")).not.toBeInTheDocument();
    });

    it("shows no warning on a Submit", async () => {
      const row = ipas();
      renderDetail(row.id);

      const card = await screen.findByRole("region", { name: "Your move" });
      expect(within(card).getByRole("button", { name: "Submit section 1" })).toBeInTheDocument();
      expect(within(card).queryByTestId("move-warning-card-prepare-1")).not.toBeInTheDocument();
    });
  });

  describe("in the Approval Center's IPAS review", () => {
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

    it("warns beside Approve when the bill differs", async () => {
      const row = ipas({ pi_qt_amount: 10800, created_by: purchaser.id });
      signoff(row.id, 1, "prepared", purchaser);
      signIn(approver);
      mockUser.current = { ...approver, isIpasApprover: true };
      const user = setupUser();

      renderQueue();
      await user.click(await screen.findByText("Scorpe Technologies"));

      const sheet = await findOtherDialog();
      expect(within(sheet).getByTestId("review-bill-warning")).toHaveTextContent("the P.I is ₱400.00 less than the Odoo PO");
      expect(within(sheet).getByTestId("review-bill-check")).toHaveTextContent("P.I is ₱400.00 less than the Odoo PO");
      expect(within(sheet).getByRole("button", { name: "Approve" })).toBeEnabled();
    });

    it("warns when the P.I/QT Amount is blank", async () => {
      const row = ipas({ created_by: purchaser.id });
      signoff(row.id, 1, "prepared", purchaser);
      signIn(approver);
      mockUser.current = { ...approver, isIpasApprover: true };
      const user = setupUser();

      renderQueue();
      await user.click(await screen.findByText("Scorpe Technologies"));

      const sheet = await findOtherDialog();
      expect(within(sheet).getByTestId("review-bill-warning")).toHaveTextContent("P.I/QT Amount is not typed yet");
    });

    it("has no warning when the bill matches", async () => {
      const row = ipas({ pi_qt_amount: 11200, created_by: purchaser.id });
      signoff(row.id, 1, "prepared", purchaser);
      signIn(approver);
      mockUser.current = { ...approver, isIpasApprover: true };
      const user = setupUser();

      renderQueue();
      await user.click(await screen.findByText("Scorpe Technologies"));

      const sheet = await findOtherDialog();
      expect(within(sheet).getByTestId("review-bill-check")).toHaveTextContent("Matches the Odoo PO");
      expect(within(sheet).queryByTestId("review-bill-warning")).not.toBeInTheDocument();
    });
  });
});
