import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasListPage from "@/pages/purchasing/ipas/index";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee, makeFlowStage, makeOpportunity, makeSuperAdmin } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubEdgeFunction } from "@/test/msw/server";
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc";
import { findOtherDialog, queryOtherDialog } from "@/test/support/dialogs"

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

const copy = (po, over = {}) => ({
  po: { id: 1, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: "S07920 Capas", partner_ref: null },
  supplier: { id: 5, name: "Scorpe Technologies", contact: "Ms. K. Tan" },
  lines: [
    { line_id: 11, name: "Greenspirit 2 Cutter", brand: "SCORPE", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: ["12% VAT"], analytic: ["S07920 Capas"] },
  ],
  receipts: { status: "pending", done: 0, total: 1 },
  bills: { count: 0, draft: 0 },
  ...over,
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
        <Route path="/purchasing/ipas/:id" element={<p>The IPAS page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

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

/** The Status pill in the record window's header: its label and value in one element. */
const recordWindow = () => screen.getAllByRole("dialog").find((dialog) => dialog.dataset.modalShell === "record");
const statusPill = () => within(recordWindow()).getByText("Status").parentElement;

async function openMore(user) {
  await user.click(await screen.findByRole("button", { name: /More/ }));
}

describe("IPAS pages", () => {
  let purchaser, finance, salesperson;

  beforeEach(() => {
    counter = 48;
    purchaser = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    finance = makeEmployee({ name: "Fe", has_finance_flow: true });
    salesperson = makeEmployee({ name: "Sales Person" });
    mockUser.current = purchaser;
    stubIpasRpcs({ actorId: purchaser.id });
  });

  describe("the list", () => {
    it("lists the open IPAS with number, PO, supplier, entity and Purpose, and counts each state", async () => {
      ipas({ po_number: "P02552", purpose: "supplies", created_by: purchaser.id });
      ipas({ state: "cancelled", cancel_reason: "Dropped", cancelled_at: "2026-10-13T03:00:00.000Z" });
      const user = setupUser();

      renderList();

      const row = (await screen.findAllByTestId("ipas-row"))[0];
      expect(within(row).getByText("TGIPAS_049")).toBeInTheDocument();
      expect(within(row).getByText("P02552")).toBeInTheDocument();
      expect(within(row).getByText("Scorpe Technologies")).toBeInTheDocument();
      expect(within(row).getByText("T3ck Trading")).toBeInTheDocument();
      expect(within(row).getByText("Supplies")).toBeInTheDocument();
      expect(screen.getAllByTestId("ipas-row")).toHaveLength(1);

      await user.click(screen.getByRole("tab", { name: /Cancelled/ }));
      await waitFor(() => expect(screen.getAllByTestId("ipas-row")).toHaveLength(1));
      expect(within(screen.getByTestId("ipas-row")).getByText("TGIPAS_050")).toBeInTheDocument();
    });

    it("shows where each IPAS's costing stands, and filters by it", async () => {
      ipas({ po_number: "P02552", computation_status: "encoded" });
      ipas({ po_number: "P02553", computation_status: "lc_odoo_done" });
      const user = setupUser();

      renderList();

      const rows = await screen.findAllByTestId("ipas-row");
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => within(r).getByTestId("ipas-row-costing").textContent).sort()).toEqual(["Encoded", "LC Odoo Done"]);

      await user.click(screen.getByRole("button", { name: /^Filters/ }));
      await user.click(await screen.findByRole("button", { name: /Any costing status/ }));
      await user.click(await screen.findByRole("button", { name: "LC Odoo Done" }));

      await waitFor(() => expect(screen.getAllByTestId("ipas-row")).toHaveLength(1));
      expect(within(screen.getByTestId("ipas-row")).getByText("P02553")).toBeInTheDocument();
    });

    it("shows each IPAS's Amount, Payment scheme, DP, FP and Remaining balance in its PO's currency (#596)", async () => {
      const methods = seedIpasOptions((table, row) => db.seed(table, row)).payment_method;
      const usdCopy = copy("P02600");
      usdCopy.po = { ...usdCopy.po, currency: "USD", amount_total: 2000 };
      // One typed P.I with a down payment and a cash top-up, one that falls back to the Odoo total with a full payment (withholding: paid less than the Amount),
      // and one old copy without totals.
      const typed = ipas({ po_number: "P02552", pi_qt_amount: 10000 });
      const settled = ipas({ po_number: "P02600", odoo_copy: usdCopy });
      const old = ipas({ po_number: "P02700" });
      const pay = (row, kind, amount, method, paidOn) =>
        db.seed("ipas_payments", { ipas_id: row.id, kind, amount, method_id: methods[method].id, paid_on: paidOn, charge_fee_php: 0 });
      pay(typed, "down_payment", 3000, "Bank TT", "2026-10-01");
      pay(typed, "payment", 1000, "Cash", "2026-10-02");
      pay(typed, "payment", 500, "Bank TT", "2026-10-03");
      pay(settled, "full_payment", 1800, "Cash", "2026-10-02");
      localStorage.setItem(`erp_ipas_columns_${purchaser.id}`, "[]"); // show every column

      renderList();

      const rowOf = async (po) => (await screen.findAllByTestId("ipas-row")).find((r) => within(r).queryByText(po));
      const typedRow = await rowOf("P02552");
      expect(within(typedRow).getByTestId("ipas-row-amount")).toHaveTextContent("₱10,000.00");
      expect(within(typedRow).getByTestId("ipas-row-amount-source")).toHaveTextContent("P.I/QT");
      expect(within(typedRow).getByTestId("ipas-row-scheme")).toHaveTextContent("Bank TT + Cash");
      expect(within(typedRow).getByTestId("ipas-row-dp")).toHaveTextContent("₱3,000.00");
      expect(within(typedRow).getByTestId("ipas-row-fp")).toHaveTextContent("—");
      expect(within(typedRow).getByTestId("ipas-row-remaining")).toHaveTextContent("₱5,500.00");

      const settledRow = await rowOf("P02600");
      expect(within(settledRow).getByTestId("ipas-row-amount")).toHaveTextContent("$2,000.00");
      expect(within(settledRow).getByTestId("ipas-row-amount-source")).toHaveTextContent("Odoo PO");
      expect(within(settledRow).getByTestId("ipas-row-fp")).toHaveTextContent("$1,800.00");
      expect(within(settledRow).getByTestId("ipas-row-remaining")).toHaveTextContent("$0.00");

      const oldRow = await rowOf(old.po_number);
      expect(within(oldRow).getByTestId("ipas-row-amount")).toHaveTextContent("₱7,500.00");
      expect(within(oldRow).getByTestId("ipas-row-amount-source")).toHaveTextContent("Odoo PO · before tax");
      expect(within(oldRow).getByTestId("ipas-row-scheme")).toHaveTextContent("—");
    });

    it("shows each IPAS's Status pill, worked out from the IPAS (#597)", async () => {
      const methods = seedIpasOptions((table, row) => db.seed(table, row)).payment_method;
      const pending = ipas({ po_number: "P02552" });
      const ongoing = ipas({ po_number: "P02553" });
      const paid = ipas({ po_number: "P02554" });
      const held = ipas({ po_number: "P02555", on_hold: true, on_hold_note: "Supplier issue" });
      const done = ipas({ po_number: "P02556", state: "filed", filed_at: "2026-10-14T00:00:00.000Z" });
      const cancelled = ipas({ po_number: "P02557", state: "cancelled", cancel_reason: "Dropped", cancelled_at: "2026-10-13T03:00:00.000Z" });
      db.seed("ipas_payments", { ipas_id: ongoing.id, kind: "down_payment", amount: 100, method_id: methods["Bank TT"].id, paid_on: "2026-10-01", charge_fee_php: 0 });
      db.seed("ipas_payments", { ipas_id: paid.id, kind: "full_payment", amount: 100, method_id: methods["Bank TT"].id, paid_on: "2026-10-01", charge_fee_php: 0 });

      const user = setupUser();
      renderList();

      const pillOf = async (po) => {
        const row = (await screen.findAllByTestId("ipas-row")).find((r) => within(r).queryByText(po));
        return within(row).queryByTestId("ipas-status-pill");
      };
      expect((await pillOf(pending.po_number)).dataset.status).toBe("pending");
      expect((await pillOf(ongoing.po_number)).dataset.status).toBe("ongoing");
      expect((await pillOf(paid.po_number)).dataset.status).toBe("paid");
      expect((await pillOf(held.po_number)).dataset.status).toBe("on_hold");

      await user.click(screen.getByRole("tab", { name: /Filed/ }));
      await waitFor(() => expect(screen.getAllByTestId("ipas-row")).toHaveLength(1));
      expect((await pillOf(done.po_number)).dataset.status).toBe("done");

      await user.click(screen.getByRole("tab", { name: /Cancelled/ }));
      await waitFor(() => expect(within(screen.getByTestId("ipas-row")).getByText(cancelled.po_number)).toBeInTheDocument());
      expect(await pillOf(cancelled.po_number)).toBeNull();
    });

    it("filters by IPAS Status (#597)", async () => {
      ipas({ po_number: "P02552" });
      ipas({ po_number: "P02553", on_hold: true });
      const user = setupUser();

      renderList();
      expect(await screen.findAllByTestId("ipas-row")).toHaveLength(2);

      await user.click(screen.getByRole("button", { name: /Any IPAS Status/ }));
      await user.click(await screen.findByRole("button", { name: "On-Hold" }));

      await waitFor(() => expect(screen.getAllByTestId("ipas-row")).toHaveLength(1));
      expect(within(screen.getByTestId("ipas-row")).getByText("P02553")).toBeInTheDocument();
    });

    it("shows the list's status pill read-only, even to Purchasing (feedback on #595)", async () => {
      ipas({ po_number: "P02552" });
      renderList();
      const pill = await screen.findByTestId("ipas-status-pill");
      expect(pill.dataset.status).toBe("pending");
      expect(screen.queryByRole("button", { name: /Put On-Hold/ })).not.toBeInTheDocument();
    });

    it("puts an open IPAS On-Hold from the record's More menu with a note, and clears it again (#597)", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id);
      await openMore(user);
      await user.click(await screen.findByRole("button", { name: "Put On-Hold" }));
      await user.type(await screen.findByPlaceholderText(/Why is it on hold/), "Waiting on the client");
      await user.click(screen.getByRole("button", { name: "Put On-Hold" }));

      await screen.findByTestId("ipas-record-status");
      await waitFor(() => expect(statusPill()).toHaveTextContent("On-Hold"));
      expect(db.internal.rowsOf("ipas").find((r) => r.id === row.id)).toMatchObject({ on_hold: true, on_hold_note: "Waiting on the client" });
      expect(db.internal.rowsOf("ipas_events").map((e) => e.kind)).toContain("on_hold_set");

      await openMore(user);
      await user.click(await screen.findByRole("button", { name: "Clear On-Hold" }));
      await user.click(await screen.findByRole("button", { name: "Clear On-Hold" }));
      await waitFor(() => expect(statusPill()).toHaveTextContent("Pending"));
      expect(db.internal.rowsOf("ipas_events").map((e) => e.kind)).toContain("on_hold_cleared");
    });

    it("offers On-Hold to Finance, and to no one without Purchasing or Finance access (#597)", async () => {
      const row = ipas({ po_number: "P02552" });
      mockUser.current = finance;
      stubIpasRpcs({ actorId: finance.id, money: true });
      const user = setupUser();
      const { unmount } = renderDetail(row.id);
      await openMore(user);
      expect(await screen.findByRole("button", { name: "Put On-Hold" })).toBeInTheDocument();
      unmount();

      const signer = makeEmployee({ name: "Signer" });
      mockUser.current = signer;
      stubIpasRpcs({ actorId: signer.id, purchasing: false, money: false });
      renderDetail(row.id);
      await openMore(user);
      expect(await screen.findByRole("button", { name: "Print" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Put On-Hold" })).not.toBeInTheDocument();
    });

    it("shows a Project IPAS's SORs", async () => {
      const sor = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S07920", project_title: "Capas LGU" });
      const row = ipas({ purpose: "project" });
      db.seed("ipas_sors", { ipas_id: row.id, opportunity_id: sor.id });

      renderList();

      expect(await screen.findByText("S07920")).toBeInTheDocument();
    });

    it("shows each SOR as SO number and project, or SOR number and project when it has no SO number", async () => {
      const withSo = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S07920", sor_code: "SOR-198", project_title: "Capas LGU" });
      const withoutSo = makeOpportunity({ registered_by: salesperson.id, sales_reference: null, sor_code: "SOR-210", project_title: "Tarlac Depot" });
      const row = ipas({ purpose: "project" });
      db.seed("ipas_sors", { ipas_id: row.id, opportunity_id: withSo.id });
      db.seed("ipas_sors", { ipas_id: row.id, opportunity_id: withoutSo.id });

      renderList();

      const lines = within(await screen.findByTestId("ipas-row-sors")).getAllByRole("listitem");
      expect(lines.map((li) => li.textContent)).toEqual(["S07920 · Capas LGU", "SOR-210 · Tarlac Depot"]);
    });

    it("shows who raised it by Call Sign and name, or just the name without a Call Sign", async () => {
      const withSign = makeEmployee({ name: "Raquel Cruz", call_sign: "1001" });
      const noSign = makeEmployee({ name: "Pat Reyes", call_sign: null });
      ipas({ po_number: "P02552", created_by: withSign.id });
      ipas({ po_number: "P02553", created_by: noSign.id });
      localStorage.setItem(`erp_ipas_columns_${purchaser.id}`, "[]"); // show every column

      renderList();

      await screen.findAllByTestId("ipas-row");
      const shown = screen.getAllByTestId("ipas-row-raised-by").map((el) => el.textContent);
      expect(shown.sort()).toEqual(["1001 · Raquel Cruz", "Pat Reyes"]);
    });

    describe("searching", () => {
      let capas, tarlac;

      beforeEach(() => {
        const capasSor = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S07920", sor_code: "SOR-198", project_title: "Capas LGU Rescue" });
        const tarlacSor = makeOpportunity({ registered_by: salesperson.id, sales_reference: null, sor_code: "SOR-210", project_title: "Tarlac Depot" });
        capas = ipas({ po_number: "P02552", purpose: "project" });
        tarlac = ipas({ po_number: "P02553", purpose: "project" });
        db.seed("ipas_sors", { ipas_id: capas.id, opportunity_id: capasSor.id });
        db.seed("ipas_sors", { ipas_id: tarlac.id, opportunity_id: tarlacSor.id });
      });

      const highlighted = (row) => Array.from(row.querySelectorAll(".text-amber-11")).map((el) => el.textContent);

      it("finds an IPAS by SOR number, case-insensitively, and highlights it", async () => {
        const user = setupUser();
        renderList();
        await screen.findAllByTestId("ipas-row");

        await user.type(screen.getByPlaceholderText(/Search IPAS/), "sor-210");

        await waitFor(() => expect(screen.getAllByTestId("ipas-row")).toHaveLength(1));
        const row = screen.getByTestId("ipas-row");
        expect(within(row).getByText(tarlac.number)).toBeInTheDocument();
        expect(highlighted(row).join("").toLowerCase()).toBe("sor-210");
      });

      it("finds an IPAS by SOR number even when the SOR has an SO number, and shows the SOR number it matched", async () => {
        const user = setupUser();
        renderList();
        await screen.findAllByTestId("ipas-row");

        await user.type(screen.getByPlaceholderText(/Search IPAS/), "SOR-198");

        await waitFor(() => expect(screen.getAllByTestId("ipas-row")).toHaveLength(1));
        const row = screen.getByTestId("ipas-row");
        expect(within(row).getByText(capas.number)).toBeInTheDocument();
        expect(highlighted(row)).toEqual(["SOR-198"]);
      });

      it("finds an IPAS by project name, case-insensitively, and highlights it", async () => {
        const user = setupUser();
        renderList();
        await screen.findAllByTestId("ipas-row");

        await user.type(screen.getByPlaceholderText(/Search IPAS/), "capas lgu");

        await waitFor(() => expect(screen.getAllByTestId("ipas-row")).toHaveLength(1));
        const row = screen.getByTestId("ipas-row");
        expect(within(row).getByText(capas.number)).toBeInTheDocument();
        expect(highlighted(row)).toEqual(["Capas LGU"]);
      });

      it("finds an IPAS by SO number and highlights it", async () => {
        const user = setupUser();
        renderList();
        await screen.findAllByTestId("ipas-row");

        await user.type(screen.getByPlaceholderText(/Search IPAS/), "s0792");

        await waitFor(() => expect(screen.getAllByTestId("ipas-row")).toHaveLength(1));
        expect(highlighted(screen.getByTestId("ipas-row"))).toEqual(["S0792"]);
      });

      it("finds an IPAS by Odoo PO and highlights it", async () => {
        const user = setupUser();
        renderList();
        await screen.findAllByTestId("ipas-row");

        await user.type(screen.getByPlaceholderText(/Search IPAS/), "p02553");

        await waitFor(() => expect(screen.getAllByTestId("ipas-row")).toHaveLength(1));
        expect(within(screen.getByTestId("ipas-row")).getByText(tarlac.number)).toBeInTheDocument();
        expect(highlighted(screen.getByTestId("ipas-row"))).toEqual(["P02553"]);
      });
    });

    it("says there are none yet", async () => {
      renderList();
      expect(await screen.findByText("No IPAS yet")).toBeInTheDocument();
    });

    it("offers Raise IPAS to Purchasing and not to Finance", async () => {
      renderList();
      expect(await screen.findByRole("button", { name: /Raise IPAS/ })).toBeInTheDocument();
    });

    it("keeps Raise IPAS from Finance, who read but don't raise", async () => {
      mockUser.current = finance;
      ipas({ po_number: "P02552" });

      renderList();

      await screen.findAllByTestId("ipas-row");
      expect(screen.queryByRole("button", { name: /Raise IPAS/ })).not.toBeInTheDocument();
    });
  });

  describe("raising one", () => {
    const openDialog = async (user) => {
      renderList();
      await user.click(await screen.findByRole("button", { name: /Raise IPAS/ }));
      return findOtherDialog();
    };

    const check = async (user, dialog, po = "P02552") => {
      await user.type(within(dialog).getByPlaceholderText("e.g. P02552"), po);
      await user.click(within(dialog).getByRole("button", { name: /Check in Odoo/ }));
    };

    it("says Odoo has no such PO, apart from Odoo not answering", async () => {
      const user = setupUser();
      stubEdgeFunction("odoo-po-ipas", { success: true, found: false });
      const dialog = await openDialog(user);

      await check(user, dialog);

      expect(await within(dialog).findByText("Not found in Odoo")).toBeInTheDocument();
      expect(within(dialog).queryByText("Odoo couldn't be checked")).not.toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Raise IPAS" })).toBeDisabled();
    });

    it("says it couldn't check when Odoo doesn't answer", async () => {
      const user = setupUser();
      stubEdgeFunction("odoo-po-ipas", { success: false, message: "Odoo is rate-limiting requests" });
      const dialog = await openDialog(user);

      await check(user, dialog);

      expect(await within(dialog).findByText("Odoo couldn't be checked")).toBeInTheDocument();
      expect(within(dialog).queryByText("Not found in Odoo")).not.toBeInTheDocument();
    });

    it("refuses a number that isn't an Odoo PO without asking Odoo", async () => {
      const user = setupUser();
      let asked = false;
      stubEdgeFunction("odoo-po-ipas", () => {
        asked = true;
        return { success: true, found: false };
      });
      const dialog = await openDialog(user);

      await check(user, dialog, "PO-12");

      expect(await within(dialog).findByText("Not an Odoo PO number")).toBeInTheDocument();
      expect(within(dialog).queryByText("Not found in Odoo")).not.toBeInTheDocument();
      expect(asked).toBe(false);
    });

    it("shows the PO Odoo found and asks for the header", async () => {
      const user = setupUser();
      stubEdgeFunction("odoo-po-ipas", { success: true, found: true, ...copy("P02552", { po: { id: 1, name: "P02552", state: "draft", company: "TG Enterprise", currency: "USD", origin: null } }) });
      const dialog = await openDialog(user);

      await check(user, dialog);

      expect(await within(dialog).findByText("Scorpe Technologies")).toBeInTheDocument();
      expect(within(dialog).getByText("RFQ")).toBeInTheDocument();
      expect(within(dialog).getByText("TG Enterprise")).toBeInTheDocument();
      expect(within(dialog).getByText("Priority")).toBeInTheDocument();
      expect(within(dialog).getByText("Purpose")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Raise IPAS" })).toBeDisabled();
    });

    it("blocks a PO that already has a live IPAS, and names it", async () => {
      const user = setupUser();
      ipas({ po_number: "P02552" });
      stubEdgeFunction("odoo-po-ipas", { success: true, found: true, ...copy("P02552") });
      const dialog = await openDialog(user);

      await check(user, dialog);

      expect(await within(dialog).findByText(/already has a live IPAS \(TGIPAS_049\)/)).toBeInTheDocument();
      expect(within(dialog).queryByText("Priority")).not.toBeInTheDocument();
    });
  });

  describe("one IPAS", () => {
    it("shows the item lines with their fetch time in section 1", async () => {
      const row = ipas({ po_number: "P02552", purpose: "project", created_by: purchaser.id });

      renderDetail(row.id, "order");

      expect(await screen.findByRole("button", { name: /^1 · / })).toHaveAttribute("aria-expanded", "true");
      // The item shows in section 1 and again in Landed Cost (#244).
      expect((await screen.findAllByText("Greenspirit 2 Cutter")).length).toBeGreaterThan(0);
      expect(screen.getByText(/SCORPE/)).toBeInTheDocument();
      expect(screen.getByText(/Copy from Odoo, fetched/)).toBeInTheDocument();
      // #643: the lines are rows in the liner list with the one total, and no table sits inside the section.
      expect(screen.getByText("Lines · 1")).toBeInTheDocument();
      expect(screen.getByText("Before tax, as Odoo prices the lines")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("shows the same IPAS Status and On-Hold note on the record as on the list (#597)", async () => {
      const row = ipas({ po_number: "P02552", on_hold: true, on_hold_note: "Waiting on the client", created_by: purchaser.id });

      renderDetail(row.id);

      const region = await screen.findByTestId("ipas-record-status");
      expect(statusPill()).toHaveTextContent("On-Hold");
      expect(within(region).getByTestId("ipas-record-on-hold-note")).toHaveTextContent("Waiting on the client");
    });

    it("shows the header facts in the Header section", async () => {
      const row = ipas({ po_number: "P02552", purpose: "project", remarks: "For the Capas deal", created_by: purchaser.id });

      renderDetail(row.id, "order");

      expect(await screen.findByText("For the Capas deal")).toBeInTheDocument();
    });

    it("shows the creation in History", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      db.seed("ipas_events", { ipas_id: row.id, actor_id: purchaser.id, kind: "created", detail: {} });

      renderDetail(row.id, "history");

      expect(await screen.findByText("Raised")).toBeInTheDocument();
    });

    it("keeps Cancel IPAS in the More menu, with Print", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id);
      await openMore(user);

      expect(await screen.findByRole("button", { name: "Print" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cancel IPAS (wrong PO)" })).toBeInTheDocument();
    });

    it("cancels from the Purchasing frame, which asks for a Reason", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id);
      await openMore(user);
      await user.click(await screen.findByRole("button", { name: "Cancel IPAS (wrong PO)" }));

      const dialog = await findOtherDialog();
      expect(dialog.dataset.modalShell).toBe("compact");
      const confirm = within(dialog).getByRole("button", { name: "Cancel IPAS" });
      expect(confirm).toBeDisabled();
      await user.type(within(dialog).getByPlaceholderText(/Why is this IPAS being cancelled/), "Wrong PO");
      await user.click(confirm);

      await waitFor(() => expect(db.rows("ipas").find((r) => r.id === row.id)).toMatchObject({ state: "cancelled", cancel_reason: "Wrong PO" }));
      await waitFor(() => expect(queryOtherDialog()).not.toBeInTheDocument());
    });

    it("opens a shared link with ?edit= in the edit view, inside the window", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      renderDetail(row.id, "order", "edit");

      expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
      expect(recordWindow()).toContainElement(screen.getByRole("button", { name: "Done" }));
      // Editing is in place, so Your move stays beside the sections.
      expect(screen.getByRole("heading", { name: "Your move" })).toBeInTheDocument();
    });

    it("shows each SOR as reference, project and Stage, never the customer", async () => {
      const stage = makeFlowStage({ name: "Quotation" });
      const sor = makeOpportunity({
        registered_by: salesperson.id,
        sales_reference: "S07920",
        project_title: "Capas LGU",
        client_name: "Zorblax Holdings",
        flow_stage_id: stage.id,
      });
      const row = ipas({ po_number: "P02552", purpose: "project", created_by: purchaser.id });
      db.seed("ipas_sors", { ipas_id: row.id, opportunity_id: sor.id });

      renderDetail(row.id, "order");

      expect(await screen.findByText(/Capas LGU · Quotation/)).toBeInTheDocument();
      expect(screen.queryByText(/Zorblax/)).not.toBeInTheDocument();
    });

    it("cancels with a reason and keeps the IPAS readable with its number", { timeout: 20000 }, async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id);
      await openMore(user);
      await user.click(await screen.findByRole("button", { name: "Cancel IPAS (wrong PO)" }));
      const dialog = await findOtherDialog();
      const confirm = within(dialog).getByRole("button", { name: "Cancel IPAS" });
      expect(confirm).toBeDisabled();

      await user.type(within(dialog).getByPlaceholderText(/Why is this IPAS/), "Supplier withdrew");
      await user.click(confirm);

      await waitFor(() => expect(db.rows("ipas")[0]).toMatchObject({ state: "cancelled", cancel_reason: "Supplier withdrew" }));
      // The reason shows in the banner and again in the history.
      expect((await screen.findAllByText(/Supplier withdrew/)).length).toBeGreaterThanOrEqual(1);
      await user.click(await screen.findByRole("button", { name: /^History/ }));
      expect((await screen.findAllByText(/Supplier withdrew/)).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText(/won't be used again/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Cancel IPAS/ })).not.toBeInTheDocument();
    });

    it("gives a reader without Purchasing access no way to change it", async () => {
      mockUser.current = finance;
      const row = ipas({ po_number: "P02552" });

      renderDetail(row.id);

      expect(await screen.findByRole("heading", { name: "TGIPAS_049" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Cancel IPAS/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Purpose and SORs/ })).not.toBeInTheDocument();
    });

    it("no longer has the Googlesheet and Gantt Chart ticks: they only mirrored a spreadsheet", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });

      renderDetail(row.id, "order", "edit");

      expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: /Googlesheet|Gantt Chart/ })).not.toBeInTheDocument();
    });

    it("shows each section row with its full summary and the state word beside its dot", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });

      renderDetail(row.id);

      const order = await screen.findByRole("button", { name: /^1 · Order/ });
      expect(order).toHaveTextContent(/\d+ lines?/);
      expect(order).toHaveTextContent("no P.I # yet");
      expect(order).not.toHaveTextContent("PHP");
      expect(screen.getByRole("button", { name: /^2 · Payments/ })).toHaveTextContent("no payments yet");
      const costs = screen.getByRole("button", { name: /^3 · Costs/ });
      expect(costs).toHaveTextContent("Waiting");
      expect(costs).toHaveTextContent("Provisional");
      expect(screen.getByRole("button", { name: /^4 · Delivery/ })).toHaveTextContent("Needs the Logistics sign-off");
      expect(screen.getByRole("button", { name: /^5 · Documents/ })).toHaveTextContent(/\d+ missing/);
      expect(screen.getByRole("button", { name: /^6 · Sign-offs/ })).toHaveTextContent("0 of 4 signed");
    });

    // The record is a window over the list, as the Transmittal is.
    it("opens in the record window over the list: header, then the money, Your move, then the sections", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();
      renderDetail(row.id);

      const title = await screen.findByRole("heading", { name: new RegExp(`^${row.number}\\s*·\\s*Scorpe Technologies$`) });
      const card = await screen.findByRole("heading", { name: "Your move" });
      const slot = screen.getByTestId("ipas-money-summary-slot");
      const sections = screen.getByRole("heading", { name: "Sections" });
      const before = (a, b) => expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      before(title, slot);
      before(slot, card);
      before(card, sections);
      expect(screen.getAllByRole("dialog").filter((dialog) => dialog.dataset.modalShell === "record")).toHaveLength(1);
      expect(queryOtherDialog()).not.toBeInTheDocument();
      // The list is behind the window; Close returns to it.
      expect(await screen.findAllByTestId("ipas-row")).toHaveLength(1);
      await user.click(screen.getByRole("button", { name: "Close window" }));
      expect(await screen.findByText("The IPAS list")).toBeInTheDocument();
    });

    it("shows one state badge and the pills in the header, with the Status as a pill", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      renderDetail(row.id);

      const title = await screen.findByRole("heading", { name: new RegExp(`^${row.number}\\s*·\\s*Scorpe Technologies$`) });
      const header = title.closest("header");
      expect(within(header).getByText("Open")).toBeInTheDocument();
      expect(header.querySelectorAll("span.uppercase")).toHaveLength(1);
      expect(within(header).getByText(/^P02552 · raised /)).toBeInTheDocument();
      for (const label of ["Entity", "Priority", "Source", "Purpose", "Status"]) expect(within(recordWindow()).getByText(label)).toBeInTheDocument();
      expect(statusPill()).toHaveTextContent("Pending");
    });

    it("toggles sections in place, several open at once, with Open all and Close all", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();
      renderDetail(row.id);

      const logistics = await screen.findByRole("button", { name: /^4 · Delivery/ });
      const history = screen.getByRole("button", { name: /^History/ });
      expect(logistics).toHaveAttribute("aria-expanded", "false");
      await user.click(logistics);
      await user.click(history);
      expect(logistics).toHaveAttribute("aria-expanded", "true");
      expect(history).toHaveAttribute("aria-expanded", "true");
      expect(await screen.findByText("Item Location")).toBeInTheDocument();
      expect(queryOtherDialog()).not.toBeInTheDocument();

      await user.click(logistics);
      expect(logistics).toHaveAttribute("aria-expanded", "false");
      expect(history).toHaveAttribute("aria-expanded", "true");

      await user.click(screen.getByRole("button", { name: "Open all" }));
      expect(logistics).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: "Open all" })).toBeDisabled();

      await user.click(screen.getByRole("button", { name: "Close all" }));
      expect(logistics).toHaveAttribute("aria-expanded", "false");
      expect(history).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByRole("button", { name: "Close all" })).toBeDisabled();
    });

    it("opens the section ?open= names and scrolls to it, leaving the others shut", async () => {
      const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      renderDetail(row.id, "payments");

      const finance = await screen.findByRole("button", { name: /^2 · / });
      expect(finance).toHaveAttribute("aria-expanded", "true");
      expect(await screen.findByRole("region", { name: /^2 · / })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^1 · / })).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByRole("button", { name: /^4 · Delivery/ })).toHaveAttribute("aria-expanded", "false");
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(finance.closest("li"));
      expect(queryOtherDialog()).not.toBeInTheDocument();
      scrollIntoView.mockRestore();
    });

    // KNOWN BUG (spec #926 follow-up): `actionSectionFor` still answers with the old part key
    // ("purchasing") while the sections are keyed 1 Order … 6 Sign-offs ("order"), so nothing opens.
    // `it.fails` passes while it is broken and starts failing the day it is fixed: then make it a plain `it`.
    it.fails("opens the section that needs the viewer on arrival", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      renderDetail(row.id);

      // A purchaser with nothing sent for signing yet owes the files in 5 · Documents, or Order.
      await waitFor(() => expect(screen.getByRole("button", { name: /^1 · Order/ })).toHaveAttribute("aria-expanded", "true"));
      expect(screen.getByRole("button", { name: /^4 · Delivery/ })).toHaveAttribute("aria-expanded", "false");
    });

    it("expands Order in place with its header facts, read-only until Edit", async () => {
      const row = ipas({ po_number: "P02552", remarks: "For the Capas deal", created_by: purchaser.id });
      const user = setupUser();
      renderDetail(row.id);

      const trigger = await screen.findByRole("button", { name: /^1 · Order/ });
      await user.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(queryOtherDialog()).not.toBeInTheDocument();
      // The remark reads as text, not a box.
      expect(await screen.findByText("For the Capas deal")).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: /^Remarks/ })).not.toBeInTheDocument();
    });

    // KNOWN BUG (spec #926 follow-up): the page's Edit button asks for `?edit=header`, a section that no
    // longer exists (1 Order … 6 Sign-offs), so the edit view never opens. `it.fails` passes while it is
    // broken and starts failing the day it is fixed: then make it a plain `it`.
    it.fails("the page Edit button opens the edit view, and Done comes back to the sections", async () => {
      const row = ipas({ po_number: "P02552", remarks: "For the Capas deal", created_by: purchaser.id });
      const user = setupUser();
      renderDetail(row.id);

      await user.click(await screen.findByRole("button", { name: "Edit" }));
      expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
      expect(await screen.findByRole("textbox", { name: /^Remarks/ })).toHaveValue("For the Capas deal");

      await user.click(screen.getByRole("button", { name: "Done" }));
      await waitFor(() => expect(screen.queryByRole("textbox", { name: /^Remarks/ })).not.toBeInTheDocument());
    });

    it("expands Order read-only: the Purpose and SORs read there, with no Googlesheet tick", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      renderDetail(row.id, "order");

      const trigger = await screen.findByRole("button", { name: /^1 · Order/ });
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(queryOtherDialog()).not.toBeInTheDocument();
      const section = within(trigger.closest("li"));
      expect(section.queryByRole("checkbox", { name: "Googlesheet" })).not.toBeInTheDocument();
      expect(section.queryByRole("textbox")).not.toBeInTheDocument();
      expect(section.getByRole("button", { name: "Edit section" })).toBeInTheDocument();
    });

    it("offers no page Edit button to a viewer who may not change the IPAS", async () => {
      const signer = makeEmployee({ name: "Signer" });
      mockUser.current = signer;
      stubIpasRpcs({ actorId: signer.id, purchasing: false, money: false });
      const row = ipas({ po_number: "P02552" });
      const user = setupUser();
      renderDetail(row.id);

      const trigger = await screen.findByRole("button", { name: /^1 · Order/ });
      await user.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit section" })).not.toBeInTheDocument();
      expect(queryOtherDialog()).not.toBeInTheDocument();
    });

    it("says not found for an IPAS the database doesn't return", async () => {
      renderDetail(db.nextUuid());
      expect(await screen.findByText("IPAS not found")).toBeInTheDocument();
    });
  });

  // #243: opening an IPAS refreshes it from Odoo, and Purchasing corrects what
  // Odoo gets wrong without losing sight of Odoo.
  describe("keeping the Odoo copy current", () => {
    const answer = (po, over = {}) => ({ success: true, found: true, ...copy(po, over) });
    const withLines = (...lines) => lines.map((l, i) => ({ line_id: 100 + i, brand: null, unit: "Unit", taxes: [], analytic: [], ...l }));

    it("shows the lines Odoo has now, with a note of each addition and removal", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      stubEdgeFunction(
        "odoo-po-ipas",
        answer("P02552", {
          lines: [
            { line_id: 11, name: "Greenspirit 2 Cutter", brand: "SCORPE", quantity: 9, unit: "Unit", price_unit: 1250, price_subtotal: 11250, taxes: [], analytic: [] },
            ...withLines({ name: "Replacement blades", quantity: 1, price_unit: 80, price_subtotal: 80 }),
          ],
        }),
      );

      renderDetail(row.id, "order");

      expect((await screen.findAllByText("Replacement blades")).length).toBeGreaterThan(0);
      const note = await screen.findByText(/Odoo PO changed ·/);
      expect(note).toBeInTheDocument();
      expect(screen.getByText("1 line added, 1 quantity or price changed")).toBeInTheDocument();
      expect(screen.getByText(/Added/)).toBeInTheDocument();
    });

    it("shows the last copy with its fetch time when Odoo doesn't answer", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      stubEdgeFunction("odoo-po-ipas", { success: false, message: "Odoo is rate-limiting requests" });

      renderDetail(row.id, "order");

      expect(await screen.findByText("Odoo didn't answer.")).toBeInTheDocument();
      expect(screen.getByText(/Showing the copy from/)).toBeInTheDocument();
      expect(screen.getAllByText("Greenspirit 2 Cutter").length).toBeGreaterThan(0);
    });

    it("retries the Odoo refresh from the banner: a failed retry keeps the banner, a good one clears it", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const requests = vi.fn(() => ({ success: false, message: "Odoo is rate-limiting requests" }));
      stubEdgeFunction("odoo-po-ipas", requests);
      const user = setupUser();

      // No section open: the banner sits on the page, and a drawer would make it inert.
      renderDetail(row.id);
      expect(await screen.findByText("Odoo didn't answer.")).toBeInTheDocument();
      const callsBefore = requests.mock.calls.length;

      await user.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(requests.mock.calls.length).toBeGreaterThan(callsBefore));
      expect(screen.getByText("Odoo didn't answer.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();

      stubEdgeFunction("odoo-po-ipas", () => answer("P02552"));
      await user.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(screen.queryByText("Odoo didn't answer.")).not.toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    });

    it("dismisses the Odoo banner, and the stored copy stays on the page", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      stubEdgeFunction("odoo-po-ipas", { success: false, message: "Odoo is rate-limiting requests" });
      const user = setupUser();

      renderDetail(row.id);
      const banner = await screen.findByTestId("ipas-refresh-note");
      expect(banner).toHaveTextContent("Odoo didn't answer.");
      await user.click(within(banner).getByRole("button", { name: "Hide this note" }));

      expect(screen.queryByText("Odoo didn't answer.")).not.toBeInTheDocument();
      expect(screen.getByText("Supplier bill check")).toBeInTheDocument();
    });

    it("overrides Entity with Odoo's value beside it, and resets in one action", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      stubEdgeFunction("odoo-po-ipas", answer("P02552"));
      const user = setupUser();

      renderDetail(row.id, "order", "edit");
      // Blank uses Odoo's value, which shows beside the box.
      const field = await screen.findByRole("textbox", { name: /^Entity/ });
      expect(field).toHaveAttribute("placeholder", "Odoo: T3ck Trading");
      expect(screen.getAllByText("Using Odoo's value").length).toBeGreaterThan(0);
      await user.type(field, "TG Enterprise");
      await user.click(screen.getByRole("button", { name: /^Save all/ }));

      expect(await screen.findByText("Odoo says T3ck Trading")).toBeInTheDocument();
      expect(db.rows("ipas")[0].entity_override).toBe("TG Enterprise");

      // Clearing the box and saving goes back to Odoo's value.
      await user.clear(screen.getByRole("textbox", { name: /^Entity/ }));
      await user.click(screen.getByRole("button", { name: /^Save all/ }));

      await waitFor(() => expect(db.rows("ipas")[0].entity_override).toBeNull());
      expect((await screen.findAllByText("Using Odoo's value")).length).toBeGreaterThan(0);
    });

    it("marks an empty required box Needed, counts it in the bar and jumps to it", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id, item_location_id: null });
      const user = setupUser();

      renderDetail(row.id, "delivery", "edit");
      const box = await screen.findByRole("combobox", { name: /^Item Location/ });
      expect(box).toHaveAccessibleName(/Needed/);
      expect(screen.getByText(/required fields filled/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Next empty" }));
      await waitFor(() => expect(document.activeElement?.id).toMatch(/^f-/));
    });

    it("types the contact, which Odoo then leaves alone", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id, supplier_contact: null });
      stubEdgeFunction("odoo-po-ipas", answer("P02552"));
      const user = setupUser();

      renderDetail(row.id, "order", "edit");
      const field = await screen.findByRole("textbox", { name: /^Supplier's name/ });
      await user.clear(field);
      await user.type(field, "Mr. R. Cruz");
      await user.click(screen.getByRole("button", { name: /^Save all/ }));

      await waitFor(() => expect(db.rows("ipas")[0].supplier_contact).toBe("Mr. R. Cruz"));
      expect(await screen.findByText("All changes saved")).toBeInTheDocument();
    });

    it("edits Remarks on an open IPAS and records it in history", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id, remarks: "For the Capas deal" });
      stubEdgeFunction("odoo-po-ipas", answer("P02552"));
      const user = setupUser();

      renderDetail(row.id, "order", "edit");
      const field = await screen.findByRole("textbox", { name: /^Remarks/ });
      await user.clear(field);
      await user.type(field, "Rush: client needs it Friday");
      await user.click(screen.getByRole("button", { name: /^Save all/ }));

      await waitFor(() => expect(db.rows("ipas")[0].remarks).toBe("Rush: client needs it Friday"));
      expect(db.rows("ipas")[0].remarks).toBe("Rush: client needs it Friday");
      const event = db.rows("ipas_events").find((e) => e.kind === "header_changed");
      expect(event.detail.fields.remarks).toEqual({ from: "For the Capas deal", to: "Rush: client needs it Friday" });
    });

    it("fixes Remarks once the IPAS is filed", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id, remarks: "Frozen note", state: "filed" });
      stubEdgeFunction("odoo-po-ipas", answer("P02552"));

      renderDetail(row.id, "order", "edit");

      const field = await screen.findByRole("textbox", { name: /^Remarks/ });
      expect(field).toHaveValue("Frozen note");
      expect(field).toBeDisabled();
      expect(screen.getByRole("button", { name: /^Save all/ })).toBeDisabled();
    });

    it("says Odoo PO cancelled and leaves the IPAS open to cancel by hand", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      stubEdgeFunction("odoo-po-ipas", answer("P02552", { po: { id: 1, name: "P02552", state: "cancel", company: "T3ck Trading", currency: "Php", origin: null, partner_ref: null } }));

      renderDetail(row.id);
      const user = setupUser();

      expect(await screen.findByText("Odoo PO cancelled")).toBeInTheDocument();
      expect(screen.getByText(/stays open until Purchasing cancels it/)).toBeInTheDocument();
      await openMore(user);
      expect(screen.getByRole("button", { name: "Cancel IPAS (wrong PO)" })).toBeInTheDocument();
      expect(db.rows("ipas")[0].state).toBe("open");
    });

    it("warns when the IPAS names an SOR the Odoo PO does not (one way only, #712)", async () => {
      const sor = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S07920", project_title: "Capas LGU" });
      const row = ipas({ po_number: "P02552", purpose: "project", created_by: purchaser.id });
      db.seed("ipas_sors", { ipas_id: row.id, opportunity_id: sor.id });
      stubEdgeFunction(
        "odoo-po-ipas",
        answer("P02552", { po: { id: 1, name: "P02552", state: "purchase", company: "T3ck Trading", currency: "Php", origin: "S06070 Las Nieves", partner_ref: null }, lines: [{ line_id: 11, name: "Greenspirit 2 Cutter", brand: "SCORPE", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: ["S06070 Las Nieves"] }] }),
      );

      renderDetail(row.id, "order");

      expect(await screen.findByText("This IPAS names an SOR the Odoo PO doesn't")).toBeInTheDocument();
      expect(screen.getByText(/Odoo doesn't name S07920/)).toBeInTheDocument();
    });

    it("stamps the three Odoo statuses, with Partly received, and gives no way to tick them", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      stubEdgeFunction(
        "odoo-po-ipas",
        answer("P02552", { receipts: { status: "partial", done: 1, total: 2 }, bills: { count: 1, draft: 1 } }),
      );

      renderDetail(row.id, "delivery");

      expect(await screen.findByText(/Partly received · 1 of 2 receipts done/)).toBeInTheDocument();
      expect(screen.getByText("1 draft bill")).toBeInTheDocument();
      expect(screen.getAllByText("stamped from Odoo")).toHaveLength(3);
      // Section 2's two ticks are checkboxes; the Odoo statuses are not.
      expect(screen.queryByRole("checkbox", { name: /received|bill|delivered|odoo/i })).not.toBeInTheDocument();
    });

    it("offers Cancel IPAS (wrong PO) in the More menu to Purchasing, and no one else", async () => {
      const row = ipas({ po_number: "P02552" });
      stubEdgeFunction("odoo-po-ipas", answer("P02552"));
      const user = setupUser();

      const first = renderDetail(row.id);
      await openMore(user);
      expect(await screen.findByRole("button", { name: "Cancel IPAS (wrong PO)" })).toBeInTheDocument();
      first.unmount();

      mockUser.current = finance;
      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
      renderDetail(row.id);
      expect(await screen.findByRole("heading", { name: "TGIPAS_049" })).toBeInTheDocument();
      await openMore(user);
      expect(await screen.findByRole("button", { name: "Print" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Cancel IPAS/ })).not.toBeInTheDocument();
    });

    it("gives Finance the page without any override or edit control", async () => {
      mockUser.current = finance;
      const row = ipas({ po_number: "P02552" });
      stubEdgeFunction("odoo-po-ipas", answer("P02552"));

      renderDetail(row.id);

      expect(await screen.findByRole("heading", { name: "TGIPAS_049" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Override / })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Reset / })).not.toBeInTheDocument();
    });
  });
});
