import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

      await user.click(screen.getByRole("button", { name: /Any costing status/ }));
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

    it("shows a Project IPAS's SORs", async () => {
      const sor = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S07920", project_title: "Capas LGU" });
      const row = ipas({ purpose: "project" });
      db.seed("ipas_sors", { ipas_id: row.id, opportunity_id: sor.id });

      renderList();

      expect(await screen.findByText("S07920")).toBeInTheDocument();
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

      renderDetail(row.id, "purchasing");

      // The drawer is modal, so the page behind it is hidden from role queries.
      expect(await findOtherDialog()).toBeInTheDocument();
      // The item shows in section 1 and again in Landed Cost (#244).
      expect((await screen.findAllByText("Greenspirit 2 Cutter")).length).toBeGreaterThan(0);
      expect(screen.getByText("SCORPE")).toBeInTheDocument();
      expect(screen.getByText(/Copy from Odoo, fetched/)).toBeInTheDocument();
    });

    it("shows the header facts in the Header section", async () => {
      const row = ipas({ po_number: "P02552", purpose: "project", remarks: "For the Capas deal", created_by: purchaser.id });

      renderDetail(row.id, "header");

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
      expect(screen.getByRole("button", { name: "Cancel IPAS" })).toBeInTheDocument();
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

      renderDetail(row.id, "sales");

      expect(await screen.findByText(/Capas LGU · Quotation/)).toBeInTheDocument();
      expect(screen.queryByText(/Zorblax/)).not.toBeInTheDocument();
    });

    it("cancels with a reason and keeps the IPAS readable with its number", { timeout: 20000 }, async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id);
      await openMore(user);
      await user.click(await screen.findByRole("button", { name: "Cancel IPAS" }));
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

    it("ticks Googlesheet and Gantt Chart in section 2, each saved as it's ticked", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "sales", "edit");
      expect(await screen.findByRole("checkbox", { name: /Googlesheet/ })).not.toBeChecked();
      // Ticking only marks the form; the one Save stores both.
      await user.click(screen.getByRole("checkbox", { name: /Googlesheet/ }));
      await user.click(screen.getByRole("checkbox", { name: /Gantt Chart/ }));
      expect(db.rows("ipas")[0].google_sheet).toBeFalsy();
      await user.click(screen.getByRole("button", { name: /^Save all \(2\)/ }));
      await waitFor(() => expect(db.rows("ipas")[0].gantt_chart).toBe(true));
      expect(db.rows("ipas")[0].google_sheet).toBe(true);
      expect(await screen.findByText("All changes saved")).toBeInTheDocument();
    });

    it("shows each section row with its full summary and the state word beside its dot", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      db.seed("ipas_signoffs", { ipas_id: row.id, section: 1, role: "prepared", signed_by: purchaser.id });

      renderDetail(row.id);

      const purchasing = await screen.findByRole("button", { name: /^1 · Purchasing/ });
      expect(purchasing).toHaveTextContent("Awaiting approval");
      expect(purchasing).toHaveTextContent(/\d+ lines?/);
      expect(purchasing).toHaveTextContent("no payments yet");
      expect(purchasing).not.toHaveTextContent("PHP");
      const costing = screen.getByRole("button", { name: /^3 · Computation status & Landed Cost/ });
      expect(costing).toHaveTextContent("Computation status: Encoding");
      // Money and sign-offs first, sentence case, then everything else.
      expect(screen.getByRole("heading", { name: "Money and sign-offs" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Everything else" })).toBeInTheDocument();
    });

    it("opens a section from ?open=, and Escape returns focus to its row", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "finance");
      expect(await screen.findByRole("dialog", { name: /^2 · / })).toBeInTheDocument();

      await user.keyboard("{Escape}");

      await waitFor(() => expect(queryOtherDialog()).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: /^2 · / })).toHaveFocus();
    });

    // #533: a short section expands under its row, with no drawer.
    it("expands Logistics in place from ?open=, with no drawer", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      renderDetail(row.id, "logistics");

      const trigger = await screen.findByRole("button", { name: /^6 · Logistics/ });
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("Item Location")).toBeInTheDocument();
      expect(queryOtherDialog()).not.toBeInTheDocument();
    });

    it("toggles a section of Everything else in place from its row, and J stays in Money and sign-offs", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const user = setupUser();
      renderDetail(row.id);

      const trigger = await screen.findByRole("button", { name: /^6 · Logistics/ });
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      await user.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(queryOtherDialog()).not.toBeInTheDocument();
      await user.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "false");

      // From section 4, J goes nowhere: Everything else is not in the drawer's order.
      await user.click(screen.getByRole("button", { name: /^3 · / }));
      await screen.findByRole("dialog", { name: /^3 · / });
      fireEvent.keyDown(window, { key: "j" });
      expect(await screen.findByRole("dialog", { name: /^4 · / })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "j" });
      expect(screen.getByRole("dialog", { name: /^4 · / })).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Header" })).not.toBeInTheDocument();
    });

    // Every section of Everything else is a dropdown; Header and Sales read there and edit in the edit view.
    it("expands Header in place, and the page Edit button opens the edit view and comes back to it", async () => {
      const row = ipas({ po_number: "P02552", remarks: "For the Capas deal", created_by: purchaser.id });
      const user = setupUser();
      renderDetail(row.id);

      const trigger = await screen.findByRole("button", { name: /^Header/ });
      await user.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(queryOtherDialog()).not.toBeInTheDocument();
      // Read-only under the row: Remarks is edited in the edit view.
      expect(screen.queryByRole("button", { name: /^Edit Remarks/ })).not.toBeInTheDocument();

      expect(screen.queryByRole("button", { name: "Edit section" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Edit" }));
      expect(await screen.findByRole("button", { name: "Back to preview" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Header" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Back to preview" }));
      const back = await screen.findByRole("button", { name: /^Header/ });
      expect(back).toHaveAttribute("aria-expanded", "true");
      await waitFor(() => expect(back).toHaveFocus());
    }, 20000);

    it("expands Sales in place read-only, with no per-section edit button", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      renderDetail(row.id, "sales");

      const trigger = await screen.findByRole("button", { name: /Sales & Operation/ });
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(queryOtherDialog()).not.toBeInTheDocument();
      const section = within(trigger.closest("li"));
      expect(section.queryByRole("checkbox", { name: "Googlesheet" })).not.toBeInTheDocument();
      expect(section.queryByRole("button", { name: "Edit section" })).not.toBeInTheDocument();
    });

    it("offers no page Edit button to a viewer who may not change the IPAS", async () => {
      mockUser.current = finance;
      const row = ipas({ po_number: "P02552" });
      const user = setupUser();
      renderDetail(row.id);

      const trigger = await screen.findByRole("button", { name: /^Header/ });
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

      renderDetail(row.id, "purchasing");

      expect((await screen.findAllByText("Replacement blades", { selector: "td, td *" })).length).toBeGreaterThan(0);
      const note = await screen.findByText(/Odoo PO changed ·/);
      expect(note).toBeInTheDocument();
      expect(screen.getByText("1 line added, 1 quantity or price changed")).toBeInTheDocument();
      expect(screen.getByText(/Added/)).toBeInTheDocument();
    });

    it("shows the last copy with its fetch time when Odoo doesn't answer", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      stubEdgeFunction("odoo-po-ipas", { success: false, message: "Odoo is rate-limiting requests" });

      renderDetail(row.id, "purchasing");

      expect(await screen.findByText("Odoo didn't answer")).toBeInTheDocument();
      expect(screen.getByText(/Showing the last copy, fetched/)).toBeInTheDocument();
      expect(screen.getAllByText("Greenspirit 2 Cutter").length).toBeGreaterThan(0);
    });

    it("retries the Odoo refresh from the banner: a failed retry keeps the banner, a good one clears it", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      const requests = vi.fn(() => ({ success: false, message: "Odoo is rate-limiting requests" }));
      stubEdgeFunction("odoo-po-ipas", requests);
      const user = setupUser();

      // No section open: the banner sits on the page, and a drawer would make it inert.
      renderDetail(row.id);
      expect(await screen.findByText("Odoo didn't answer")).toBeInTheDocument();
      const callsBefore = requests.mock.calls.length;

      await user.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(requests.mock.calls.length).toBeGreaterThan(callsBefore));
      expect(screen.getByText("Odoo didn't answer")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();

      stubEdgeFunction("odoo-po-ipas", () => answer("P02552"));
      await user.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(screen.queryByText("Odoo didn't answer")).not.toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });

    it("dismisses the Odoo banner, and the stored copy stays on the page", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      stubEdgeFunction("odoo-po-ipas", { success: false, message: "Odoo is rate-limiting requests" });
      const user = setupUser();

      renderDetail(row.id);
      const banner = await screen.findByRole("alert");
      expect(banner).toHaveTextContent("Odoo didn't answer");
      await user.click(within(banner).getByRole("button", { name: "Dismiss" }));

      expect(screen.queryByText("Odoo didn't answer")).not.toBeInTheDocument();
      expect(screen.getByText("Odoo PO, before tax")).toBeInTheDocument();
    });

    it("overrides Entity with Odoo's value beside it, and resets in one action", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      stubEdgeFunction("odoo-po-ipas", answer("P02552"));
      const user = setupUser();

      renderDetail(row.id, "header", "edit");
      // Blank uses Odoo's value, which shows beside the box.
      const field = await screen.findByRole("textbox", { name: /^Entity/ });
      expect(field).toHaveAttribute("placeholder", "Odoo: T3ck Trading");
      expect(screen.getByText("Using Odoo's value")).toBeInTheDocument();
      await user.type(field, "TG Enterprise");
      await user.click(screen.getByRole("button", { name: /^Save all/ }));

      expect(await screen.findByText("Odoo says T3ck Trading")).toBeInTheDocument();
      expect(db.rows("ipas")[0].entity_override).toBe("TG Enterprise");

      // Clearing the box and saving goes back to Odoo's value.
      await user.clear(screen.getByRole("textbox", { name: /^Entity/ }));
      await user.click(screen.getByRole("button", { name: /^Save all/ }));

      await waitFor(() => expect(db.rows("ipas")[0].entity_override).toBeNull());
      expect(await screen.findByText("Using Odoo's value")).toBeInTheDocument();
    });

    it("marks an empty required box Needed, counts it in the bar and jumps to it", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id, item_location_id: null });
      const user = setupUser();

      renderDetail(row.id, "logistics", "edit");
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

      renderDetail(row.id, "purchasing", "edit");
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

      renderDetail(row.id, "header", "edit");
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

      renderDetail(row.id, "header", "edit");

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
      expect(screen.getByRole("button", { name: "Cancel IPAS" })).toBeInTheDocument();
      expect(db.rows("ipas")[0].state).toBe("open");
    });

    it("warns when Odoo's S numbers differ from the SORs", async () => {
      const sor = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S07920", project_title: "Capas LGU" });
      const row = ipas({ po_number: "P02552", purpose: "project", created_by: purchaser.id });
      db.seed("ipas_sors", { ipas_id: row.id, opportunity_id: sor.id });
      stubEdgeFunction(
        "odoo-po-ipas",
        answer("P02552", { po: { id: 1, name: "P02552", state: "purchase", company: "T3ck Trading", currency: "Php", origin: "S07920 Capas and S06070 Las Nieves", partner_ref: null } }),
      );

      renderDetail(row.id, "sales");

      expect(await screen.findByText("Odoo's S numbers differ from this IPAS's SORs")).toBeInTheDocument();
      expect(screen.getByText(/Odoo also names S06070/)).toBeInTheDocument();
    });

    it("stamps the three Odoo statuses, with Partly received, and gives no way to tick them", async () => {
      const row = ipas({ po_number: "P02552", created_by: purchaser.id });
      stubEdgeFunction(
        "odoo-po-ipas",
        answer("P02552", { receipts: { status: "partial", done: 1, total: 2 }, bills: { count: 1, draft: 1 } }),
      );

      renderDetail(row.id, "status");

      expect(await screen.findByText(/Partly received · 1 of 2 receipts done/)).toBeInTheDocument();
      expect(screen.getByText("1 draft bill")).toBeInTheDocument();
      expect(screen.getAllByText("stamped from Odoo")).toHaveLength(3);
      // Section 2's two ticks are checkboxes; the Odoo statuses are not.
      expect(screen.queryByRole("checkbox", { name: /received|bill|delivered|odoo/i })).not.toBeInTheDocument();
    });

    it("hints Purchasing and a Super Admin to cancel and raise a new IPAS when the PO is wrong, and no one else", async () => {
      const row = ipas({ po_number: "P02552" })
      stubEdgeFunction("odoo-po-ipas", answer("P02552"))

      const first = renderDetail(row.id)
      expect(await screen.findByText("Wrong PO? Cancel this IPAS and raise a new one.")).toBeInTheDocument()
      first.unmount()

      mockUser.current = makeSuperAdmin({ name: "Boss" })
      const second = renderDetail(row.id)
      expect(await screen.findByText("Wrong PO? Cancel this IPAS and raise a new one.")).toBeInTheDocument()
      second.unmount()

      mockUser.current = finance
      renderDetail(row.id)
      expect(await screen.findByRole("heading", { name: "TGIPAS_049" })).toBeInTheDocument()
      expect(screen.queryByText(/Wrong PO\?/)).not.toBeInTheDocument()
    })

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
