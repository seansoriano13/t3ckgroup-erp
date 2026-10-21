import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import SettingsPage from "@/pages/settings";
import IpasSettingsRedirect from "@/pages/purchasing/ipas/settings";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubEdgeFunction, stubRpc } from "@/test/msw/server";
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc";
import { findOtherDialog, queryOtherDialog } from "@/test/support/dialogs"

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

/**
 * The IPAS page's money (#244): payments in section 1, charges in section 3,
 * the computation status and Landed Cost in section 6, and the IPAS settings
 * screen. The database rules are the policy tier's; this proves what each kind
 * of person is offered and that half-typed input never breaks the page.
 */

const poCopy = (po, { currency = "Php", lines } = {}) => ({
  po: { id: 1, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency, origin: null, partner_ref: null },
  supplier: { id: 5, name: "Scorpe Technologies", contact: "Ms. K. Tan" },
  lines: lines ?? [
    { line_id: 11, name: "Greenspirit 2 Cutter", brand: "SCORPE", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [] },
  ],
  receipts: { status: "pending", done: 0, total: 1 },
  bills: { count: 0, draft: 0 },
});

let counter = 48;
function ipas(overrides = {}) {
  counter += 1;
  const po = overrides.po_number ?? `P0${2000 + counter}`;
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

/** The dialog on top: the "Remove this payment?" question opens over the page. */
async function topDialog() {
  await waitFor(() => expect(screen.getAllByRole("dialog").length).toBeGreaterThan(0));
  const all = screen.getAllByRole("dialog");
  return all[all.length - 1];
}

const saveAll = (user) => user.click(screen.getByRole("button", { name: /^Save all/ }));

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

function renderSettings() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/settings?tab=purchasing"]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/purchasing/ipas" element={<p>The IPAS list</p>} />
        <Route path="/" element={<p>Home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Picks an option of the SelectField named `label` (a string or a pattern). */
const pick = async (user, scope, label, optionName) => {
  await user.click(within(scope).getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: optionName }));
};

