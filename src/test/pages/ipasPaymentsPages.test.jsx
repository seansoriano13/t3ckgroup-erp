import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import SettingsPage from "@/pages/settings";
import IpasSettingsRedirect from "@/pages/purchasing/ipas/settings";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubEdgeFunction, stubRpc } from "@/test/msw/server";
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc";
import { stubRoomyScreen } from "@/test/roomyScreen";
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

/** Add payment, then the required pick (#1225): the newest row says Paid already. */
const addPayment = async (user) => {
  await user.click(await screen.findByRole("button", { name: "Add payment" }));
  const radios = await screen.findAllByRole("radio", { name: /^Paid already/ });
  await user.click(radios[radios.length - 1]);
};

/** Add charge, then the required pick (#1227): the newest row says Paid already. */
const addCharge = async (user) => {
  await user.click(await screen.findByRole("button", { name: /Add charge/ }));
  const radios = await screen.findAllByRole("radio", { name: /^Paid already/ });
  await user.click(radios[radios.length - 1]);
};

beforeEach(() => stubRoomyScreen());

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

      renderDetail(row.id, "payments", "edit");
      await addPayment(user);
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
      // DP is read off the rows. The record page shows no balance yet (the IPAS list does, #596).
      // The IPAS list sits behind the record window, so read the window only.
      const record = screen.getAllByRole("dialog").find((dialog) => dialog.dataset.modalShell === "record");
      await waitFor(() => expect(within(record).getByText("DP").parentElement).toHaveTextContent(/3,000\.00/));
    }, 20_000);

    it("refuses a half-typed amount with a sentence on Save all, keeps what was typed, and never breaks", { timeout: 20000 }, async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "payments", "edit");
      await addPayment(user);
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

    it("warns before saving a payment that takes the total paid past the order, and still allows the save", async () => {
      // The PO is 7,500.00; 7,000 is already paid, so 1,300 more is 800 over.
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      db.seed("ipas_payments", {
        ipas_id: row.id, kind: "down_payment", paid_on: "2026-10-01", amount: 7000, php_debited: null, charge_fee_php: 0,
        method_id: options.payment_method["Dated Check"].id, check_no: null, proof_url: null, created_by: purchaser.id,
      });
      const user = setupUser();

      renderDetail(row.id, "payments", "edit");
      await addPayment(user);
      const payment = await screen.findByRole("group", { name: "Payment 2" });
      await pick(user, payment, /^Method/, "Dated Check");
      expect(screen.queryByTestId("payment-amount-warning")).not.toBeInTheDocument();
      await user.type(within(payment).getByRole("textbox", { name: /^Amount \(PHP\)/ }), "1300");

      expect(await screen.findByTestId("payment-amount-warning")).toHaveTextContent(/800\.00 more than the order amount of .*7,500\.00/);
      await saveAll(user);
      await waitFor(() => expect(db.rows("ipas_payments")).toHaveLength(2));
    }, 20_000);

    it("shows Overpaid by on the record's money summary when the payments pass the order", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      db.seed("ipas_payments", {
        ipas_id: row.id, kind: "full_payment", paid_on: "2026-10-01", amount: 8325, php_debited: null, charge_fee_php: 0,
        method_id: options.payment_method["Dated Check"].id, check_no: null, proof_url: null, created_by: purchaser.id,
      });
      renderDetail(row.id);
      const summary = await screen.findByTestId("ipas-money-summary");
      expect(summary).toHaveTextContent(/Overpaid by .*825\.00/);
      expect(summary).not.toHaveTextContent("Settled");
    });

    it("refuses a payment dated tomorrow or before 2015 on Save all, with a sentence, and keeps what was typed", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "payments", "edit");
      await addPayment(user);
      const payment = await screen.findByRole("group", { name: "Payment 1" });
      await pick(user, payment, /^Method/, "Dated Check");
      await user.type(within(payment).getByRole("textbox", { name: /^Amount \(PHP\)/ }), "50");

      const date = payment.querySelector('input[type="date"]');
      fireEvent.change(date, { target: { value: "2099-01-01" } });
      await saveAll(user);
      expect(await screen.findAllByText(/payment date cannot be after today/i)).not.toHaveLength(0);
      expect(date).toHaveValue("2099-01-01");
      expect(db.rows("ipas_payments")).toHaveLength(0);

      fireEvent.change(date, { target: { value: "2014-12-31" } });
      await saveAll(user);
      expect(await screen.findAllByText(/payment date cannot be before January 1, 2015/i)).not.toHaveLength(0);
      expect(db.rows("ipas_payments")).toHaveLength(0);
    }, 20_000);

    it("counts a new payment's required boxes, marks them Needed, and counts them as they are filled", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "payments", "edit");
      // Odoo fills the supplier's name; the other three are still needed.
      expect(await screen.findByText(new RegExp("^1 of 4 fields( ·|$)"))).toBeInTheDocument();
      await addPayment(user);
      const payment = await screen.findByRole("group", { name: "Payment 1" });

      // Date starts as today; the amount and the method are still needed.
      expect(screen.getByText(new RegExp("^3 of 8 fields( ·|$)"))).toBeInTheDocument();
      expect(within(payment).getAllByText("Needed")).toHaveLength(2);
      await user.type(within(payment).getByRole("textbox", { name: /^Amount \(PHP\)/ }), "50");
      expect(screen.getByText(new RegExp("^4 of 8 fields( ·|$)"))).toBeInTheDocument();
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

      renderDetail(row.id, "payments", "edit");
      await addPayment(user);
      const payment = await screen.findByRole("group", { name: "Payment 1" });
      await pick(user, payment, /^Method/, "Dated Check");
      await user.type(within(payment).getByRole("textbox", { name: /^Amount \(PHP\)/ }), "500");
      // Editing is in place: open the section if it is still shut.
      const costsHead = screen.getByRole("button", { name: /^3 · Costs/ });
      if (costsHead.getAttribute("aria-expanded") === "false") await user.click(costsHead);
      await addCharge(user);
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

    describe("Charge asks inside Charges (#1227)", () => {
      const seedChargeAsk = (row, over = {}) =>
        db.seed("ipas_payment_asks", {
          ipas_id: row.id,
          amount: 4000,
          purpose: "charge",
          charge_kind_id: options.charge_kind["Brokerage Fee"].id,
          currency: "PHP",
          priority: "high",
          note: null,
          asked_by: purchaser.id,
          asked_at: "2026-11-02T00:00:00Z",
          closed_at: null,
          ...over,
        });

      it("will not save a new charge until Paid already or For payment is picked", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        const user = setupUser();

        renderDetail(row.id, "costs", "edit");
        await user.click(await screen.findByRole("button", { name: /Add charge/ }));
        const charge = await screen.findByRole("group", { name: "Charge 1" });
        const choice = within(charge).getByTestId("payment-mode-choice");
        expect(within(choice).getByText("*")).toBeInTheDocument();
        expect(within(charge).queryByRole("textbox", { name: /^Amount/ })).not.toBeInTheDocument();

        await saveAll(user);
        expect(await screen.findByText(/Charge 1: Pick Paid already or For payment/)).toBeInTheDocument();
        expect(db.rows("ipas_charges")).toHaveLength(0);
        expect(db.rows("ipas_payment_asks")).toHaveLength(0);
      });

      it("saves For payment as a Charge ask with its kind and currency, and nothing counts as a charge", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        const user = setupUser();

        renderDetail(row.id, "costs", "edit");
        await user.click(await screen.findByRole("button", { name: /Add charge/ }));
        await user.click(await screen.findByRole("radio", { name: /^For payment \(not paid yet\)/ }));
        const ask = await screen.findByRole("group", { name: "For payment" });
        await pick(user, ask, /^Kind/, "Brokerage Fee");
        const currency = within(ask).getByRole("textbox", { name: /^Currency/ });
        expect(currency).toHaveValue("PHP");
        await user.clear(currency);
        await user.type(currency, "usd");
        await user.type(within(ask).getByRole("textbox", { name: /^Amount \(USD\)/ }), "700");
        await saveAll(user);

        await waitFor(() => expect(db.rows("ipas_payment_asks")).toHaveLength(1));
        expect(db.rows("ipas_payment_asks")[0]).toMatchObject({
          purpose: "charge",
          amount: 700,
          currency: "USD",
          charge_kind_id: options.charge_kind["Brokerage Fee"].id,
        });
        expect(db.rows("ipas_charges")).toHaveLength(0);
        const liner = await screen.findByTestId("payment-ask-liner");
        expect(liner).toHaveTextContent(/Brokerage Fee/);
        expect(liner).toHaveTextContent(/700\.00/);
      });

      it("shows an open Charge ask as a grey row in the Charges table, in its own currency", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        seedChargeAsk(row, { amount: 700, currency: "USD", note: "Forwarder bill" });

        renderDetail(row.id, "costs");
        const grey = await screen.findByTestId("ipas-charge-ask-row");
        expect(grey).toHaveTextContent(/Brokerage Fee/);
        expect(grey).toHaveTextContent(/Not paid yet/);
        expect(grey).toHaveTextContent(/700\.00/);
        expect(grey).toHaveTextContent(/Forwarder bill/);
        // It is not in Payments.
        expect(screen.queryByTestId("ipas-payment-ask-row")).not.toBeInTheDocument();
      });

      it("gives the grey row Record as paid, Edit and Withdraw to a writer, and a Charge ask has no % of order", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        const open = seedChargeAsk(row, { amount: 4000 });
        const user = setupUser();

        renderDetail(row.id, "costs");
        const grey = await screen.findByTestId("ipas-charge-ask-row");
        expect(within(grey).getByRole("button", { name: "Record as paid" })).toBeInTheDocument();

        await user.click(within(grey).getByRole("button", { name: /^Edit/ }));
        const dialog = await topDialog();
        expect(within(dialog).queryByRole("textbox", { name: /% of order/ })).not.toBeInTheDocument();
        const amount = within(dialog).getByRole("textbox", { name: /^Amount/ });
        await user.clear(amount);
        await user.type(amount, "4500");
        await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
        await waitFor(() => expect(db.rows("ipas_payment_asks").find((a) => a.id === open.id).amount).toBe(4500));

        await user.click(await within(await screen.findByTestId("ipas-charge-ask-row")).findByRole("button", { name: /^Withdraw/ }));
        await waitFor(() => expect(db.rows("ipas_payment_asks").find((a) => a.id === open.id)).toMatchObject({ closed_reason: "withdrawn" }));
        await waitFor(() => expect(screen.queryByTestId("ipas-charge-ask-row")).not.toBeInTheDocument());
      });

      it("Record as paid on the grey row opens the edit form on a filled charge linked to that ask", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        const open = seedChargeAsk(row, { amount: 4000 });
        const user = setupUser();

        renderDetail(row.id, "costs");
        await user.click(await within(await screen.findByTestId("ipas-charge-ask-row")).findByRole("button", { name: "Record as paid" }));
        const charge = await screen.findByRole("group", { name: "Charge 1" });
        expect(within(charge).getByRole("combobox", { name: /^Kind/ })).toHaveTextContent("Brokerage Fee");
        expect(within(charge).getByRole("textbox", { name: /^Amount \(PHP\)/ })).toHaveValue("4000");
        expect(within(charge).getByRole("checkbox", { name: /Does this pay the open item\?/ })).toBeChecked();
        await saveAll(user);
        await waitFor(() => expect(db.rows("ipas_charges")[0]).toMatchObject({ amount_php: 4000, ask_id: open.id }));
      });

      it("shows no buttons on the grey row to someone who cannot write", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        seedChargeAsk(row);
        mockUser.current = reader;
        stubIpasRpcs({ actorId: reader.id, purchasing: false, money: false });

        renderDetail(row.id, "costs");
        const grey = await screen.findByTestId("ipas-charge-ask-row");
        expect(within(grey).queryByRole("button")).not.toBeInTheDocument();
      });

      it("marks Currency and Amount as required on a Charge ask", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        const user = setupUser();

        renderDetail(row.id, "costs", "edit");
        await user.click(await screen.findByRole("button", { name: /Add charge/ }));
        await user.click(await screen.findByRole("radio", { name: /^For payment \(not paid yet\)/ }));
        const ask = await screen.findByRole("group", { name: "For payment" });
        for (const name of [/^Currency/, /^Amount/]) {
          const box = within(ask).getByRole("textbox", { name });
          expect(ask.querySelector(`label[for="${box.id}"]`)).toHaveTextContent("*");
        }
      });

      it("Record as paid fills the kind and, for a PHP ask, the amount; saving closes that ask", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        const open = seedChargeAsk(row, { amount: 4000 });
        const user = setupUser();

        renderDetail(row.id, "costs", "edit");
        await user.click(await screen.findByRole("button", { name: "Record as paid" }));
        const charge = await screen.findByRole("group", { name: "Charge 1" });
        expect(within(charge).getByRole("combobox", { name: /^Kind/ })).toHaveTextContent("Brokerage Fee");
        expect(within(charge).getByRole("textbox", { name: /^Amount \(PHP\)/ })).toHaveValue("4000");
        expect(within(charge).getByRole("checkbox", { name: /Does this pay the open item\?/ })).toBeChecked();
        await saveAll(user);

        await waitFor(() => expect(db.rows("ipas_charges")).toHaveLength(1));
        expect(db.rows("ipas_charges")[0]).toMatchObject({ amount_php: 4000, ask_id: open.id });
        expect(db.rows("ipas_payment_asks").find((a) => a.id === open.id)).toMatchObject({ closed_reason: "paid" });
      });

      it("keeps the amount blank for a foreign-currency ask and shows the asked amount as a hint", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        seedChargeAsk(row, { amount: 700, currency: "USD" });
        const user = setupUser();

        renderDetail(row.id, "costs", "edit");
        await user.click(await screen.findByRole("button", { name: "Record as paid" }));
        const charge = await screen.findByRole("group", { name: "Charge 1" });
        expect(within(charge).getByRole("textbox", { name: /^Amount \(PHP\)/ })).toHaveValue("");
        expect(within(charge).getByTestId("charge-ask-hint")).toHaveTextContent(/700\.00/);
      });

      it("asks \"Does this pay the open item?\" on a plain Add charge, and a charge cannot be offered a payment's ask", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        seedChargeAsk(row, { amount: 4000 });
        seedChargeAsk(row, { amount: 900, asked_at: "2026-11-05T00:00:00Z" });
        const user = setupUser();

        renderDetail(row.id, "costs", "edit");
        await addCharge(user);
        const charge = await screen.findByRole("group", { name: "Charge 1" });
        expect(within(charge).getByTestId("payment-pays-ask")).toHaveTextContent(/Does this pay the open item\?/);
        cleanup();

        // A payment is never offered a Charge ask, and Payments shows no grey row for it.
        renderDetail(row.id, "payments", "edit");
        await addPayment(user);
        const payment = await screen.findByRole("group", { name: "Payment 1" });
        expect(within(payment).queryByTestId("payment-pays-ask")).not.toBeInTheDocument();
        expect(screen.queryByTestId("payment-ask-liner")).not.toBeInTheDocument();
      });
    });

    describe("For payment inside Payments (#1225)", () => {
      const seedAsk = (row, over = {}) =>
        db.seed("ipas_payment_asks", {
          ipas_id: row.id,
          amount: 5000,
          purpose: "down_payment",
          priority: "high",
          note: null,
          asked_by: purchaser.id,
          asked_at: "2026-11-02T00:00:00Z",
          closed_at: null,
          ...over,
        });

      it("will not save a new row until Paid already or For payment is picked, and marks the pick required", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        const user = setupUser();

        renderDetail(row.id, "payments", "edit");
        await user.click(await screen.findByRole("button", { name: "Add payment" }));
        const payment = await screen.findByRole("group", { name: "Payment 1" });
        const choice = within(payment).getByTestId("payment-mode-choice");
        expect(within(choice).getByText("*")).toBeInTheDocument();
        expect(within(choice).getAllByRole("radio").every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);
        // Nothing else is asked until the pick is made.
        expect(within(payment).queryByRole("textbox", { name: /^Amount/ })).not.toBeInTheDocument();

        await saveAll(user);
        expect(await screen.findByText(/Payment 1: Pick Paid already or For payment/)).toBeInTheDocument();
        expect(db.rows("ipas_payments")).toHaveLength(0);
        expect(db.rows("ipas_payment_asks")).toHaveLength(0);

        // Picking clears the message at once, without another Save (#1236).
        await user.click(within(choice).getByRole("radio", { name: /^For payment \(not paid yet\)/ }));
        await waitFor(() => expect(screen.queryByText(/Payment 1: Pick Paid already or For payment/)).not.toBeInTheDocument());
        expect(within(choice).getByRole("radio", { name: /^For payment \(not paid yet\)/ })).toHaveAttribute("aria-checked", "true");
      });

      it("saves For payment as an ask with no date, method or proof, and nothing counts as paid", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        const user = setupUser();

        renderDetail(row.id, "payments", "edit");
        await user.click(await screen.findByRole("button", { name: "Add payment" }));
        await user.click(await screen.findByRole("radio", { name: /^For payment \(not paid yet\)/ }));
        const ask = await screen.findByRole("group", { name: "For payment" });
        expect(within(ask).queryByRole("textbox", { name: /^Method/ })).not.toBeInTheDocument();
        expect(within(ask).queryByText(/Proof of payment/)).not.toBeInTheDocument();
        await user.type(within(ask).getByRole("textbox", { name: /^Amount \(PHP\)/ }), "3000");
        await user.type(within(ask).getByRole("textbox", { name: /^Note/ }), "Supplier wants it Friday");
        await saveAll(user);

        await waitFor(() => expect(db.rows("ipas_payment_asks")).toHaveLength(1));
        expect(db.rows("ipas_payment_asks")[0]).toMatchObject({ amount: 3000, purpose: "down_payment", priority: "high", note: "Supplier wants it Friday" });
        expect(db.rows("ipas_payments")).toHaveLength(0);
        const liner = await screen.findByTestId("payment-ask-liner");
        expect(liner).toHaveTextContent(/Not paid yet/);
        expect(liner).toHaveTextContent(/3,000\.00/);
        expect(liner).toHaveTextContent(/Supplier wants it Friday/);
      });

      it("shows each open ask as a grey row with no payments yet, with its priority and note", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        seedAsk(row, { note: "Before the vessel leaves", priority: "very_high" });
        seedAsk(row, { amount: 2000, purpose: "balance", asked_at: "2026-11-09T00:00:00Z" });
        const user = setupUser();

        renderDetail(row.id, "payments", "edit");
        const liners = await screen.findAllByTestId("payment-ask-liner");
        expect(liners).toHaveLength(2);
        expect(liners[0]).toHaveTextContent(/Not paid yet/);
        expect(liners[0]).toHaveTextContent(/Down payment/);
        expect(liners[0]).toHaveTextContent(/Before the vessel leaves/);
        expect(liners[0]).toHaveTextContent(/Very High priority/);
        expect(within(liners[0]).getByRole("button", { name: "Record as paid" })).toBeInTheDocument();
        expect(within(liners[0]).getByRole("button", { name: /^Edit/ })).toBeInTheDocument();
        expect(within(liners[0]).getByRole("button", { name: /^Withdraw/ })).toBeInTheDocument();
        // Nothing has been paid.
        expect(db.rows("ipas_payments")).toHaveLength(0);
        expect(user).toBeTruthy();
      });

      it("Record as paid opens a filled, linked payment; saving it closes the ask and its grey row goes", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        const open = seedAsk(row, { amount: 2250 });
        const user = setupUser();

        renderDetail(row.id, "payments", "edit");
        await user.click(await screen.findByRole("button", { name: "Record as paid" }));
        const payment = await screen.findByRole("group", { name: "Payment 1" });
        expect(within(payment).getByRole("textbox", { name: /^Amount \(PHP\)/ })).toHaveValue("2250");
        expect(within(payment).getByRole("combobox", { name: /^Kind/ })).toHaveTextContent("Down payment");
        expect(within(payment).getByRole("checkbox", { name: /Does this pay the open item\?/ })).toBeChecked();
        // The same ask cannot be recorded twice at once.
        expect(screen.getByRole("button", { name: "Record as paid" })).toBeDisabled();
        await pick(user, payment, /^Method/, "Dated Check");
        await saveAll(user);

        await waitFor(() => expect(db.rows("ipas_payments")).toHaveLength(1));
        expect(db.rows("ipas_payments")[0]).toMatchObject({ kind: "down_payment", amount: 2250, ask_id: open.id });
        expect(db.rows("ipas_payment_asks").find((a) => a.id === open.id)).toMatchObject({ closed_reason: "paid" });
        await waitFor(() => expect(screen.queryByTestId("payment-ask-liner")).not.toBeInTheDocument());
      });

      it("fills Full payment for a Balance that pays off what is left", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        // The PO totals 8,325.00 with nothing paid, so a Balance of that pays it off.
        seedAsk(row, { amount: 8325, purpose: "balance" });
        const user = setupUser();

        renderDetail(row.id, "payments", "edit");
        await user.click(await screen.findByRole("button", { name: "Record as paid" }));
        const payment = await screen.findByRole("group", { name: "Payment 1" });
        expect(within(payment).getByRole("combobox", { name: /^Kind/ })).toHaveTextContent("Full payment");
      });

      it("fills Payment for a Balance that leaves something unpaid", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        seedAsk(row, { amount: 2000, purpose: "balance" });
        const user = setupUser();

        renderDetail(row.id, "payments", "edit");
        await user.click(await screen.findByRole("button", { name: "Record as paid" }));
        const payment = await screen.findByRole("group", { name: "Payment 1" });
        const kind = within(payment).getByRole("combobox", { name: /^Kind/ });
        expect(kind).toHaveTextContent("Payment");
        expect(kind).not.toHaveTextContent(/Full payment|Down payment/);
      });

      it("withdraws an ask from its grey row, and changes one with Edit", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        const first = seedAsk(row, { amount: 5000 });
        const second = seedAsk(row, { amount: 2000, purpose: "balance", asked_at: "2026-11-09T00:00:00Z" });
        const user = setupUser();

        renderDetail(row.id, "payments", "edit");
        const [firstLiner] = await screen.findAllByTestId("payment-ask-liner");
        await user.click(within(firstLiner).getByRole("button", { name: /^Edit/ }));
        const dialog = await topDialog();
        const amount = within(dialog).getByRole("textbox", { name: /^Amount/ });
        expect(amount).toHaveValue("5000");
        await user.clear(amount);
        await user.type(amount, "4500");
        await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
        await waitFor(() => expect(db.rows("ipas_payment_asks").find((a) => a.id === first.id).amount).toBe(4500));

        const liners = await screen.findAllByTestId("payment-ask-liner");
        await user.click(within(liners[1]).getByRole("button", { name: /^Withdraw/ }));
        await waitFor(() => expect(db.rows("ipas_payment_asks").find((a) => a.id === second.id)).toMatchObject({ closed_reason: "withdrawn" }));
        await waitFor(() => expect(screen.getAllByTestId("payment-ask-liner")).toHaveLength(1));
      });

      it("gives a Payments grey row Record as paid, Edit and Withdraw; Record as paid opens a filled, linked payment", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        const open = seedAsk(row, { amount: 2250 });
        const user = setupUser();

        renderDetail(row.id, "payments");
        const grey = await screen.findByTestId("ipas-payment-ask-row");
        expect(within(grey).getByRole("button", { name: /^Edit/ })).toBeInTheDocument();
        expect(within(grey).getByRole("button", { name: /^Withdraw/ })).toBeInTheDocument();
        await user.click(within(grey).getByRole("button", { name: "Record as paid" }));
        const payment = await screen.findByRole("group", { name: "Payment 1" });
        expect(within(payment).getByRole("textbox", { name: /^Amount \(PHP\)/ })).toHaveValue("2250");
        expect(within(payment).getByRole("checkbox", { name: /Does this pay the open item\?/ })).toBeChecked();
        await pick(user, payment, /^Method/, "Dated Check");
        await saveAll(user);
        await waitFor(() => expect(db.rows("ipas_payments")[0]).toMatchObject({ amount: 2250, ask_id: open.id }));
      });

      it("withdraws a Payments ask from its grey row, and Amount is marked required in the dialog", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        const open = seedAsk(row, { amount: 2250 });
        const user = setupUser();

        renderDetail(row.id, "payments");
        await user.click(await within(await screen.findByTestId("ipas-payment-ask-row")).findByRole("button", { name: /^Edit/ }));
        const dialog = await topDialog();
        expect(dialog.querySelector('label[for="ask-amount"]')).toHaveTextContent("*");
        // One Cancel: the window's own (#1236).
        expect(within(dialog).getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
        await user.keyboard("{Escape}");
        await user.click(await within(await screen.findByTestId("ipas-payment-ask-row")).findByRole("button", { name: /^Withdraw/ }));
        await waitFor(() => expect(db.rows("ipas_payment_asks").find((a) => a.id === open.id)).toMatchObject({ closed_reason: "withdrawn" }));
      });

      it("names the ask a payment paid when it is removed, and says that ask stays closed", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        const paying = db.seed("ipas_payments", {
          ipas_id: row.id, kind: "down_payment", paid_on: "2026-10-01", amount: 5000, php_debited: null, charge_fee_php: 0,
          method_id: options.payment_method["Dated Check"].id, check_no: null, proof_url: null, created_by: purchaser.id,
        });
        seedAsk(row, { amount: 5000, purpose: "down_payment", closed_at: "2026-10-02T00:00:00Z", closed_reason: "paid", paid_by_payment_id: paying.id });
        const user = setupUser();

        renderDetail(row.id, "payments", "edit");
        await user.click(await screen.findByRole("button", { name: /^Remove Down payment of Oct 1, 2026/ }));
        const confirm = await topDialog();
        expect(confirm).toHaveTextContent(/It paid this ask: Down payment/);
        expect(confirm).toHaveTextContent(/stays closed/);
      });

      it("has no Ask for payment in the More menu", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        const user = setupUser();

        renderDetail(row.id);
        await user.click(await screen.findByRole("button", { name: /^More/ }));
        // The menu is open (it offers On-Hold) and has no ask in it.
        expect(await screen.findByRole("button", { name: /Put On-Hold/ })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Ask for payment|Payment ask/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("menuitem", { name: /Ask for payment|Payment ask/ })).not.toBeInTheDocument();
      });
    });

    describe("Does this pay the open item? (#1224)", () => {
      const seedAsk = (row, over = {}) =>
        db.seed("ipas_payment_asks", {
          ipas_id: row.id,
          amount: 5000,
          purpose: "down_payment",
          priority: "high",
          asked_by: purchaser.id,
          asked_at: "2026-11-02T00:00:00Z",
          closed_at: null,
          ...over,
        });
      const fillPayment = async (user, payment) => {
        await user.type(within(payment).getByRole("textbox", { name: /^Amount \(PHP\)/ }), "3000");
        await pick(user, payment, /^Method/, "Dated Check");
      };

      it("offers a tick, on by default, for one open ask; the smaller payment closes only that ask", async () => {
        const row = ipas({ po_number: "P02552", created_by: purchaser.id });
        const open = seedAsk(row);
        const user = setupUser();

        renderDetail(row.id, "payments", "edit");
        await addPayment(user);
        const payment = await screen.findByRole("group", { name: "Payment 1" });
        const tick = within(payment).getByRole("checkbox", { name: /Does this pay the open item\?/ });
        expect(tick).toBeChecked();
        await fillPayment(user, payment);
        await saveAll(user);

        await waitFor(() => expect(db.rows("ipas_payments")).toHaveLength(1));
        expect(db.rows("ipas_payments")[0].ask_id).toBe(open.id);
        expect(db.rows("ipas_payment_asks").find((a) => a.id === open.id)).toMatchObject({ closed_reason: "paid" });
      });

      it("closes nothing when the tick is taken off", async () => {
        const row = ipas({ po_number: "P02553", created_by: purchaser.id });
        const open = seedAsk(row);
        const user = setupUser();

        renderDetail(row.id, "payments", "edit");
        await addPayment(user);
        const payment = await screen.findByRole("group", { name: "Payment 1" });
        await user.click(within(payment).getByRole("checkbox", { name: /Does this pay the open item\?/ }));
        await fillPayment(user, payment);
        await saveAll(user);

        await waitFor(() => expect(db.rows("ipas_payments")).toHaveLength(1));
        expect(db.rows("ipas_payments")[0].ask_id ?? null).toBeNull();
        expect(db.rows("ipas_payment_asks").find((a) => a.id === open.id).closed_at).toBeNull();
      });

      it("offers a pick of the open asks plus None for several, defaulting to the oldest", { timeout: 20000 }, async () => {
        const row = ipas({ po_number: "P02554", created_by: purchaser.id });
        const older = seedAsk(row, { amount: 5000, asked_at: "2026-11-02T00:00:00Z" });
        const newer = seedAsk(row, { amount: 2000, purpose: "balance", asked_at: "2026-11-09T00:00:00Z" });
        const user = setupUser();

        renderDetail(row.id, "payments", "edit");
        await addPayment(user);
        const payment = await screen.findByRole("group", { name: "Payment 1" });
        const choose = within(payment).getByRole("combobox", { name: /Does this pay the open item\?/ });
        expect(choose).toHaveTextContent(/Down payment/);
        await user.click(choose);
        expect(await screen.findByRole("option", { name: "None" })).toBeInTheDocument();
        await user.click(screen.getByRole("option", { name: /Balance/ }));
        await fillPayment(user, payment);
        await saveAll(user);

        await waitFor(() => expect(db.rows("ipas_payments")).toHaveLength(1));
        expect(db.rows("ipas_payments")[0].ask_id).toBe(newer.id);
        const asks = db.rows("ipas_payment_asks");
        expect(asks.find((a) => a.id === newer.id).closed_reason).toBe("paid");
        expect(asks.find((a) => a.id === older.id).closed_at).toBeNull();
      });

      it("shows nothing when no ask is open", async () => {
        const row = ipas({ po_number: "P02555", created_by: purchaser.id });
        seedAsk(row, { closed_at: "2026-11-03T00:00:00Z", closed_reason: "withdrawn" });
        const user = setupUser();

        renderDetail(row.id, "payments", "edit");
        await addPayment(user);
        const payment = await screen.findByRole("group", { name: "Payment 1" });
        expect(within(payment).queryByText(/Does this pay the open item\?/)).not.toBeInTheDocument();
      });
    });

    it("drops an unsaved payment when it is removed, without asking", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "payments", "edit");
      await addPayment(user);
      const payment = await screen.findByRole("group", { name: "Payment 1" });
      await user.click(within(payment).getByRole("button", { name: "Remove payment 1" }));

      expect(screen.queryByRole("group", { name: "Payment 1" })).not.toBeInTheDocument();
      expect(queryOtherDialog()).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Save all/ })).toBeDisabled();
    });

    it("takes the forex rate as optional on a foreign-currency PO, and shows Landed Cost as an estimate until it is filled", { timeout: 20000 }, async () => {
      const row = ipas({ po_number: "P02445", source: "import", odoo_copy: poCopy("P02445", { currency: "USD" }), created_by: purchaser.id });
      stubEdgeFunction("odoo-po-ipas", { success: true, found: true, ...poCopy("P02445", { currency: "USD" }) });
      // A Reference Rate older than any payment date, so the estimate has something to stand on.
      db.seed("currency_rate_currencies", { currency: "USD" });
      db.seed("currency_rates", { currency: "USD", rate_date: "2000-01-01", php_per_unit: 56, source: "test" });
      stubRpc("reference_rate", () => [{ currency: "USD", rate_date: "2000-01-01", php_per_unit: 56, source: "test", overridden: false, divergence_pct: 0 }]);
      const user = setupUser();

      renderDetail(row.id, "payments", "edit");
      await addPayment(user);
      const payment = await screen.findByRole("group", { name: "Payment 1" });
      await pick(user, payment, /^Method/, "Alipay");

      const amount = within(payment).getByRole("textbox", { name: /^Amount \(USD\)/ });
      // Pre-filled with the day's Reference Rate (#708); cleared, the payment is an estimate.
      const rate = within(payment).getByRole("textbox", { name: /^Forex rate paid/ });
      await waitFor(() => expect(rate).toHaveValue("56"));
      await user.clear(rate);
      await user.type(amount, "640");
      // Optional (#604): no Needed mark, a one-line explanation under it, and Save all goes without it.
      expect(within(payment).queryByText("Needed")).not.toBeInTheDocument();
      expect(within(payment).getByTestId("payment-pesos-hint")).toHaveTextContent(/Pre-filled with the Reference Rate/);
      await saveAll(user);

      await waitFor(() => expect(db.rows("ipas_payments")).toHaveLength(1));
      expect(db.rows("ipas_payments")[0]).toMatchObject({ amount: 640, php_debited: null });
      // The edit view stays. Back to the section, then open Costing from its header.
      await waitFor(() => expect(screen.getByText("All changes saved")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Done" }));
      expect(await screen.findByRole("button", { name: /^2 · Payments/ })).toHaveAttribute("aria-expanded", "true");
      expect(queryOtherDialog()).not.toBeInTheDocument();
      // The section header, its number first.
      const costs = await screen.findByRole("button", { name: /^3 · Costs/ });
      if (costs.getAttribute("aria-expanded") !== "true") await user.click(costs);
      expect(await screen.findByTestId("ipas-landed-line")).toBeInTheDocument();
      // Worked out at the Reference Rate, marked as an estimate; the payment's column stays blank.
      expect(screen.getByTestId("landed-cost-estimate-note")).toHaveTextContent(/Estimate: A payment is taken at the Reference Rate/);
      expect(screen.getByText("Estimate")).toBeInTheDocument();
      expect(db.rows("ipas_payments")[0].php_debited).toBeNull();
    });

    it("shows the Reference Rate for the payment's date beside the typed rate, pre-fills it, and flags a wide gap", { timeout: 20000 }, async () => {
      const row = ipas({ po_number: "P02446", source: "import", odoo_copy: poCopy("P02446", { currency: "USD" }), created_by: purchaser.id });
      stubEdgeFunction("odoo-po-ipas", { success: true, found: true, ...poCopy("P02446", { currency: "USD" }) });
      const asked = [];
      stubRpc("reference_rate", (args) => {
        asked.push(args.p_on);
        return [{ currency: "USD", rate_date: "2026-09-12", php_per_unit: 58.2, source: "ECB", overridden: false, divergence_pct: 2 }];
      });
      const user = setupUser();

      renderDetail(row.id, "payments", "edit");
      await addPayment(user);
      const dialog = await screen.findByRole("group", { name: "Payment 1" });
      await pick(user, dialog, /^Method/, "Alipay");
      const date = within(dialog).getByLabelText(/^Date/);
      await user.clear(date);
      await user.type(date, "2026-09-12");

      // The rate paid starts at the Reference Rate of the date (#708).
      const phpDebited = within(dialog).getByRole("textbox", { name: /^Forex rate paid/ });
      await waitFor(() => expect(phpDebited).toHaveValue("58.2"));
      const line = await within(dialog).findByTestId("payment-reference-rate");
      expect(line).toHaveTextContent(/reference: ₱58\.20 on 12 Sep/);
      expect(asked).toContain("2026-09-12");

      await user.type(within(dialog).getByRole("textbox", { name: /^Amount \(USD\)/ }), "1000");
      await user.clear(phpDebited);
      await user.type(phpDebited, "58.44");
      expect(line).toHaveTextContent(/you typed ₱58\.44/);
      expect(within(dialog).queryByTestId("payment-rate-divergence")).not.toBeInTheDocument();

      await user.clear(phpDebited);
      await user.type(phpDebited, "5.844");
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

      renderDetail(row.id, "payments", "edit");
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

      renderDetail(row.id, "order", "edit");
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

      renderDetail(row.id, "order", "edit");
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

      renderDetail(row.id, "costs", "edit");
      await addCharge(user);
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

      renderDetail(row.id, "costs", "edit");

      expect(await screen.findByText("Delivery Fee")).toBeInTheDocument();
    });
  });

  describe("who is offered what", () => {
    it("gives Finance payments and charges, but not the typed amount, the freight service or the status", async () => {
      mockUser.current = finance;
      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
      const row = ipas({ po_number: "P02552" });

      // Section by section.
      const payments = renderDetail(row.id, "payments", "edit");
      expect(await screen.findByRole("button", { name: "Add payment" })).toBeInTheDocument();
      // The amount and the freight service are Purchasing's: present, but not typeable by Finance.
      expect(screen.getByRole("textbox", { name: /^P\.I\/QT Amount/ })).toBeDisabled();
      expect(screen.getByRole("combobox", { name: /^Freight service/ })).toBeDisabled();
      payments.unmount();

      renderDetail(row.id, "costs", "edit");
      // Each section holds its own controls: payments in 2 · Payments, charges in 3 · Costs.
      const costsSection = within(await screen.findByRole("region", { name: "3 · Costs" }));
      expect(await costsSection.findByRole("button", { name: /Add charge/ })).toBeInTheDocument();
      expect(costsSection.queryByRole("button", { name: /Add payment/ })).not.toBeInTheDocument();
      cleanup();

      renderDetail(row.id, "costs", "edit");
      expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "LC Odoo Done" })).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Spread charges" })).not.toBeInTheDocument();
    });

    it("gives a Super Admin with no other access payments and charges on an open IPAS, and nothing on a filed one (#1222)", async () => {
      const boss = makeEmployee({ name: "Boss", is_super_admin: true });
      mockUser.current = boss;
      stubIpasRpcs({ actorId: boss.id, purchasing: false, superAdmin: true });
      const open = ipas({ po_number: "P02552" });
      const paymentsView = renderDetail(open.id, "payments", "edit");
      expect(await screen.findByRole("button", { name: "Add payment" })).toBeInTheDocument();
      paymentsView.unmount();

      renderDetail(open.id, "costs", "edit");
      expect(await screen.findByRole("button", { name: /Add charge/ })).toBeInTheDocument();
      cleanup();

      const filed = ipas({ po_number: "P02553", state: "filed" });
      renderDetail(filed.id, "payments", "edit");
      await screen.findByRole("region", { name: /Payments/ });
      expect(screen.queryByRole("button", { name: /Add payment/ })).not.toBeInTheDocument();
    });

    it("gives Finance no status step at all: the record reads Final, and Checked by is gone", async () => {
      mockUser.current = finance;
      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
      const row = ipas({ po_number: "P02552", computation_status: "lc_odoo_done" });

      renderDetail(row.id, "costs", "edit");

      expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
      expect(screen.getAllByText("Final").length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: "LC GS Done" })).not.toBeInTheDocument();
      expect(screen.queryByText("Checked by")).not.toBeInTheDocument();
    });

    it("gives Finance no status step before LC Odoo Done", async () => {
      mockUser.current = finance;
      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
      const row = ipas({ po_number: "P02552", computation_status: "encoded" });

      renderDetail(row.id, "costs", "edit");

      expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "LC GS Done" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Checked by" })).not.toBeInTheDocument();
    });

    it("gives Purchasing no step buttons while editing: Landed Cost is marked final from the rail", async () => {
      const row = ipas({ po_number: "P02552", computation_status: "encoded" });
      const user = setupUser();

      renderDetail(row.id, "costs", "edit");

      expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
      for (const step of ["Encoding", "LC GS Done", "LC Odoo Done", "Checked by"]) {
        expect(screen.queryByRole("button", { name: step })).not.toBeInTheDocument();
      }
      await user.click(within(screen.getByTestId("ipas-journey-landed")).getByRole("button", { name: "Mark Landed Cost final" }));
      await waitFor(() => expect(db.rows("ipas")[0].computation_status).toBe("lc_odoo_done"));
    });

    it("reads Landed Cost as Provisional until LC Odoo Done and then as Final, for a reader too", async () => {
      mockUser.current = reader;
      stubIpasRpcs({ actorId: reader.id, purchasing: false, money: false });
      const early = ipas({ po_number: "P02552", computation_status: "lc_gs_done" });

      const view = renderDetail(early.id, "costs");
      expect((await screen.findAllByText("Provisional")).length).toBeGreaterThan(0);
      expect(screen.queryByText("Final")).not.toBeInTheDocument();
      view.unmount();

      const done = ipas({ po_number: "P02553", computation_status: "lc_odoo_done" });
      renderDetail(done.id, "costs");
      expect((await screen.findAllByText("Final")).length).toBeGreaterThan(0);
      expect(screen.queryByText("Provisional")).not.toBeInTheDocument();
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

      renderDetail(row.id, "payments", "edit");

      expect(await screen.findByTestId("ipas-payment-row")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add payment/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add charge/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Edit Payment/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Remove Payment/ })).not.toBeInTheDocument();
    });

    it("offers no money controls on a filed IPAS", async () => {
      const row = ipas({ po_number: "P02552", state: "filed", filed_at: "2026-10-14T00:00:00.000Z", computation_status: "lc_odoo_done" });

      const payments = renderDetail(row.id, "payments", "edit");

      expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add payment/ })).not.toBeInTheDocument();
      payments.unmount();

      renderDetail(row.id, "costs", "edit");
      expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
      expect(screen.getAllByText("Final").length).toBeGreaterThan(0);
      expect(screen.queryByText("Provisional")).not.toBeInTheDocument();
      cleanup();

      renderDetail(row.id, "costs", "edit");
      expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
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

      renderDetail(row.id, "costs", "edit");

      const line = await screen.findByTestId("ipas-landed-line");
      // 6 x 1,250 + 600 of charges: 1,350 a unit.
      expect(within(line).getByText(/1,350\.00/)).toBeInTheDocument();
      expect(screen.getAllByText("Provisional").length).toBeGreaterThan(0);
      expect(screen.queryByText("Final")).not.toBeInTheDocument();

      // Marked final from the rail, in one click.
      await user.click(within(screen.getByTestId("ipas-journey-landed")).getByRole("button", { name: "Mark Landed Cost final" }));

      await waitFor(() => expect(db.rows("ipas")[0].computation_status).toBe("lc_odoo_done"));
      expect((await screen.findAllByText("Final")).length).toBeGreaterThan(0);
      expect(screen.queryByText("Provisional")).not.toBeInTheDocument();
    });

    it("starts the Item column narrow, and the grip on its edge resizes it with the arrow keys", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "costs", "edit");

      const grip = await screen.findByTestId("ipas-landed-item-resizer");
      const heading = grip.closest("th");
      expect(heading).toHaveStyle({ width: "176px" });
      expect(within(screen.getByTestId("ipas-landed-line")).getByText("Greenspirit 2 Cutter").closest("td")).toHaveStyle({ width: "176px" });

      grip.focus();
      await user.keyboard("{ArrowRight}");
      expect(heading).toHaveStyle({ width: "192px" });
      await user.keyboard("{ArrowLeft}{ArrowLeft}");
      expect(heading).toHaveStyle({ width: "160px" });
    });

    it("says it is not available on a foreign-currency PO with no payment, rather than showing a guess", async () => {
      const row = ipas({ po_number: "P02445", source: "import", odoo_copy: poCopy("P02445", { currency: "USD" }), created_by: purchaser.id });
      stubEdgeFunction("odoo-po-ipas", { success: true, found: true, ...poCopy("P02445", { currency: "USD" }) });

      renderDetail(row.id, "costs", "edit");

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

      renderDetail(row.id, "costs", "edit");
      await screen.findAllByTestId("ipas-landed-line");
      await user.click(screen.getByRole("combobox", { name: "Spread charges" }));
      await user.click(await screen.findByRole("option", { name: "By quantity" }));
      await saveAll(user);

      await waitFor(() => expect(db.rows("ipas")[0].landed_cost_split).toBe("quantity"));
      // 1,000 over 2 and 8 units: 200 and 800, so 200.00 and 150.00 landed a unit.
      await waitFor(() => {
        const lines = screen.getAllByTestId("ipas-landed-line");
        expect(within(lines[0]).getByText(/200\.00/)).toBeInTheDocument();
        expect(within(lines[1]).getByText(/150\.00/)).toBeInTheDocument();
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
    expect(within(rows.at(-1)).getByText("Others")).toBeInTheDocument();

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
