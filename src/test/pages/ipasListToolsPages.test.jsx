import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasListPage from "@/pages/purchasing/ipas/index";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { db } from "@/test/db/store";
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc";
import { downloadXlsx } from "@/utils/xlsx";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

// The download itself needs a browser; the test reads what would be written.
vi.mock("@/utils/xlsx", async (importOriginal) => ({ ...(await importOriginal()), downloadXlsx: vi.fn() }));

const copy = (po, currency = "Php", total = null) => ({
  po: { id: 1, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency, origin: "S07920 Capas", partner_ref: null, ...(total === null ? {} : { amount_total: total }) },
  supplier: { id: 5, name: "Scorpe Technologies", contact: "Ms. K. Tan" },
  lines: [{ line_id: 11, name: "Cutter", brand: "SCORPE", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [] }],
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
    odoo_copy: copy(po),
    odoo_fetched_at: "2026-10-13T02:00:00.000Z",
    state: "open",
    ...overrides,
  });
}

function renderList() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/purchasing/ipas"]}>
      <Routes>
        <Route path="/purchasing/ipas" element={<IpasListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("IPAS list: views, columns, totals and export (#599)", () => {
  let purchaser;

  beforeEach(() => {
    counter = 48;
    vi.mocked(downloadXlsx).mockClear();
    localStorage.clear();
    purchaser = makeEmployee({ name: "Buyer", call_sign: "1001", has_purchasing_flow: true });
    mockUser.current = purchaser;
    stubIpasRpcs({ actorId: purchaser.id });
  });

  const pay = (row, kind, amount, method) =>
    db.seed("ipas_payments", { ipas_id: row.id, kind, amount, method_id: method.id, paid_on: "2026-10-01", charge_fee_php: 0 });

  // A column's row in the picker (its label toggles the checkbox).
  const pickerOption = async (heading) => within(await screen.findByRole("group", { name: "Columns shown" })).getByText(heading);

  const shownPos = () => screen.getAllByTestId("ipas-row").map((r) => within(r).getByText(/^P0\d+$/).textContent).sort();

  it("totals Amount and Remaining balance per currency and never adds currencies together", async () => {
    const methods = seedIpasOptions((table, row) => db.seed(table, row)).payment_method;
    const a = ipas({ po_number: "P02001", pi_qt_amount: 10000 });
    ipas({ po_number: "P02002", pi_qt_amount: 5000 });
    ipas({ po_number: "P02003", odoo_copy: copy("P02003", "USD", 2000) });
    pay(a, "down_payment", 4000, methods["Bank TT"]);

    renderList();

    expect(await screen.findAllByTestId("ipas-row")).toHaveLength(3);
    const totals = screen.getAllByTestId("ipas-total");
    expect(totals).toHaveLength(2);
    const php = totals.find((t) => t.textContent.includes("Php"));
    const usd = totals.find((t) => t.textContent.includes("USD"));
    expect(within(php).getByTestId("ipas-total-amount")).toHaveTextContent("₱15,000.00");
    expect(within(php).getByTestId("ipas-total-remaining")).toHaveTextContent("₱11,000.00");
    expect(within(usd).getByTestId("ipas-total-amount")).toHaveTextContent("$2,000.00");
    expect(within(usd).getByTestId("ipas-total-remaining")).toHaveTextContent("$2,000.00");
  });

  it("totals only the rows shown", async () => {
    ipas({ po_number: "P02001", pi_qt_amount: 10000 });
    ipas({ po_number: "P02002", pi_qt_amount: 5000 });
    const user = setupUser();

    renderList();
    await screen.findAllByTestId("ipas-row");
    await user.type(screen.getByPlaceholderText(/Search IPAS/), "P02002");

    await waitFor(() => expect(screen.getAllByTestId("ipas-row")).toHaveLength(1));
    expect(screen.getByTestId("ipas-total-amount")).toHaveTextContent("₱5,000.00");
  });

  it("exports the rows shown with the sheet's columns in the sheet's order, in the order on screen", async () => {
    const methods = seedIpasOptions((table, row) => db.seed(table, row)).payment_method;
    const raiser = makeEmployee({ name: "Raquel Cruz", call_sign: "1002" });
    const sor = makeOpportunity({ registered_by: raiser.id, sales_reference: "S07920", sor_code: "SOR-198", project_title: "Capas LGU" });
    const row = ipas({ po_number: "P02001", purpose: "project", pi_qt_amount: 10000, created_by: raiser.id });
    db.seed("ipas_sors", { ipas_id: row.id, opportunity_id: sor.id });
    pay(row, "down_payment", 3000, methods["Bank TT"]);
    pay(row, "payment", 1000, methods.Cash);
    const user = setupUser();

    renderList();
    await screen.findAllByTestId("ipas-row");
    await user.click(screen.getByRole("button", { name: /Export to Excel/ }));

    expect(downloadXlsx).toHaveBeenCalledTimes(1);
    const [filename, sheet] = vi.mocked(downloadXlsx).mock.calls[0];
    expect(filename).toMatch(/^ipas-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(sheet.header).toEqual([
      "IPAS No.",
      "Date",
      "Created By",
      "Project / SO No.",
      "Supplier",
      "P.O No.",
      "Amount",
      "Payment Scheme",
      "Down Payment",
      "Full Payment",
      "Remaining Balance",
      "Status",
    ]);
    expect(sheet.rows).toHaveLength(1);
    const [number, , createdBy, project, supplier, po, amount, scheme, down, full, remaining, status] = sheet.rows[0];
    expect(number).toBe(row.number);
    expect(createdBy).toBe("1002 · Raquel Cruz");
    expect(project).toBe("S07920 · Capas LGU");
    expect(supplier).toBe("Scorpe Technologies");
    expect(po).toBe("P02001");
    expect(amount.value).toBe(10000);
    expect(amount.format).toContain("₱");
    expect(scheme).toBe("Bank TT + Cash");
    expect(down.value).toBe(3000);
    expect(full).toBeNull();
    expect(remaining.value).toBe(6000);
    expect(status).toBe("Ongoing");
    // Nothing but the sheet's twelve columns: no bank details, no extras.
    expect(sheet.rows[0]).toHaveLength(12);
  });

  it("exports only the rows the filters leave, each amount in its own currency's format", async () => {
    ipas({ po_number: "P02001", pi_qt_amount: 10000 });
    ipas({ po_number: "P02003", odoo_copy: copy("P02003", "USD", 2000) });
    const user = setupUser();

    renderList();
    await screen.findAllByTestId("ipas-row");
    await user.type(screen.getByPlaceholderText(/Search IPAS/), "P02003");
    await waitFor(() => expect(screen.getAllByTestId("ipas-row")).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /Export to Excel/ }));

    const { rows } = vi.mocked(downloadXlsx).mock.calls[0][1];
    expect(rows).toHaveLength(1);
    expect(rows[0][5]).toBe("P02003");
    expect(rows[0][6].format).toContain("$");
    expect(rows[0][6].format).not.toContain("₱");
  });

  describe("views", () => {
    it("Unpaid shows open IPAS that are not Paid", async () => {
      const methods = seedIpasOptions((table, row) => db.seed(table, row)).payment_method;
      ipas({ po_number: "P02001" });
      ipas({ po_number: "P02002", on_hold: true });
      const paid = ipas({ po_number: "P02003", pi_qt_amount: 100 });
      pay(paid, "full_payment", 100, methods["Bank TT"]);
      ipas({ po_number: "P02004", state: "filed", filed_at: "2026-10-14T00:00:00.000Z" });
      const user = setupUser();

      renderList();
      await screen.findAllByTestId("ipas-row");
      await user.click(screen.getByRole("button", { name: /All IPAS/ }));
      await user.click(await screen.findByRole("button", { name: "Unpaid" }));

      await waitFor(() => expect(shownPos()).toEqual(["P02001", "P02002"]));
    });

    it("On-Hold and Ongoing show that IPAS Status", async () => {
      const methods = seedIpasOptions((table, row) => db.seed(table, row)).payment_method;
      ipas({ po_number: "P02001" });
      ipas({ po_number: "P02002", on_hold: true });
      const ongoing = ipas({ po_number: "P02003", pi_qt_amount: 100 });
      pay(ongoing, "down_payment", 50, methods["Bank TT"]);
      const user = setupUser();

      renderList();
      await screen.findAllByTestId("ipas-row");
      await user.click(screen.getByRole("button", { name: /All IPAS/ }));
      await user.click(await screen.findByRole("button", { name: "On-Hold" }));
      await waitFor(() => expect(shownPos()).toEqual(["P02002"]));

      await user.click(within(screen.getByTestId("page-toolbar")).getByRole("button", { name: /On-Hold/ }));
      await user.click(await screen.findByRole("button", { name: "Ongoing" }));
      await waitFor(() => expect(shownPos()).toEqual(["P02003"]));
    });

    it("Raised by me shows only the IPAS the signed-in employee raised", async () => {
      const other = makeEmployee({ name: "Someone Else" });
      ipas({ po_number: "P02001", created_by: purchaser.id });
      ipas({ po_number: "P02002", created_by: other.id });
      const user = setupUser();

      renderList();
      await screen.findAllByTestId("ipas-row");
      await user.click(screen.getByRole("button", { name: /All IPAS/ }));
      await user.click(await screen.findByRole("button", { name: "Raised by me" }));

      await waitFor(() => expect(shownPos()).toEqual(["P02001"]));
    });
  });

  describe("column picker", () => {
    it("hides a column and remembers it on this browser", async () => {
      ipas({ po_number: "P02001", pi_qt_amount: 10000 });
      const user = setupUser();

      const first = renderList();
      await screen.findAllByTestId("ipas-row");
      expect(screen.getByTestId("ipas-row-amount")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /Columns/ }));
      await user.click(await pickerOption("Amount"));

      await waitFor(() => expect(screen.queryByTestId("ipas-row-amount")).not.toBeInTheDocument());
      expect(screen.queryByRole("columnheader", { name: /^Amount/ })).not.toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem(`erp_ipas_columns_${purchaser.id}`))).toEqual(["amount"]);

      first.unmount();
      renderList();
      await screen.findAllByTestId("ipas-row");
      expect(screen.queryByTestId("ipas-row-amount")).not.toBeInTheDocument();
      expect(screen.getByTestId("ipas-row-remaining")).toBeInTheDocument();
    });

    it("still works when the browser blocks storage", async () => {
      ipas({ po_number: "P02001", pi_qt_amount: 10000 });
      const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      const user = setupUser();

      renderList();
      await screen.findAllByTestId("ipas-row");
      await user.click(screen.getByRole("button", { name: /Columns/ }));
      await user.click(await pickerOption("DP"));

      await waitFor(() => expect(screen.queryByTestId("ipas-row-dp")).not.toBeInTheDocument());
      getItem.mockRestore();
      setItem.mockRestore();
    });
  });
});