describe("IPAS page: payments, charges and Landed Cost", () => {
  let purchaser, finance, reader, options;

  beforeEach(() => {
    counter = 48;
    purchaser = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    finance = makeEmployee({ name: "Fe", has_finance_flow: true });
    reader = makeEmployee({ name: "Signer" });
    options = seedIpasOptions((table, row) => db.seed(table, row));
    mockUser.current = purchaser;
    stubIpasRpcs({ actorId: purchaser.id });
    // Opening an IPAS refreshes it; keep the copy the test seeded.
    stubEdgeFunction("odoo-po-ipas", (body) => ({ success: true, found: true, ...poCopy(body.poNumber) }));
  });

  describe("payments", () => {
    it("records a payment from the page, and shows it with the header amounts derived from the rows", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "purchasing", "edit");
      await user.click(await screen.findByRole("button", { name: /Add payment/ }));
      // The payment is typed right there, in a new form of its own: no dialog.
      const payment = await screen.findByRole("group", { name: "Payment 1" });
      expect(queryOtherDialog()).not.toBeInTheDocument();

      await pick(user, payment, /^Kind/, "Down payment");
      await user.type(within(payment).getByRole("textbox", { name: /^Amount \(PHP\)/ }), "3000");
      await pick(user, payment, /^Method/, "Dated Check");
      await user.type(within(payment).getByPlaceholderText("When paid by check"), "CHK-0042");
      // Nothing is stored until Save all.
      expect(db.rows("ipas_payments")).toHaveLength(0);
      await saveAll(user);

      await waitFor(() => expect(db.rows("ipas_payments")).toHaveLength(1));
      expect(db.rows("ipas_payments")[0]).toMatchObject({ kind: "down_payment", amount: 3000, check_no: "CHK-0042", created_by: purchaser.id });

      const saved = await screen.findByTestId("ipas-payment-row");
      expect(within(saved).getByText("Down payment")).toBeInTheDocument();
      expect(within(saved).getByDisplayValue("CHK-0042")).toBeInTheDocument();
      // DP is read off the rows; there is no balance anywhere.
      await waitFor(() => expect(screen.getByText("DP").parentElement).toHaveTextContent(/3,000\.00/));
      expect(screen.queryByText(/balance/i)).not.toBeInTheDocument();
    }, 20_000);

    it("refuses a half-typed amount with a sentence on Save all, keeps what was typed, and never breaks", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "purchasing", "edit");
      await user.click(await screen.findByRole("button", { name: /Add payment/ }));
      const payment = await screen.findByRole("group", { name: "Payment 1" });
      await pick(user, payment, /^Method/, "Dated Check");

      const amount = within(payment).getByRole("textbox", { name: /^Amount \(PHP\)/ });
      await user.type(amount, "12abc");
      await saveAll(user);

      expect(await screen.findByText("Payment 1: Amount must be a number more than zero.")).toBeInTheDocument();
      expect(amount).toHaveValue("12abc");
      expect(db.rows("ipas_payments")).toHaveLength(0);

      await user.clear(amount);
      await user.type(amount, "1,250.50");
      await saveAll(user);
      await waitFor(() => expect(db.rows("ipas_payments")).toHaveLength(1));
      expect(db.rows("ipas_payments")[0].amount).toBe(1250.5);
    });

    it("counts a new payment's required boxes, marks them Needed, and counts them as they are filled", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "purchasing", "edit");
      // Odoo fills the supplier's name; the other three are still needed.
      expect(await screen.findByText("1 of 4 required fields filled")).toBeInTheDocument();
      await user.click(await screen.findByRole("button", { name: /Add payment/ }));
      const payment = await screen.findByRole("group", { name: "Payment 1" });

      // Date starts as today; the amount and the method are still needed.
      expect(screen.getByText("2 of 7 required fields filled")).toBeInTheDocument();
      expect(within(payment).getAllByText("Needed")).toHaveLength(2);
      await user.type(within(payment).getByRole("textbox", { name: /^Amount \(PHP\)/ }), "50");
      expect(screen.getByText("3 of 7 required fields filled")).toBeInTheDocument();
    });

    it("keeps what was typed when a later step fails, and Retry doesn't add the payment twice", { timeout: 30000 }, async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      let tries = 0;
      // The charge is refused the first time and goes in the second.
      stubRpc("ipas_add_charge", (args) => {
        tries += 1;
        if (tries === 1) {
          const error = new Error("ipas_add_charge: the database is busy");
          error.code = "40001";
          throw error;
        }
        return db.seed("ipas_charges", { ipas_id: args.p_ipas_id, kind_id: args.p_kind_id, charged_on: args.p_charged_on, amount_php: args.p_amount_php });
      });
      const user = setupUser();

      renderDetail(row.id, "purchasing", "edit");
      await user.click(await screen.findByRole("button", { name: /Add payment/ }));
      const payment = await screen.findByRole("group", { name: "Payment 1" });
      await pick(user, payment, /^Method/, "Dated Check");
      await user.type(within(payment).getByRole("textbox", { name: /^Amount \(PHP\)/ }), "500");
      await user.click(screen.getByRole("button", { name: /Charges paid in pesos/ }));
      await user.click(await screen.findByRole("button", { name: /Add charge/ }));
      const charge = await screen.findByRole("group", { name: "Charge 1" });
      await pick(user, charge, /^Kind/, "Brokerage Fee");
      await user.type(within(charge).getByRole("textbox", { name: /^Amount \(PHP\)/ }), "250");
      await saveAll(user);

      // The payment went in; the charge didn't. The error says so, with Retry, and the charge stays typed.
      const alert = await screen.findByText(/database is busy/i, { selector: "p" });
      expect(db.rows("ipas_payments")).toHaveLength(1);
      expect(db.rows("ipas_charges")).toHaveLength(0);
      expect(within(charge).getByRole("textbox", { name: /^Amount \(PHP\)/ })).toHaveValue("250");
      expect(screen.getAllByRole("group", { name: /^Payment \d/ })).toHaveLength(1);

      await user.click(within(alert.closest("[role='alert']")).getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(db.rows("ipas_charges")).toHaveLength(1));
      expect(db.rows("ipas_payments")).toHaveLength(1);
      await waitFor(() => expect(screen.getByText("All changes saved")).toBeInTheDocument());
      expect(screen.getAllByRole("group", { name: /^Charge \d/ })).toHaveLength(1);
    });

    it("drops an unsaved payment when it is removed, without asking", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "purchasing", "edit");
      await user.click(await screen.findByRole("button", { name: /Add payment/ }));
      const payment = await screen.findByRole("group", { name: "Payment 1" });
      await user.click(within(payment).getByRole("button", { name: "Remove payment 1" }));

      expect(screen.queryByRole("group", { name: "Payment 1" })).not.toBeInTheDocument();
      expect(queryOtherDialog()).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Save all/ })).toBeDisabled();
    });

    it("takes the pesos taken from the bank as optional on a foreign-currency PO, and shows Landed Cost as an estimate until it is filled", { timeout: 20000 }, async () => {
      const row = ipas({ po_number: "P02445", source: "import", odoo_copy: poCopy("P02445", { currency: "USD" }), created_by: purchaser.id });
      stubEdgeFunction("odoo-po-ipas", { success: true, found: true, ...poCopy("P02445", { currency: "USD" }) });
      // A Reference Rate older than any payment date, so the estimate has something to stand on.
      db.seed("currency_rate_currencies", { currency: "USD" });
      db.seed("currency_rates", { currency: "USD", rate_date: "2000-01-01", php_per_unit: 56, source: "test" });
      const user = setupUser();

      renderDetail(row.id, "purchasing", "edit");
      await user.click(await screen.findByRole("button", { name: /Add payment/ }));
      const payment = await screen.findByRole("group", { name: "Payment 1" });
      await pick(user, payment, /^Method/, "Alipay");

      const amount = within(payment).getByRole("textbox", { name: /^Amount \(USD\)/ });
      expect(within(payment).getByRole("textbox", { name: /^Pesos taken from the bank/ })).toHaveValue("");
      await user.type(amount, "640");
      // Optional (#604): no Needed mark, a one-line explanation under it, and Save all goes without it.
      expect(within(payment).queryByText("Needed")).not.toBeInTheDocument();
      expect(within(payment).getByTestId("payment-pesos-hint")).toHaveTextContent(/Leave it blank until then/);
      await saveAll(user);

      await waitFor(() => expect(db.rows("ipas_payments")).toHaveLength(1));
      expect(db.rows("ipas_payments")[0]).toMatchObject({ amount: 640, php_debited: null });
      // The edit view stays. Back to the section's drawer, close it, then open Costing from its row.
      await waitFor(() => expect(screen.getByText("All changes saved")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Back to preview" }));
      await user.click(within(await screen.findByRole("dialog", { name: "1 · Purchasing" })).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(queryOtherDialog()).not.toBeInTheDocument());
      // The section row (its number first); the card's "Review section 3 · …" link names it too.
      await user.click(await screen.findByRole("button", { name: /^3 · Computation status & Landed Cost/ }));
      expect(await screen.findByTestId("ipas-landed-line")).toBeInTheDocument();
      // Worked out at the Reference Rate, marked as an estimate; the payment's column stays blank.
      expect(screen.getByTestId("landed-cost-estimate-note")).toHaveTextContent(/Estimate: A payment is taken at the Reference Rate/);
      expect(screen.getByText("Estimate")).toBeInTheDocument();
      expect(db.rows("ipas_payments")[0].php_debited).toBeNull();
    });

    it("shows the Reference Rate for the payment's date beside the typed rate, flags a wide gap, and never pre-fills", { timeout: 20000 }, async () => {
      const row = ipas({ po_number: "P02446", source: "import", odoo_copy: poCopy("P02446", { currency: "USD" }), created_by: purchaser.id });
      stubEdgeFunction("odoo-po-ipas", { success: true, found: true, ...poCopy("P02446", { currency: "USD" }) });
      const asked = [];
      stubRpc("reference_rate", (args) => {
        asked.push(args.p_on);
        return [{ currency: "USD", rate_date: "2026-09-12", php_per_unit: 58.2, source: "ECB", overridden: false, divergence_pct: 2 }];
      });
      const user = setupUser();

      renderDetail(row.id, "purchasing", "edit");
      await user.click(await screen.findByRole("button", { name: /Add payment/ }));
      const dialog = await screen.findByRole("group", { name: "Payment 1" });
      await pick(user, dialog, /^Method/, "Alipay");
      const date = within(dialog).getByLabelText(/^Date/);
      await user.clear(date);
      await user.type(date, "2026-09-12");

      // Context only: the pesos taken from the bank are never filled in from the Reference Rate.
      const phpDebited = within(dialog).getByRole("textbox", { name: /^Pesos taken from the bank/ });
      expect(phpDebited).toHaveValue("");
      const line = await within(dialog).findByTestId("payment-reference-rate");
      expect(line).toHaveTextContent(/reference: ₱58\.20 on 12 Sep/);
      expect(asked).toContain("2026-09-12");

      await user.type(within(dialog).getByRole("textbox", { name: /^Amount \(USD\)/ }), "1000");
      await user.type(phpDebited, "58440");
      expect(line).toHaveTextContent(/you typed ₱58\.44/);
      expect(within(dialog).queryByTestId("payment-rate-divergence")).not.toBeInTheDocument();

      await user.clear(phpDebited);
      await user.type(phpDebited, "5844");
      expect(within(dialog).getByTestId("payment-rate-divergence")).toBeInTheDocument();
      // It flags; it blocks nothing.
      await saveAll(user);
      await waitFor(() => expect(db.rows("ipas_payments")).toHaveLength(1));
      expect(db.rows("ipas_payments")[0]).toMatchObject({ amount: 1000, php_debited: 5844 });
    });

    it("edits and removes a payment, asking before it goes", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      db.seed("ipas_payments", {
        ipas_id: row.id,
        kind: "payment",
        paid_on: "2026-10-01",
        amount: 8325,
        php_debited: null,
        charge_fee_php: 0,
        method_id: options.payment_method["Dated Check"].id,
        check_no: null,
        proof_url: null,
        created_by: purchaser.id,
      });
      const user = setupUser();

      renderDetail(row.id, "purchasing", "edit");
      // The saved payment is a form already: type over it and Save all.
      const saved = await screen.findByTestId("ipas-payment-row");
      const amount = within(saved).getByRole("textbox", { name: /^Amount \(PHP\)/ });
      expect(amount).toHaveValue("8325");
      await user.clear(amount);
      await user.type(amount, "8000");
      await saveAll(user);

      await waitFor(() => expect(db.rows("ipas_payments")[0].amount).toBe(8000));

      await user.click(await screen.findByRole("button", { name: /^Remove Payment of Oct 1, 2026/ }));
      const confirm = await topDialog();
      expect(within(confirm).getByText("Remove this payment?")).toBeInTheDocument();
      await user.click(within(confirm).getByRole("button", { name: "Remove" }));

      await waitFor(() => expect(db.rows("ipas_payments")).toHaveLength(0));
      expect(db.rows("ipas_events").map((e) => e.kind)).toContain("payment_removed");
    });

    it("types P.I/QT Amount, and refuses a half-typed one with a sentence", { timeout: 20000 }, async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "purchasing", "edit");
      const field = await screen.findByRole("textbox", { name: /^P\.I\/QT Amount/ });
      // The currency is fixed in front, so what is typed reads as a real amount.
      expect(field).toHaveAttribute("placeholder", "0.00");
      await user.type(field, "12k");
      await user.click(screen.getByRole("button", { name: /^Save all/ }));

      // Refused with a sentence, in the bar: nothing was saved and what was typed stays.
      expect(await screen.findByText("P.I/QT Amount must be a number.")).toBeInTheDocument();
      expect(db.rows("ipas")[0].pi_qt_amount ?? null).toBeNull();
      expect(field).toHaveValue("12k");

      await user.clear(field);
      await user.type(field, "8,400");
      await user.click(screen.getByRole("button", { name: /^Save all/ }));

      await waitFor(() => expect(db.rows("ipas")[0].pi_qt_amount).toBe(8400));
    });

    it("picks the one freight service", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "purchasing", "edit");
      await user.click(await screen.findByRole("combobox", { name: /^Freight service/ }));
      await user.click(await screen.findByRole("option", { name: "DHL" }));
      expect(db.rows("ipas")[0].freight_service_id ?? null).toBeNull();
      await saveAll(user);

      await waitFor(() => expect(db.rows("ipas")[0].freight_service_id).toBe(options.freight_service["DHL"].id));
    });
  });

  describe("charges", () => {
    it("records a charge in section 3 and totals the list", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "finance", "edit");
      await user.click(await screen.findByRole("button", { name: /Add charge/ }));
      const charge = await screen.findByRole("group", { name: "Charge 1" });
      expect(queryOtherDialog()).not.toBeInTheDocument();
      await pick(user, charge, /^Kind/, "Brokerage Fee");
      await user.type(within(charge).getByRole("textbox", { name: /^Amount \(PHP\)/ }), "4,200");
      await saveAll(user);

      const rowEl = await screen.findByTestId("ipas-charge-row");
      expect(within(rowEl).getByText("Brokerage Fee")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText(/Total charges saved/)).toHaveTextContent(/4,200\.00/));
      expect(db.rows("ipas_charges")[0]).toMatchObject({ kind_id: options.charge_kind["Brokerage Fee"].id, amount_php: 4200 });
    });

    it("keeps a deactivated kind on the charge that used it", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      db.seed("ipas_charges", {
        ipas_id: row.id,
        kind_id: options.charge_kind["Delivery Fee"].id,
        charged_on: "2026-10-12",
        amount_php: 300,
        created_by: purchaser.id,
      });
      db.rows("ipas_options").find((o) => o.id === options.charge_kind["Delivery Fee"].id).active = false;

      renderDetail(row.id, "finance", "edit");

      expect(await screen.findByText("Delivery Fee")).toBeInTheDocument();
    });
  });

  describe("who is offered what", () => {
    it("gives Finance payments and charges, but not the typed amount, the freight service or the status", async () => {
      mockUser.current = finance;
      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
      const row = ipas({ po_number: "P02552" });

      // Section by section: each one is its own drawer.
      const payments = renderDetail(row.id, "purchasing", "edit");
      expect(await screen.findByRole("button", { name: /Add payment/ })).toBeInTheDocument();
      // The amount and the freight service are Purchasing's: present, but not typeable by Finance.
      expect(screen.getByRole("textbox", { name: /^P\.I\/QT Amount/ })).toBeDisabled();
      expect(screen.getByRole("combobox", { name: /^Freight service/ })).toBeDisabled();
      payments.unmount();

      renderDetail(row.id, "finance", "edit");
      // Each card holds its own controls: payments in the Purchasing card, charges in Finance's.
      const financeCard = within(await screen.findByRole("region", { name: /Finance/ }));
      expect(await financeCard.findByRole("button", { name: /Add charge/ })).toBeInTheDocument();
      expect(financeCard.queryByRole("button", { name: /Add payment/ })).not.toBeInTheDocument();
      cleanup();

      renderDetail(row.id, "costing", "edit");
      expect(await screen.findByRole("button", { name: "Back to preview" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "LC Odoo Done" })).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Spread charges" })).not.toBeInTheDocument();
    });

    it("gives Finance no status step at all: Checked by is gone", async () => {
      mockUser.current = finance;
      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
      const row = ipas({ po_number: "P02552", computation_status: "lc_odoo_done" });

      renderDetail(row.id, "costing", "edit");

      // The steps read plain for Finance, and none is called Checked by.
      expect(await screen.findByText("LC Odoo Done", { selector: "[aria-current='step']" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "LC GS Done" })).not.toBeInTheDocument();
      expect(screen.queryByText("Checked by")).not.toBeInTheDocument();
    });

    it("gives Finance no status step before LC Odoo Done", async () => {
      mockUser.current = finance;
      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
      const row = ipas({ po_number: "P02552", computation_status: "encoded" });

      renderDetail(row.id, "costing", "edit");

      expect(await screen.findByRole("button", { name: "Back to preview" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "LC GS Done" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Checked by" })).not.toBeInTheDocument();
    });

    it("moves the status one step either way for Purchasing, and no further", async () => {
      const row = ipas({ po_number: "P02552", computation_status: "encoded" });

      renderDetail(row.id, "costing", "edit");

      expect(await screen.findByRole("button", { name: "LC GS Done" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Encoding" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "LC Odoo Done" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Checked by" })).not.toBeInTheDocument();
    });

    it("ends the status at LC Odoo Done: the current step is selected, ticked and green", async () => {
      const row = ipas({ po_number: "P02552", computation_status: "lc_odoo_done" });

      renderDetail(row.id, "costing", "edit");

      const done = await screen.findByRole("button", { name: "LC Odoo Done" });
      expect(done).toHaveAttribute("aria-pressed", "true");
      expect(done.querySelector("svg.lucide-check")).not.toBeNull();
      expect(done.className).toMatch(/text-green-11/);
      expect(screen.getByRole("button", { name: "LC GS Done" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: "Checked by" })).not.toBeInTheDocument();
    });

    it("draws the current step with a tick for a reader too, and a step not reached without one", async () => {
      mockUser.current = reader;
      stubIpasRpcs({ actorId: reader.id, purchasing: false, money: false });
      const row = ipas({ po_number: "P02552", computation_status: "lc_gs_done" });

      renderDetail(row.id, "costing");

      const current = await screen.findByText("LC GS Done", { selector: "[aria-current='step']" });
      expect(current.querySelector("svg.lucide-check")).not.toBeNull();
      const ahead = screen.getByText("LC Odoo Done");
      expect(ahead.querySelector("svg.lucide-check")).toBeNull();
    });

    it("gives a reader with neither access no way to record anything", async () => {
      mockUser.current = reader;
      stubIpasRpcs({ actorId: reader.id, purchasing: false, money: false });
      const row = ipas({ po_number: "P02552" });
      db.seed("ipas_payments", {
        ipas_id: row.id,
        kind: "payment",
        paid_on: "2026-10-01",
        amount: 100,
        php_debited: null,
        charge_fee_php: 0,
        method_id: options.payment_method["Dated Check"].id,
      });

      renderDetail(row.id, "purchasing", "edit");

      expect(await screen.findByTestId("ipas-payment-row")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add payment/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add charge/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Edit Payment/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Remove Payment/ })).not.toBeInTheDocument();
    });

    it("offers no money controls on a filed IPAS", async () => {
      const row = ipas({ po_number: "P02552", state: "filed", filed_at: "2026-10-14T00:00:00.000Z" });

      const payments = renderDetail(row.id, "purchasing", "edit");

      expect(await screen.findByRole("button", { name: "Back to preview" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add payment/ })).not.toBeInTheDocument();
      payments.unmount();

      renderDetail(row.id, "costing", "edit");
      expect(await screen.findByRole("button", { name: "Back to preview" })).toBeInTheDocument();
      expect(screen.getAllByText("Final").length).toBeGreaterThan(0);
      expect(screen.queryByText("Provisional")).not.toBeInTheDocument();
      cleanup();

      renderDetail(row.id, "finance", "edit");
      expect(await screen.findByRole("button", { name: "Back to preview" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add charge/ })).not.toBeInTheDocument();
    });
  });

  describe("Landed Cost", () => {
    it("shows each line per unit, provisional until LC Odoo Done and then final", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id, computation_status: "lc_gs_done" });
      db.seed("ipas_charges", {
        ipas_id: row.id,
        kind_id: options.charge_kind["Brokerage Fee"].id,
        charged_on: "2026-10-12",
        amount_php: 600,
        created_by: purchaser.id,
      });
      const user = setupUser();

      renderDetail(row.id, "costing", "edit");

      const line = await screen.findByTestId("ipas-landed-line");
      // 6 x 1,250 + 600 of charges: 8,100 for the line, 1,350 a unit.
      expect(within(line).getByText(/8,100\.00/)).toBeInTheDocument();
      expect(within(line).getByText(/1,350\.00/)).toBeInTheDocument();
      expect(screen.getAllByText("Provisional").length).toBeGreaterThan(0);
      expect(screen.queryByText("Final")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "LC Odoo Done" }));
      // Landed Cost is worked out from what is stored, so it stays provisional until Save all.
      expect(screen.queryByText("Final")).not.toBeInTheDocument();
      await saveAll(user);

      await waitFor(() => expect(db.rows("ipas")[0].computation_status).toBe("lc_odoo_done"));
      expect((await screen.findAllByText("Final")).length).toBeGreaterThan(0);
      expect(screen.queryByText("Provisional")).not.toBeInTheDocument();
    });

    it("says it is not available on a foreign-currency PO with no payment, rather than showing a guess", async () => {
      const row = ipas({ po_number: "P02445", source: "import", odoo_copy: poCopy("P02445", { currency: "USD" }), created_by: purchaser.id });
      stubEdgeFunction("odoo-po-ipas", { success: true, found: true, ...poCopy("P02445", { currency: "USD" }) });

      renderDetail(row.id, "costing", "edit");

      expect(await screen.findByText("Landed Cost is not available yet")).toBeInTheDocument();
      expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
      expect(screen.queryByTestId("ipas-landed-line")).not.toBeInTheDocument();
    });

    it("spreads by quantity when Purchasing picks it", async () => {
      const row = ipas({
        po_number: "P02552",
        created_by: purchaser.id,
        odoo_copy: poCopy("P02552", {
          lines: [
            { line_id: 1, name: "Small", quantity: 2, unit: "Unit", price_unit: 100, price_subtotal: 200, taxes: [], analytic: [] },
            { line_id: 2, name: "Large", quantity: 8, unit: "Unit", price_unit: 50, price_subtotal: 400, taxes: [], analytic: [] },
          ],
        }),
      });
      stubEdgeFunction("odoo-po-ipas", { success: true, found: true, ...row.odoo_copy });
      db.seed("ipas_charges", {
        ipas_id: row.id,
        kind_id: options.charge_kind["Brokerage Fee"].id,
        charged_on: "2026-10-12",
        amount_php: 1000,
        created_by: purchaser.id,
      });
      const user = setupUser();

      renderDetail(row.id, "costing", "edit");
      await screen.findAllByTestId("ipas-landed-line");
      await user.click(screen.getByRole("combobox", { name: "Spread charges" }));
      await user.click(await screen.findByRole("option", { name: "By quantity" }));
      await saveAll(user);

      await waitFor(() => expect(db.rows("ipas")[0].landed_cost_split).toBe("quantity"));
      // 1,000 over 2 and 8 units: 200 and 800.
      await waitFor(() => {
        const lines = screen.getAllByTestId("ipas-landed-line");
        expect(within(lines[0]).getByText(/400\.00/)).toBeInTheDocument();
        expect(within(lines[1]).getByText(/1,200\.00/)).toBeInTheDocument();
      });
    });
  });
});

