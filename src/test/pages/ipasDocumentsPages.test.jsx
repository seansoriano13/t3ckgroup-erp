import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import SettingsPage from "@/pages/settings";
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
 * The IPAS page's documents (section 3), Item Location (section 5), Supplier
 * Origin and the buyer track (section 6) (#246): who is offered which tick, what
 * a Local IPAS doesn't show, and where each status says it came from. The
 * database decides who may write (policy tier 60); this proves the page follows.
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
    source: "import",
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

describe("IPAS page: documents, Supplier Origin and the buyer track", () => {
  let purchaser, finance, options;

  /** The documents the migration's insert trigger would give an IPAS of this Source. */
  const giveDocuments = (row) => {
    for (const kind of Object.values(options.document_kind)) {
      if ([row.source, "both"].includes(kind.applies_to)) {
        db.seed("ipas_documents", { ipas_id: row.id, kind_id: kind.id, label: null, attachment_url: null, purchasing_has: false, finance_has: false });
      }
    }
  };

  beforeEach(() => {
    counter = 48;
    purchaser = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    finance = makeEmployee({ name: "Fe", has_finance_flow: true });
    options = seedIpasOptions((table, row) => db.seed(table, row));
    mockUser.current = purchaser;
    stubIpasRpcs({ actorId: purchaser.id });
    stubEdgeFunction("odoo-po-ipas", (body) => ({ success: true, found: true, ...poCopy(body.poNumber) }));
  });

  // A base-ui checkbox is a span: "disabled" is aria-disabled.
  const refused = (box) => expect(box).toHaveAttribute("aria-disabled", "true");
  const offered = (box) => expect(box).not.toHaveAttribute("aria-disabled", "true");

  const documentRow = async (name) => {
    const rows = await screen.findAllByTestId("ipas-document-row");
    return rows.find((row) => within(row).queryByText(name));
  };

  describe("documents", () => {
    it("lists the documents for the Source, each with two ticks and a filing mark on filing items", async () => {
      const row = ipas({ source: "import", created_by: purchaser.id });
      giveDocuments(row);

      renderDetail(row.id);

      const section = await screen.findByTestId("ipas-documents");
      expect(within(section).getByText("BL or Waybill")).toBeInTheDocument();
      expect(within(section).queryByText("Quotation (Local)")).not.toBeInTheDocument();
      const bir = await documentRow("BIR 2307");
      expect(within(bir).getByText("Filing item")).toBeInTheDocument();
      expect(within(bir).getByRole("checkbox", { name: /Purchasing has it: BIR 2307/ })).toBeInTheDocument();
      expect(within(bir).getByRole("checkbox", { name: /Finance has it: BIR 2307/ })).toBeInTheDocument();
    });

    it("lets Purchasing tick Purchasing has it, and leaves Finance has it to Finance", async () => {
      const row = ipas({ source: "import", created_by: purchaser.id });
      giveDocuments(row);
      const user = userEvent.setup();

      renderDetail(row.id);
      const waybill = await documentRow("Waybill");
      const purchasingBox = within(waybill).getByRole("checkbox", { name: /Purchasing has it/ });
      const financeBox = within(waybill).getByRole("checkbox", { name: /Finance has it/ });
      offered(purchasingBox);
      refused(financeBox);

      await user.click(purchasingBox);

      await waitFor(() => expect(db.rows("ipas_documents").find((d) => d.kind_id === options.document_kind.Waybill.id).purchasing_has).toBe(true));
      expect(db.rows("ipas_events").at(-1)).toMatchObject({ kind: "document_ticked", detail: { side: "purchasing", value: true, label: "Waybill" } });
    });

    it("offers Finance only its own tick and no way to change the list", async () => {
      mockUser.current = finance;
      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
      const row = ipas({ source: "import", created_by: purchaser.id });
      giveDocuments(row);
      const user = userEvent.setup();

      renderDetail(row.id);
      const waybill = await documentRow("Waybill");
      refused(within(waybill).getByRole("checkbox", { name: /Purchasing has it/ }));
      const financeBox = within(waybill).getByRole("checkbox", { name: /Finance has it/ });
      offered(financeBox);
      expect(screen.queryByRole("button", { name: "Add document" })).not.toBeInTheDocument();
      expect(within(waybill).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();

      await user.click(financeBox);

      await waitFor(() => expect(db.rows("ipas_documents").find((d) => d.kind_id === options.document_kind.Waybill.id).finance_has).toBe(true));
      expect(db.rows("ipas_events").at(-1)).toMatchObject({ kind: "document_ticked", actor_id: finance.id, detail: { side: "finance", value: true } });
    });

    it("offers Remove on a hand-added row only, never on a suggested one", async () => {
      const row = ipas({ source: "import", created_by: purchaser.id });
      giveDocuments(row);
      db.seed("ipas_documents", { ipas_id: row.id, kind_id: null, label: "Warranty card", attachment_url: null, purchasing_has: false, finance_has: false });
      const user = userEvent.setup();

      renderDetail(row.id);
      const waybill = await documentRow("Waybill");
      expect(within(waybill).queryByRole("button", { name: /Remove Waybill/ })).not.toBeInTheDocument();
      const bir = await documentRow("BIR 2307");
      expect(within(bir).queryByRole("button", { name: /Remove BIR 2307/ })).not.toBeInTheDocument();

      const warranty = await documentRow("Warranty card");
      await user.click(within(warranty).getByRole("button", { name: "Remove Warranty card" }));
      await user.click(await screen.findByRole("button", { name: "Remove" }));

      await waitFor(() => expect(db.rows("ipas_documents").some((d) => d.label === "Warranty card")).toBe(false));
      expect(await documentRow("Waybill")).toBeTruthy();
    });

    it("adds a document by hand, with its own name", async () => {
      const row = ipas({ source: "local", created_by: purchaser.id });
      giveDocuments(row);
      const user = userEvent.setup();

      renderDetail(row.id);
      await user.click(await screen.findByRole("button", { name: "Add document" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("combobox"));
      await user.click(await screen.findByRole("option", { name: /Something else/ }));
      await user.type(within(dialog).getByLabelText("Name"), "Warranty card");
      await user.click(within(dialog).getByRole("button", { name: "Add document" }));

      await waitFor(() => expect(db.rows("ipas_documents").some((d) => d.label === "Warranty card")).toBe(true));
      expect(await documentRow("Warranty card")).toBeTruthy();
    });

    it("offers a kind added to the list since the IPAS was raised, and adds it on request", async () => {
      const row = ipas({ source: "import", created_by: purchaser.id });
      giveDocuments(row);
      db.seed("ipas_options", { list: "document_kind", label: "Insurance Certificate", sort: 500, active: true, applies_to: "import", used_for: "documentation" });
      const user = userEvent.setup();

      renderDetail(row.id);
      await user.click(await screen.findByRole("button", { name: "Add 1 suggested" }));

      expect(await documentRow("Insurance Certificate")).toBeTruthy();
      await waitFor(() => expect(screen.queryByRole("button", { name: /suggested/ })).not.toBeInTheDocument());
    });

    it("offers no document controls on a filed IPAS", async () => {
      const row = ipas({ source: "import", state: "filed", created_by: purchaser.id });
      giveDocuments(row);

      renderDetail(row.id);

      const waybill = await documentRow("Waybill");
      refused(within(waybill).getByRole("checkbox", { name: /Purchasing has it/ }));
      refused(within(waybill).getByRole("checkbox", { name: /Finance has it/ }));
      expect(screen.queryByRole("button", { name: "Add document" })).not.toBeInTheDocument();
    });
  });

  describe("Item Location", () => {
    it("types an Item Location from the list, in section 5", async () => {
      const row = ipas({ source: "local", created_by: purchaser.id });
      const user = userEvent.setup();

      renderDetail(row.id);
      expect(await screen.findByText("6 · Logistics")).toBeInTheDocument();
      await user.click(screen.getByRole("combobox", { name: "Item Location" }));
      await user.click(await screen.findByRole("option", { name: "BM Office" }));

      await waitFor(() => expect(db.rows("ipas")[0].item_location_id).toBe(options.item_location["BM Office"].id));
      expect(screen.queryByText(/TG03/)).not.toBeInTheDocument();
    });

    it("shows the location read-only to Finance", async () => {
      mockUser.current = finance;
      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
      const row = ipas({ source: "local", created_by: purchaser.id, item_location_id: options.item_location["Marikina Warehouse"].id });

      renderDetail(row.id);

      expect(await screen.findByText("Marikina Warehouse")).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Item Location" })).not.toBeInTheDocument();
    });
  });

  describe("Supplier Origin", () => {
    it("shows the four dates on an Import IPAS, typed from a dialog", async () => {
      const row = ipas({ source: "import", created_by: purchaser.id });
      const user = userEvent.setup();

      renderDetail(row.id);
      const block = await screen.findByTestId("ipas-supplier-origin");
      for (const label of ["Shipped Out", "Onboard", "Arrived in PH", "Arrived in Whs."]) {
        expect(within(block).getByText(label)).toBeInTheDocument();
      }
      await user.click(within(block).getByRole("button", { name: "Edit dates" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Shipped Out"), "2026-10-01");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      await waitFor(() => expect(db.rows("ipas")[0].shipped_out_on).toBe("2026-10-01"));
      await waitFor(() => expect(within(screen.getByTestId("ipas-supplier-origin")).getByText("Oct 1, 2026")).toBeInTheDocument());
    });

    it("hides Supplier Origin entirely on a Local IPAS", async () => {
      const row = ipas({ source: "local", created_by: purchaser.id });

      renderDetail(row.id);

      expect(await screen.findByText("7 · Status")).toBeInTheDocument();
      expect(screen.queryByTestId("ipas-supplier-origin")).not.toBeInTheDocument();
      expect(screen.queryByText("Supplier Origin")).not.toBeInTheDocument();
      expect(screen.queryByText("Import Clearance")).not.toBeInTheDocument();
    });
  });

  describe("the buyer track", () => {
    it("shows each status with where it came from", async () => {
      const row = ipas({ source: "import", created_by: purchaser.id });

      renderDetail(row.id);

      const po = await screen.findByTestId("ipas-track-purchase_order");
      expect(within(po).getByText("stamped from Odoo")).toBeInTheDocument();
      expect(within(screen.getByTestId("ipas-track-with_pop")).getByText("derived from payments")).toBeInTheDocument();
      expect(within(screen.getByTestId("ipas-track-import_clearance")).getByText("typed by Purchasing")).toBeInTheDocument();
      expect(within(screen.getByTestId("ipas-track-delivered")).getByText("typed by Purchasing")).toBeInTheDocument();
      expect(within(screen.getByTestId("ipas-track-actual_checking")).getByText("stamped by Purchasing")).toBeInTheDocument();
      expect(within(screen.getByTestId("ipas-track-received_in_odoo")).getByText("stamped from Odoo")).toBeInTheDocument();
    });

    it("shows With P.O.P once a payment carries proof", async () => {
      const row = ipas({ source: "local", created_by: purchaser.id });
      const method = options.payment_method["Dated Check"];

      db.seed("ipas_payments", { ipas_id: row.id, kind: "payment", paid_on: "2026-10-01", amount: 1000, php_debited: null, charge_fee_php: 0, method_id: method.id, proof_url: "https://res.cloudinary.com/demo/image/upload/pop.jpg" });
      renderDetail(row.id);

      const pop = await screen.findByTestId("ipas-track-with_pop");
      await waitFor(() => expect(within(pop).getByText(/1 payment carries proof/)).toBeInTheDocument());
    });

    it("types Delivered with who and when, and shows it", async () => {
      const row = ipas({ source: "local", created_by: purchaser.id });
      const user = userEvent.setup();

      renderDetail(row.id);
      const delivered = await screen.findByTestId("ipas-track-delivered");
      await user.click(within(delivered).getByRole("button", { name: "Type date" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Delivered"), "2026-10-09");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      await waitFor(() => expect(db.rows("ipas")[0]).toMatchObject({ delivered_on: "2026-10-09", delivered_typed_by: purchaser.id }));
      await waitFor(() => expect(within(screen.getByTestId("ipas-track-delivered")).getByText(/typed by Buyer/)).toBeInTheDocument());
      expect(within(screen.getByTestId("ipas-track-delivered")).getByText("Oct 9, 2026")).toBeInTheDocument();
    });

    it("stamps Actual Checking by Purchasing, naming who, and can clear the stamp", async () => {
      const row = ipas({ source: "local", created_by: purchaser.id });
      const user = userEvent.setup();

      renderDetail(row.id);
      const checking = await screen.findByTestId("ipas-track-actual_checking");
      await user.click(within(checking).getByRole("button", { name: "Stamp" }));

      await waitFor(() => expect(db.rows("ipas")[0].actual_checking_by).toBe(purchaser.id));
      await waitFor(() => expect(within(screen.getByTestId("ipas-track-actual_checking")).getByText(/stamped by Buyer/)).toBeInTheDocument());

      await user.click(within(screen.getByTestId("ipas-track-actual_checking")).getByRole("button", { name: "Clear stamp" }));
      await waitFor(() => expect(db.rows("ipas")[0].actual_checking_by).toBeNull());
    });

    it("offers Finance no way to type or stamp a status", async () => {
      mockUser.current = finance;
      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
      const row = ipas({ source: "import", created_by: purchaser.id });

      renderDetail(row.id);

      const delivered = await screen.findByTestId("ipas-track-delivered");
      expect(within(delivered).queryByRole("button")).not.toBeInTheDocument();
      expect(within(screen.getByTestId("ipas-track-actual_checking")).queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit dates" })).not.toBeInTheDocument();
    });

    it("keeps the typist's name and date in the history", async () => {
      const row = ipas({ source: "local", created_by: purchaser.id });
      db.seed("ipas_events", { ipas_id: row.id, actor_id: purchaser.id, kind: "status_typed", detail: { status: "delivered", from: null, to: "2026-10-09" } });
      db.seed("ipas_events", { ipas_id: row.id, actor_id: purchaser.id, kind: "document_ticked", detail: { label: "Waybill", side: "finance", value: true } });

      renderDetail(row.id);

      expect(await screen.findByText("Delivered: Oct 9, 2026")).toBeInTheDocument();
      expect(screen.getByText("Waybill: Finance has it ticked")).toBeInTheDocument();
    });
  });
});

describe("IPAS settings: document kinds and Item Locations", () => {
  let purchaser;

  beforeEach(() => {
    purchaser = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    seedIpasOptions((table, row) => db.seed(table, row));
    mockUser.current = purchaser;
    stubIpasRpcs({ actorId: purchaser.id });
  });

  function renderSettings() {
    return renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=purchasing"]}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("offers the Document kinds and Item locations lists", async () => {
    const user = userEvent.setup();

    renderSettings();
    await user.click(await screen.findByRole("tab", { name: "Document kinds" }));
    expect(await screen.findByText("BIR 2307")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "BIR 2307: Source" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "BIR 2307: used for" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Item locations" }));
    expect(await screen.findByText("BM Office")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Source/ })).not.toBeInTheDocument();
  });

  it("adds a document kind marked Import and filing", async () => {
    const user = userEvent.setup();

    renderSettings();
    await user.click(await screen.findByRole("tab", { name: "Document kinds" }));
    await screen.findByText("BIR 2307");
    await user.type(screen.getByLabelText("New document kind"), "Customs Permit");
    await user.click(screen.getByRole("combobox", { name: "New document kind: Source" }));
    await user.click(await screen.findByRole("option", { name: "Import" }));
    await user.click(screen.getByRole("combobox", { name: "New document kind: used for" }));
    await user.click(await screen.findByRole("option", { name: "Filing" }));
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(db.rows("ipas_options").find((o) => o.label === "Customs Permit")).toMatchObject({ list: "document_kind", applies_to: "import", used_for: "filing" }),
    );
  });
});
