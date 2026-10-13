import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import SettingsPage from "@/pages/settings";
import IpasSettingsRedirect from "@/pages/purchasing/ipas/settings";
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

/** Picks an option of the SelectField labelled `label`. */
const pick = async (user, scope, label, optionName) => {
  await user.click(within(scope).getByLabelText(label));
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
      const user = userEvent.setup();

      renderDetail(row.id);
      await user.click(await screen.findByRole("button", { name: /Add payment/ }));
      const dialog = await screen.findByRole("dialog");

      await pick(user, dialog, "Kind", "Down payment");
      await user.type(within(dialog).getByLabelText("Amount (PHP)"), "3000");
      await pick(user, dialog, "Method", "Check");
      await user.type(within(dialog).getByPlaceholderText("When paid by check"), "CHK-0042");
      await user.click(within(dialog).getByRole("button", { name: "Record payment" }));

      await waitFor(() => expect(db.rows("ipas_payments")).toHaveLength(1));
      expect(db.rows("ipas_payments")[0]).toMatchObject({ kind: "down_payment", amount: 3000, check_no: "CHK-0042", created_by: purchaser.id });

      const table = await screen.findByTestId("ipas-payment-row");
      expect(within(table).getByText("Down payment")).toBeInTheDocument();
      expect(within(table).getByText("Check No. CHK-0042")).toBeInTheDocument();
      // DP is read off the rows; there is no balance anywhere.
      expect(screen.getByText("DP").closest("div")).toHaveTextContent(/3,000\.00/);
      expect(screen.queryByText(/balance/i)).not.toBeInTheDocument();
      // Four dialog interactions on a full page: close to the 5s default when the
      // whole suite runs in parallel, so it gets room.
    }, 20_000);

    it("keeps Record payment disabled and explains why while a number is half typed, without breaking", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = userEvent.setup();

      renderDetail(row.id);
      await user.click(await screen.findByRole("button", { name: /Add payment/ }));
      const dialog = await screen.findByRole("dialog");
      await pick(user, dialog, "Method", "Check");

      const amount = within(dialog).getByLabelText("Amount (PHP)");
      const submit = within(dialog).getByRole("button", { name: "Record payment" });
      await user.type(amount, "12abc");

      expect(submit).toBeDisabled();
      expect(within(dialog).getByText("Amount must be a number more than zero.")).toBeInTheDocument();

      await user.clear(amount);
      await user.type(amount, "1,250.50");
      expect(submit).toBeEnabled();
    });

    it("asks for the PHP debited on a foreign-currency PO and won't save without it", async () => {
      const row = ipas({ po_number: "P02445", source: "import", odoo_copy: poCopy("P02445", { currency: "USD" }), created_by: purchaser.id });
      stubEdgeFunction("odoo-po-ipas", { success: true, found: true, ...poCopy("P02445", { currency: "USD" }) });
      const user = userEvent.setup();

      renderDetail(row.id);
      await user.click(await screen.findByRole("button", { name: /Add payment/ }));
      const dialog = await screen.findByRole("dialog");
      await pick(user, dialog, "Method", "Alipay");

      const amount = within(dialog).getByLabelText("Amount (USD)");
      const phpDebited = within(dialog).getByLabelText("PHP debited");
      await user.type(amount, "640");
      const submit = within(dialog).getByRole("button", { name: "Record payment" });

      expect(within(dialog).getByText("PHP debited is required on a foreign-currency Odoo PO.")).toBeInTheDocument();
      expect(submit).toBeDisabled();

      await user.type(phpDebited, "36160");
      expect(submit).toBeEnabled();
      await user.click(submit);

      await waitFor(() => expect(db.rows("ipas_payments")).toHaveLength(1));
      expect(db.rows("ipas_payments")[0]).toMatchObject({ amount: 640, php_debited: 36160 });
      // 640 of USD for PHP 36,160 is a rate; Landed Cost is available from it.
      expect(await screen.findByTestId("ipas-landed-line")).toBeInTheDocument();
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
        method_id: options.payment_method.Check.id,
        check_no: null,
        proof_url: null,
        created_by: purchaser.id,
      });
      const user = userEvent.setup();

      renderDetail(row.id);
      await user.click(await screen.findByRole("button", { name: /^Edit Payment of Oct 1, 2026/ }));
      const dialog = await screen.findByRole("dialog");
      const amount = within(dialog).getByLabelText("Amount (PHP)");
      await user.clear(amount);
      await user.type(amount, "8000");
      await user.click(within(dialog).getByRole("button", { name: "Save payment" }));

      await waitFor(() => expect(db.rows("ipas_payments")[0].amount).toBe(8000));

      await user.click(await screen.findByRole("button", { name: /^Remove Payment of Oct 1, 2026/ }));
      const confirm = await screen.findByRole("dialog");
      expect(within(confirm).getByText("Remove this payment?")).toBeInTheDocument();
      await user.click(within(confirm).getByRole("button", { name: "Remove" }));

      await waitFor(() => expect(db.rows("ipas_payments")).toHaveLength(0));
      expect(db.rows("ipas_events").map((e) => e.kind)).toContain("payment_removed");
    });

    it("types P.I/QT Amount, and refuses a half-typed one with a sentence", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = userEvent.setup();

      renderDetail(row.id);
      await user.click(await screen.findByRole("button", { name: "Edit P.I/QT Amount" }));
      let dialog = await screen.findByRole("dialog");
      const field = within(dialog).getByRole("textbox");
      await user.type(field, "12k");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      // Refused with a sentence (toasted): the dialog stays, nothing was saved.
      await waitFor(() => expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled());
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(db.rows("ipas")[0].pi_qt_amount ?? null).toBeNull();

      await user.clear(field);
      await user.type(field, "8,400");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      await waitFor(() => expect(db.rows("ipas")[0].pi_qt_amount).toBe(8400));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      dialog = null;
    });

    it("picks the one freight service", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = userEvent.setup();

      renderDetail(row.id);
      await user.click(await screen.findByRole("combobox", { name: "Freight service" }));
      await user.click(await screen.findByRole("option", { name: "DHL Express" }));

      await waitFor(() => expect(db.rows("ipas")[0].freight_service_id).toBe(options.freight_service["DHL Express"].id));
    });
  });

  describe("charges", () => {
    it("records a charge in section 3 and totals the list", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = userEvent.setup();

      renderDetail(row.id);
      await user.click(await screen.findByRole("button", { name: /Add charge/ }));
      const dialog = await screen.findByRole("dialog");
      await pick(user, dialog, "Kind", "Brokerage Fee");
      await user.type(within(dialog).getByLabelText("Amount (PHP)"), "4,200");
      await user.click(within(dialog).getByRole("button", { name: "Record charge" }));

      const rowEl = await screen.findByTestId("ipas-charge-row");
      expect(within(rowEl).getByText("Brokerage Fee")).toBeInTheDocument();
      expect(within(rowEl).getByText(/4,200\.00/)).toBeInTheDocument();
      expect(db.rows("ipas_charges")[0]).toMatchObject({ kind_id: options.charge_kind["Brokerage Fee"].id, amount_php: 4200 });
    });

    it("keeps a deactivated kind on the charge that used it", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      db.seed("ipas_charges", {
        ipas_id: row.id,
        kind_id: options.charge_kind["Other Charges"].id,
        charged_on: "2026-10-12",
        amount_php: 300,
        created_by: purchaser.id,
      });
      db.rows("ipas_options").find((o) => o.id === options.charge_kind["Other Charges"].id).active = false;

      renderDetail(row.id);

      expect(await screen.findByText("Other Charges")).toBeInTheDocument();
    });
  });

  describe("who is offered what", () => {
    it("gives Finance payments and charges, but not the typed amount, the freight service or the status", async () => {
      mockUser.current = finance;
      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
      const row = ipas({ po_number: "P02552" });

      renderDetail(row.id);

      expect(await screen.findByRole("button", { name: /Add payment/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Add charge/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit P.I/QT Amount" })).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Freight service" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Costs complete" })).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Spread charges" })).not.toBeInTheDocument();
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
        method_id: options.payment_method.Check.id,
      });

      renderDetail(row.id);

      expect(await screen.findByTestId("ipas-payment-row")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add payment/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add charge/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Edit Payment/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Remove Payment/ })).not.toBeInTheDocument();
    });

    it("offers no money controls on a filed IPAS", async () => {
      const row = ipas({ po_number: "P02552", state: "filed", filed_at: "2026-10-14T00:00:00.000Z" });

      renderDetail(row.id);

      expect(await screen.findByRole("heading", { name: "TGIPAS_049" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add payment/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add charge/ })).not.toBeInTheDocument();
      expect(screen.getAllByText("Final").length).toBeGreaterThan(0);
      expect(screen.queryByText("Provisional")).not.toBeInTheDocument();
    });
  });

  describe("Landed Cost", () => {
    it("shows each line per unit, provisional until Costs complete and then final", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      db.seed("ipas_charges", {
        ipas_id: row.id,
        kind_id: options.charge_kind["Brokerage Fee"].id,
        charged_on: "2026-10-12",
        amount_php: 600,
        created_by: purchaser.id,
      });
      const user = userEvent.setup();

      renderDetail(row.id);

      const line = await screen.findByTestId("ipas-landed-line");
      // 6 x 1,250 + 600 of charges: 8,100 for the line, 1,350 a unit.
      expect(within(line).getByText(/8,100\.00/)).toBeInTheDocument();
      expect(within(line).getByText(/1,350\.00/)).toBeInTheDocument();
      expect(screen.getAllByText("Provisional").length).toBeGreaterThan(0);
      expect(screen.queryByText("Final")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Costs complete" }));

      await waitFor(() => expect(db.rows("ipas")[0].computation_status).toBe("costs_complete"));
      expect((await screen.findAllByText("Final")).length).toBeGreaterThan(0);
      expect(screen.queryByText("Provisional")).not.toBeInTheDocument();
    });

    it("says it is not available on a foreign-currency PO with no payment, rather than showing a guess", async () => {
      const row = ipas({ po_number: "P02445", source: "import", odoo_copy: poCopy("P02445", { currency: "USD" }), created_by: purchaser.id });
      stubEdgeFunction("odoo-po-ipas", { success: true, found: true, ...poCopy("P02445", { currency: "USD" }) });

      renderDetail(row.id);

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
      const user = userEvent.setup();

      renderDetail(row.id);
      await screen.findAllByTestId("ipas-landed-line");
      await user.click(screen.getByRole("combobox", { name: "Spread charges" }));
      await user.click(await screen.findByRole("option", { name: "By quantity" }));

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
    const user = userEvent.setup();

    renderSettings();

    const rows = await screen.findAllByTestId("ipas-option-row");
    expect(within(rows[0]).getByText("Alipay")).toBeInTheDocument();
    expect(within(rows.at(-1)).getByText("Other")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Charge kinds" }));
    await waitFor(() => expect(screen.getAllByTestId("ipas-option-row")).toHaveLength(7));
    expect(screen.getByText("Brokerage Fee")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Freight services" }));
    expect(await screen.findByText("DHL Express")).toBeInTheDocument();
  });

  it("adds an option, refusing a name that is already there", async () => {
    const user = userEvent.setup();

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
    expect(db.rows("ipas_options").filter((o) => o.list === "payment_method")).toHaveLength(10);
  });

  it("deactivates an option rather than deleting it, and offers it again when switched back", async () => {
    const user = userEvent.setup();

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
    const user = userEvent.setup();

    renderSettings();
    await screen.findAllByTestId("ipas-option-row");
    await user.click(screen.getByRole("button", { name: "Move Cash up" }));

    await waitFor(async () => {
      const rows = await screen.findAllByTestId("ipas-option-row");
      expect(rows[1]).toHaveTextContent("Cash");
      expect(rows[2]).toHaveTextContent("Bank Transfer");
    });
  });

  it("renames an option, keeping it the same option", async () => {
    const user = userEvent.setup();
    const id = options.payment_method["Credit Card"].id;

    renderSettings();
    await screen.findAllByTestId("ipas-option-row");
    await user.click(screen.getByRole("button", { name: "Rename Credit Card" }));
    const dialog = await screen.findByRole("dialog");
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
        method_id: options.payment_method.Check.id,
        created_by: purchaser.id,
      });
      return filed;
    }

    it("can't be renamed: Rename is off and the hint shows, while Deactivate and reorder stay", async () => {
      const user = userEvent.setup();
      useOnFiled();

      renderSettings();
      const rows = await screen.findAllByTestId("ipas-option-row");
      const check = rows.find((row) => within(row).queryByText("Check"));

      await waitFor(() => expect(within(check).getByRole("button", { name: "Rename Check" })).toBeDisabled());
      expect(within(check).getByText(hint)).toBeInTheDocument();
      expect(screen.getAllByText(hint)).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Rename Cash" })).toBeEnabled();

      await user.click(within(check).getByRole("switch", { name: "Check is offered" }));
      await waitFor(() => expect(db.rows("ipas_options").find((o) => o.label === "Check").active).toBe(false));
      await user.click(screen.getByRole("button", { name: "Move Check up" }));
      await waitFor(() => expect(db.rows("ipas_options").find((o) => o.label === "Check").sort).toBeLessThan(
        db.rows("ipas_options").find((o) => o.label === "Cash").sort,
      ));
    });

    it("is still renamable when only an open IPAS uses it", async () => {
      useOnFiled({ state: "open", filed_at: null });

      renderSettings();
      await screen.findAllByTestId("ipas-option-row");

      expect(screen.getByRole("button", { name: "Rename Check" })).toBeEnabled();
      expect(screen.queryByText(hint)).not.toBeInTheDocument();
    });

    it("freezes a document kind's Source and used-for marks too", async () => {
      const user = userEvent.setup();
      const filed = ipas({ po_number: "P02601", state: "filed", filed_at: "2026-10-14T00:00:00.000Z" });
      const waybill = options.document_kind.Waybill;
      db.seed("ipas_documents", { ipas_id: filed.id, kind_id: waybill.id, purchasing_has: true, finance_has: true });

      renderSettings();
      await user.click(await screen.findByRole("tab", { name: "Document kinds" }));
      await screen.findByText("Waybill");

      await waitFor(() => expect(screen.getByRole("combobox", { name: "Waybill: Source" })).toBeDisabled());
      expect(screen.getByRole("combobox", { name: "Waybill: used for" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Rename Waybill" })).toBeDisabled();
      expect(screen.getByRole("combobox", { name: "Bill of Lading (BL): Source" })).toBeEnabled();
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