describe("IPAS settings", () => {
  let purchaser, superAdmin, employee, options;

  beforeEach(() => {
    purchaser = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    superAdmin = makeEmployee({ name: "Boss", is_super_admin: true });
    employee = makeEmployee({ name: "Someone" });
    options = seedIpasOptions((table, row) => db.seed(table, row));
    mockUser.current = purchaser;
    stubIpasRpcs({ actorId: purchaser.id });
  });

  it("lists the payment methods first, in order, and the other lists on their tabs", async () => {
    const user = setupUser();

    renderSettings();

    const rows = await screen.findAllByTestId("ipas-option-row");
    expect(within(rows[0]).getByText("Alipay")).toBeInTheDocument();
    expect(within(rows.at(-1)).getByText("Other")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Charge kinds" }));
    await waitFor(() => expect(screen.getAllByTestId("ipas-option-row")).toHaveLength(7));
    expect(screen.getByText("Brokerage Fee")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Freight services" }));
    expect(await screen.findByText("DHL")).toBeInTheDocument();
  });

  it("adds an option, refusing a name that is already there", async () => {
    const user = setupUser();

    renderSettings();
    await screen.findAllByTestId("ipas-option-row");
    await user.type(screen.getByRole("textbox", { name: "New payment method" }), "Wise");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(db.rows("ipas_options").some((o) => o.label === "Wise")).toBe(true));
    expect((await screen.findAllByTestId("ipas-option-row")).at(-1)).toHaveTextContent("Wise");

    await user.type(screen.getByRole("textbox", { name: "New payment method" }), "alipay");
    await user.click(screen.getByRole("button", { name: "Add" }));

    // Refused with a sentence (toasted); nothing was added.
    await waitFor(() => expect(screen.getByRole("button", { name: "Add" })).toBeEnabled());
    expect(db.rows("ipas_options").filter((o) => o.list === "payment_method")).toHaveLength(12);
  });

  it("deactivates an option rather than deleting it, and offers it again when switched back", async () => {
    const user = setupUser();

    renderSettings();
    await screen.findAllByTestId("ipas-option-row");
    await user.click(screen.getByRole("switch", { name: "Cash is offered" }));

    await waitFor(() => expect(db.rows("ipas_options").find((o) => o.label === "Cash").active).toBe(false));
    expect(await screen.findByText("Deactivated")).toBeInTheDocument();
    expect(db.rows("ipas_options").some((o) => o.label === "Cash")).toBe(true);

    await user.click(screen.getByRole("switch", { name: "Cash is offered" }));
    await waitFor(() => expect(db.rows("ipas_options").find((o) => o.label === "Cash").active).toBe(true));
    expect(screen.queryByText("Deactivated")).not.toBeInTheDocument();
  });

  it("reorders an option up", async () => {
    const user = setupUser();

    renderSettings();
    await screen.findAllByTestId("ipas-option-row");
    await user.click(screen.getByRole("button", { name: "Move Cash up" }));

    await waitFor(async () => {
      const rows = await screen.findAllByTestId("ipas-option-row");
      expect(rows[2]).toHaveTextContent("Cash");
      expect(rows[3]).toHaveTextContent("Bank TT");
    });
  });

  it("renames an option, keeping it the same option", async () => {
    const user = setupUser();
    const id = options.payment_method["Credit Card"].id;

    renderSettings();
    await screen.findAllByTestId("ipas-option-row");
    await user.click(screen.getByRole("button", { name: "Rename Credit Card" }));
    const dialog = await findOtherDialog();
    const field = within(dialog).getByRole("textbox");
    await user.clear(field);
    await user.type(field, "Corporate Card");
    await user.click(within(dialog).getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(db.rows("ipas_options").find((o) => o.id === id).label).toBe("Corporate Card"));
  });

  describe("an option a filed IPAS uses", () => {
    const hint = /Used on a filed IPAS\. Deactivate it and add a new one instead\./;

    function useOnFiled(over = {}) {
      const filed = ipas({ po_number: "P02600", state: "filed", filed_at: "2026-10-14T00:00:00.000Z", ...over });
      db.seed("ipas_payments", {
        ipas_id: filed.id,
        kind: "down_payment",
        paid_on: "2026-10-01",
        amount: 500,
        method_id: options.payment_method["Dated Check"].id,
        created_by: purchaser.id,
      });
      return filed;
    }

    it("can't be renamed: Rename is off and the hint shows, while Deactivate and reorder stay", async () => {
      const user = setupUser();
      useOnFiled();

      renderSettings();
      const rows = await screen.findAllByTestId("ipas-option-row");
      const check = rows.find((row) => within(row).queryByText("Dated Check"));

      await waitFor(() => expect(within(check).getByRole("button", { name: "Rename Dated Check" })).toBeDisabled());
      expect(within(check).getByText(hint)).toBeInTheDocument();
      expect(screen.getAllByText(hint)).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Rename Cash" })).toBeEnabled();

      await user.click(within(check).getByRole("switch", { name: "Dated Check is offered" }));
      await waitFor(() => expect(db.rows("ipas_options").find((o) => o.label === "Dated Check").active).toBe(false));
      await user.click(screen.getByRole("button", { name: "Move Dated Check up" }));
      await waitFor(() => expect(db.rows("ipas_options").find((o) => o.label === "Dated Check").sort).toBeLessThan(
        db.rows("ipas_options").find((o) => o.label === "Credit Card").sort,
      ));
    });

    it("is still renamable when only an open IPAS uses it", async () => {
      useOnFiled({ state: "open", filed_at: null });

      renderSettings();
      await screen.findAllByTestId("ipas-option-row");

      expect(screen.getByRole("button", { name: "Rename Dated Check" })).toBeEnabled();
      expect(screen.queryByText(hint)).not.toBeInTheDocument();
    });

    it("freezes a document kind's Source and used-for marks too", async () => {
      const user = setupUser();
      const filed = ipas({ po_number: "P02601", state: "filed", filed_at: "2026-10-14T00:00:00.000Z" });
      const waybill = options.document_kind.Waybill;
      db.seed("ipas_documents", { ipas_id: filed.id, kind_id: waybill.id, purchasing_has: true, finance_has: true });

      renderSettings();
      await user.click(await screen.findByRole("tab", { name: "Document kinds" }));
      await screen.findByText("Waybill");

      await waitFor(() => expect(screen.getByRole("combobox", { name: "Waybill: Source" })).toBeDisabled());
      expect(screen.getByRole("combobox", { name: "Waybill: used for" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Rename Waybill" })).toBeDisabled();
      expect(screen.getByRole("combobox", { name: "BL or Waybill: Source" })).toBeEnabled();
    });
  });

  it("is the Purchasing tab of Settings: open to Super Admins and Purchasing access, absent for everyone else", async () => {
    mockUser.current = superAdmin;
    const first = renderSettings();
    expect(await screen.findByRole("tab", { name: "Payment methods" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Purchasing" })).toHaveAttribute("aria-selected", "true");
    first.unmount();

    mockUser.current = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    const second = renderSettings();
    expect(await screen.findByRole("tab", { name: "Payment methods" })).toBeInTheDocument();
    second.unmount();

    mockUser.current = employee;
    renderSettings();
    expect(await screen.findByText("App preferences")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Purchasing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Payment methods" })).not.toBeInTheDocument();
  });

  it("keeps /purchasing/ipas/settings working: it lands on the Purchasing tab, and sends everyone else home", async () => {
    const renderOld = () =>
      renderWithProviders(
        <MemoryRouter initialEntries={["/purchasing/ipas/settings"]}>
          <Routes>
            <Route path="/purchasing/ipas/settings" element={<IpasSettingsRedirect />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/" element={<p>Home</p>} />
          </Routes>
        </MemoryRouter>,
      );

    mockUser.current = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    const first = renderOld();
    expect(await screen.findByRole("tab", { name: "Payment methods" })).toBeInTheDocument();
    first.unmount();

    mockUser.current = employee;
    renderOld();
    expect(await screen.findByText("Home")).toBeInTheDocument();
  });
});
