import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasListPage from "@/pages/purchasing/ipas/index";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubIpasRpcs } from "@/test/stubs/ipasRpc";
import { stubRoomyScreen } from "@/test/roomyScreen";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

const copy = (po) => ({
  po: { id: 1, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: "S07920 Capas", partner_ref: null },
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
    status: "order_draft",
    ...overrides,
  });
}

const recordWindow = () => screen.getAllByRole("dialog").find((dialog) => dialog.dataset.modalShell === "record");

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

describe("IPAS payment steps (spec #1205)", () => {
  let purchaser;

  beforeEach(() => {
    counter = 48;
    localStorage.clear();
    stubRoomyScreen();
    purchaser = makeEmployee({ name: "Buyer", call_sign: "1001", has_purchasing_flow: true });
    mockUser.current = purchaser;
    stubIpasRpcs({ actorId: purchaser.id });
  });

  it("has no Payment Approval or For Payment in the Status picker, and picking a step opens no ask (#1221)", { timeout: 20000 }, async () => {
    const row = ipas({ po_number: "P02552", pi_qt_amount: 10000, created_by: purchaser.id });
    const user = setupUser();

    renderDetail(row.id);
    const label = await within(await waitForRecord()).findByText("Status");
    await user.click(label.closest("button"));
    expect(await screen.findByRole("option", { name: /Ordered/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Payment Approval/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /For Payment/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: /Ordered/ }));
    await waitFor(() => expect(db.internal.rowsOf("ipas").find((r) => r.id === row.id).status).toBe("ordered"));
    expect(screen.queryByText(`Ask for payment on ${row.number}`)).not.toBeInTheDocument();
  });

  it("lists the Payment Forecast with Very High asks first, then the oldest ask (#1208)", async () => {
    const ask = (row, priority, askedAt) =>
      db.seed("ipas_payment_asks", { ipas_id: row.id, amount: 1000, purpose: "down_payment", priority, asked_by: purchaser.id, asked_at: askedAt, closed_at: null });
    const medium = ipas({ po_number: "P02001", pi_qt_amount: 5000 });
    const highNew = ipas({ po_number: "P02002", pi_qt_amount: 5000 });
    const highOld = ipas({ po_number: "P02003", pi_qt_amount: 5000 });
    const veryHigh = ipas({ po_number: "P02004", pi_qt_amount: 5000 });
    ipas({ po_number: "P02005", pi_qt_amount: 5000 }); // no ask: not in the view
    ask(medium, "medium", "2026-11-01T00:00:00Z");
    ask(highNew, "high", "2026-11-09T00:00:00Z");
    ask(highOld, "high", "2026-11-02T00:00:00Z");
    ask(veryHigh, "very_high", "2026-11-10T00:00:00Z");

    renderWithProviders(
      <MemoryRouter initialEntries={["/purchasing/ipas?view=payment_forecast"]}>
        <Routes>
          <Route path="/purchasing/ipas" element={<IpasListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getAllByTestId("ipas-row")).toHaveLength(4));
    const order = screen.getAllByTestId("ipas-row").map((r) => within(r).getByText(/^P0\d+$/).textContent);
    expect(order).toEqual(["P02004", "P02003", "P02002", "P02001"]);
  });

  describe("Withholding (2307) (#1210)", () => {
    const openPurchasing = async (row) => {
      renderDetail(row.id, "order", "edit");
      await screen.findByRole("button", { name: "Done" });
      await screen.findByText("Supplier and P.I");
    };

    it("is picked on a Local IPAS", async () => {
      const row = ipas({ po_number: "P02552", source: "local", pi_qt_amount: 10000, created_by: purchaser.id });
      await openPurchasing(row);
      expect(screen.getByText("Withholding (2307)")).toBeInTheDocument();
    });

    it("is not offered on an Import IPAS", async () => {
      const row = ipas({ po_number: "P02553", source: "import", pi_qt_amount: 10000, created_by: purchaser.id });
      await openPurchasing(row);
      expect(screen.queryByText("Withholding (2307)")).not.toBeInTheDocument();
    });
  });
});

async function waitForRecord() {
  await screen.findByTestId("ipas-record-status");
  return recordWindow();
}
