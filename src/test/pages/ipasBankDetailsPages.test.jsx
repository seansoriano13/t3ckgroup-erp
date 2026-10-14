import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
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
 * The IPAS page's bank details (#245), in section 3: who is offered the block,
 * who may type into it, and the changed-account flag beside the Account #. The
 * database decides who reads and writes (policy tier 59); this proves the page
 * follows it and that the flag is hard to miss.
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

let counter = 48;
function ipas(overrides = {}) {
  counter += 1;
  const po = overrides.po_number ?? `P0${3000 + counter}`;
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

function renderDetail(id, section) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/purchasing/ipas/${id}${section ? `?open=${section}` : ""}`]}>
      <Routes>
        <Route path="/purchasing/ipas/:id" element={<IpasDetailPage />} />
        <Route path="/purchasing/ipas" element={<p>The IPAS list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("IPAS page: bank details", () => {
  let purchaser, finance;

  beforeEach(() => {
    counter = 48;
    purchaser = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    finance = makeEmployee({ name: "Fe", has_finance_flow: true });
    seedIpasOptions((table, row) => db.seed(table, row));
    mockUser.current = purchaser;
    stubIpasRpcs({ actorId: purchaser.id });
    stubEdgeFunction("odoo-po-ipas", (body) => ({ success: true, found: true, ...poCopy(body.poNumber) }));
  });

  it("lets Purchasing type bank details from section 3, and shows them without a flag", async () => {
    const row = ipas({ po_number: "P03001", created_by: purchaser.id });
    const user = userEvent.setup();

    renderDetail(row.id, "finance");
    expect(await screen.findByText("No bank details typed yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add bank details" }));
    const dialog = await screen.findByRole("dialog");

    const save = within(dialog).getByRole("button", { name: "Save bank details" });
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Bank Name"), "BDO");
    await user.type(within(dialog).getByLabelText("Account Name"), "Scorpe Technologies Inc.");
    await user.type(within(dialog).getByLabelText("Account #"), "0012 3456 7890");
    await user.click(save);

    await waitFor(() => expect(db.rows("ipas_bank_details")).toHaveLength(1));
    expect(db.rows("ipas_bank_details")[0]).toMatchObject({ bank_name: "BDO", account_number: "0012 3456 7890" });

    const block = await screen.findByTestId("ipas-bank-details");
    await waitFor(() => expect(within(block).getByText("0012 3456 7890")).toBeInTheDocument());
    expect(within(block).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(block).queryByText("Changed account")).not.toBeInTheDocument();
  }, 20000); // typing a bank record takes most of 5s on a loaded machine

  it("shows a flagged account prominently, beside the Account #", async () => {
    const earlier = ipas({ po_number: "P03010", created_by: purchaser.id });
    db.seed("ipas_bank_details", { ipas_id: earlier.id, bank_name: "BDO", account_name: "Scorpe", account_number: "1111", account_flagged: false });
    const row = ipas({ po_number: "P03011", created_by: purchaser.id });
    db.seed("ipas_bank_details", { ipas_id: row.id, bank_name: "BPI", account_name: "Scorpe", account_number: "2222", account_flagged: true });

    renderDetail(row.id, "finance");

    const block = await screen.findByTestId("ipas-bank-details");
    const alert = await within(block).findByRole("alert");
    expect(alert).toHaveTextContent("Account # changed");
    expect(alert).toHaveTextContent(/differs from this supplier's last IPAS/);
    expect(within(block).getByText("Changed account")).toBeInTheDocument();
    expect(within(block).getByText("2222")).toBeInTheDocument();
  });

  it("shows Finance the details but offers no way to type them", async () => {
    mockUser.current = finance;
    stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
    const row = ipas({ po_number: "P03020", created_by: purchaser.id });
    db.seed("ipas_bank_details", { ipas_id: row.id, bank_name: "BDO", account_name: "Scorpe", account_number: "0012", account_flagged: false });

    renderDetail(row.id, "finance");

    const block = await screen.findByTestId("ipas-bank-details");
    expect(await within(block).findByText("0012")).toBeInTheDocument();
    expect(within(block).queryByRole("button", { name: /bank details/i })).not.toBeInTheDocument();
  });

  it("hides the whole block, not just the numbers, from a reader the database refuses", async () => {
    const signer = makeEmployee({ name: "Noted Signer" });
    mockUser.current = signer;
    stubIpasRpcs({ actorId: signer.id, purchasing: false, bankReader: false });
    const row = ipas({ po_number: "P03030", created_by: purchaser.id });
    db.seed("ipas_bank_details", { ipas_id: row.id, bank_name: "BDO", account_name: "Scorpe", account_number: "0099887766", account_flagged: true });

    renderDetail(row.id, "finance");

    expect((await screen.findAllByText("2 · Purchasing & Finance")).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("ipas-bank-details")).not.toBeInTheDocument();
    expect(screen.queryByText(/Bank details/)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("0099887766");
    expect(screen.queryByText("Account # changed")).not.toBeInTheDocument();
  });

  it("offers Purchasing no edit once the IPAS is cancelled", async () => {
    const row = ipas({
      po_number: "P03040",
      created_by: purchaser.id,
      state: "cancelled",
      cancelled_at: "2026-10-13T03:00:00.000Z",
      cancel_reason: "Wrong PO",
    });
    db.seed("ipas_bank_details", { ipas_id: row.id, bank_name: "BDO", account_name: "Scorpe", account_number: "0012", account_flagged: false });

    renderDetail(row.id, "finance");

    const block = await screen.findByTestId("ipas-bank-details");
    expect(within(block).queryByRole("button", { name: /bank details/i })).not.toBeInTheDocument();
  });
});
