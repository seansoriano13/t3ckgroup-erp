import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import { renderWithProviders } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db, updateRow } from "@/test/db/store";
import { stubEdgeFunction } from "@/test/msw/server";
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc";

const mockUser = vi.hoisted(() => ({ current: null }));
const toastError = vi.hoisted(() => vi.fn());
const printer = vi.hoisted(() => ({
  openPrintWindow: vi.fn(),
  printIpas: vi.fn(),
  // The Preview builds the same document as Print, from the signatures it fetches.
  hydrateIpasSignatures: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));
vi.mock("@/lib/pdf/ipasPrinter", () => printer);
vi.mock("react-hot-toast", async (importOriginal) => {
  const actual = await importOriginal();
  const toast = Object.assign((...args) => actual.default(...args), actual.default, { error: toastError });
  return { ...actual, default: toast };
});

/**
 * The IPAS page's two print actions (#250). What the paper says is the view
 * model's and the composer's (src/lib/pdf); this proves the page offers both
 * actions, opens the window in the click, and passes the filing copy option.
 */

const copy = (po) => ({
  po: { id: 1, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
  supplier: { id: 5, name: "Scorpe Technologies", contact: "Ms. K. Tan" },
  lines: [{ line_id: 11, name: "Cutter", brand: "SCORPE", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [] }],
  receipts: { status: "pending", done: 0, total: 1 },
  bills: { count: 0, draft: 0 },
});

const patchIpas = (id, patch) =>
  updateRow("ipas", db.internal.rowsOf("ipas").find((r) => r.id === id), patch);

// Print and Print filing copy live in the header's More menu.
const openMore = async (user) => {
  await user.click(await screen.findByRole("button", { name: /More/ }));
};

const renderDetail = (id) =>
  renderWithProviders(
    <MemoryRouter initialEntries={[`/purchasing/ipas/${id}`]}>
      <Routes>
        <Route path="/purchasing/ipas/:id" element={<IpasDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe("IPAS page: print", () => {
  let finance, row;

  beforeEach(() => {
    printer.openPrintWindow.mockReset();
    printer.printIpas.mockReset();
    printer.hydrateIpasSignatures.mockReset();
    toastError.mockClear();
    finance = makeEmployee({ name: "Fe Cruz", has_finance_flow: true });
    seedIpasOptions((table, record) => db.seed(table, record));
    mockUser.current = finance;
    stubIpasRpcs({ actorId: finance.id });
    stubEdgeFunction("odoo-po-ipas", (body) => ({ success: true, found: true, ...copy(body.poNumber) }));
    row = db.seed("ipas", {
      number: "TGIPAS_050",
      po_number: "P03050",
      priority: "high",
      source: "local",
      purpose: "inventory",
      odoo_copy: copy("P03050"),
      odoo_fetched_at: "2026-10-13T02:00:00.000Z",
      state: "open",
      landed_cost_split: "value",
      computation_status: "encoding",
    });
  });

  it("opens the window in the click and prints the ordinary copy", async () => {
    const win = { name: "print-window" };
    printer.openPrintWindow.mockReturnValue(win);
    printer.printIpas.mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderDetail(row.id);
    await openMore(user);
    await user.click(await screen.findByRole("button", { name: "Print" }));

    expect(printer.openPrintWindow).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(printer.printIpas).toHaveBeenCalledTimes(1));
    expect(printer.printIpas).toHaveBeenCalledWith(row.id, {
      printWindow: win,
      filingCopy: false,
      printedBy: "Fe Cruz",
    });
  });

  it("offers the filing copy only on a filed IPAS, and prints it from its own action", async () => {
    const win = { name: "print-window" };
    printer.openPrintWindow.mockReturnValue(win);
    printer.printIpas.mockResolvedValue(undefined);
    patchIpas(row.id, { state: "filed", filed_at: "2026-10-13T03:00:00.000Z" });
    const user = userEvent.setup();

    renderDetail(row.id);
    await openMore(user);
    await user.click(await screen.findByRole("button", { name: "Print filing copy" }));

    await waitFor(() => expect(printer.printIpas).toHaveBeenCalledTimes(1));
    expect(printer.printIpas.mock.calls[0][1]).toMatchObject({ filingCopy: true, printWindow: win });
  });

  it("offers only the plain Print on an open IPAS", async () => {
    const user = userEvent.setup();
    renderDetail(row.id);
    await openMore(user);

    expect(await screen.findByRole("button", { name: "Print" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print filing copy" })).not.toBeInTheDocument();
  });

  it("previews the document that prints, in a dialog with one close", async () => {
    const user = userEvent.setup();
    renderDetail(row.id);

    await user.click(await screen.findByRole("button", { name: "Preview" }));

    const dialog = await screen.findByRole("dialog", { name: "Print preview" });
    expect(await within(dialog).findByTitle("Print preview of TGIPAS_050")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: "Close" })).toHaveLength(1);
  });

  it("offers only the plain Print on a cancelled IPAS", async () => {
    patchIpas(row.id, { state: "cancelled", cancelled_at: "2026-10-13T03:00:00.000Z", cancel_reason: "Duplicate" });
    const user = userEvent.setup();

    renderDetail(row.id);
    await openMore(user);

    expect(await screen.findByRole("button", { name: "Print" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print filing copy" })).not.toBeInTheDocument();
  });

  it("offers no filing copy on a filed IPAS to someone who can't read bank details", async () => {
    patchIpas(row.id, { state: "filed", filed_at: "2026-10-13T03:00:00.000Z" });
    stubIpasRpcs({ actorId: finance.id, bankReader: false });
    const user = userEvent.setup();

    renderDetail(row.id);
    await openMore(user);

    expect(await screen.findByRole("button", { name: "Print" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print filing copy" })).not.toBeInTheDocument();
  });

  it("prints nothing, and says why, when the popup is blocked", async () => {
    printer.openPrintWindow.mockReturnValue(null);
    const user = userEvent.setup();

    renderDetail(row.id);
    await openMore(user);
    await user.click(await screen.findByRole("button", { name: "Print" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/popup blocked/i)));
    expect(printer.printIpas).not.toHaveBeenCalled();
  });

  it("says so when the print couldn't be prepared", async () => {
    printer.openPrintWindow.mockReturnValue({});
    printer.printIpas.mockRejectedValue(new Error("That IPAS isn't there, or you don't have access to it."));
    const user = userEvent.setup();

    renderDetail(row.id);
    await openMore(user);
    await user.click(await screen.findByRole("button", { name: "Print" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/isn't there, or you don't have access/)),
    );
  });
});
