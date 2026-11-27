import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import SettingsPage from "@/pages/settings";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubEdgeFunction, stubRpc } from "@/test/msw/server";
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc";
import { queryOtherDialog } from "@/test/support/dialogs"
import { SHOW_HAS_TICKS } from "@/components/ipas/record/MoneyFields";

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

describe("IPAS page: documents, the IPAS Status steps and the buyer facts", () => {
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
    // The Documents section works in place: every file of the Source, each with its Attach button.
    it("lists the Source's documents in place, each with an Attach button, and nothing to remove on a suggested one", async () => {
      const row = ipas({ source: "import", created_by: purchaser.id });
      giveDocuments(row);

      renderDetail(row.id, "documents");

      const section = await screen.findByRole("region", { name: "5 · Documents" });
      const waybill = await within(section).findByText("Waybill");
      const rowEl = waybill.closest("[data-testid=ipas-document-row]");
      expect(within(rowEl).getByRole("button", { name: "Attach a file to Waybill" })).toBeInTheDocument();
      expect(within(section).queryByText("Quotation (Local)")).not.toBeInTheDocument();
      // The Add buttons, the Required files box and the usage tags are gone from the view
      expect(within(section).queryByRole("button", { name: "Add document" })).not.toBeInTheDocument();
      expect(within(section).queryByRole("button", { name: /^Add \d+ suggested/ })).not.toBeInTheDocument();
      expect(within(section).queryByText("Required files")).not.toBeInTheDocument();
      expect(within(section).queryByText(/Filing item/i)).not.toBeInTheDocument();
      expect(within(section).queryByText(/Documentation and filing/i)).not.toBeInTheDocument();
      expect(within(section).queryByText(/already ticked at Filing/)).not.toBeInTheDocument();
      expect(within(section).queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
    });

    it("marks a required document with an asterisk after its name that a screen reader hears", async () => {
      const row = ipas({ source: "import", created_by: purchaser.id });
      giveDocuments(row);

      renderDetail(row.id, "documents");

      const section = await screen.findByRole("region", { name: "5 · Documents" });
      const required = within(section).queryAllByText("(required)");
      for (const hint of required) expect(hint.closest("[data-testid=ipas-document-row]")).not.toBeNull();
      expect(within(section).queryByText("Missing")).not.toBeInTheDocument();
    });

    // #1153: a document holds several files, each listed by its file name and removable on its own.
    it("lists each file of a document by name, opening on click, and removes one at a time", async () => {
      const user = setupUser();
      const row = ipas({ source: "import", created_by: purchaser.id });
      giveDocuments(row);
      const waybill = db.rows("ipas_documents").find((d) => d.ipas_id === row.id && d.kind_id === options.document_kind.Waybill.id);
      for (const name of ["page-1.pdf", "page-2.pdf", "page-3.pdf"]) {
        db.seed("ipas_document_files", { document_id: waybill.id, url: `https://res.cloudinary.com/demo/raw/upload/${name}`, file_name: name });
      }

      renderDetail(row.id, "documents");

      const section = await screen.findByRole("region", { name: "5 · Documents" });
      const rowEl = (await within(section).findByText("Waybill")).closest("[data-testid=ipas-document-row]");
      for (const name of ["page-1.pdf", "page-2.pdf", "page-3.pdf"]) {
        expect(within(rowEl).getByRole("link", { name })).toHaveAttribute("href", `https://res.cloudinary.com/demo/raw/upload/${name}`);
      }

      await user.click(within(rowEl).getByRole("button", { name: "Remove page-2.pdf from Waybill" }));

      await waitFor(() => expect(db.rows("ipas_document_files").map((f) => f.file_name)).toEqual(["page-1.pdf", "page-3.pdf"]));
      expect(within(rowEl).queryByRole("link", { name: "page-2.pdf" })).not.toBeInTheDocument();
      expect(within(rowEl).getByRole("link", { name: "page-1.pdf" })).toBeInTheDocument();
      expect(within(rowEl).getByRole("link", { name: "page-3.pdf" })).toBeInTheDocument();
    });

    it.skipIf(!SHOW_HAS_TICKS)("lists the documents for the Source, each with two ticks and a filing mark on filing items", async () => {
      const row = ipas({ source: "import", created_by: purchaser.id });
      giveDocuments(row);

      renderDetail(row.id, "documents", "edit");

      const section = await screen.findByTestId("ipas-documents");
      expect(within(section).getByText("BL or Waybill")).toBeInTheDocument();
      expect(within(section).queryByText("Quotation (Local)")).not.toBeInTheDocument();
      const bir = await documentRow("BIR 2307");
      expect(within(bir).getByText("Filing item")).toBeInTheDocument();
      expect(within(bir).getByRole("checkbox", { name: /Purchasing has it: BIR 2307/ })).toBeInTheDocument();
      expect(within(bir).getByRole("checkbox", { name: /Finance has it: BIR 2307/ })).toBeInTheDocument();
    });

    it.skipIf(!SHOW_HAS_TICKS)("lets Purchasing tick Purchasing has it, and leaves Finance has it to Finance", async () => {
      const row = ipas({ source: "import", created_by: purchaser.id });
      giveDocuments(row);
      const user = setupUser();

      renderDetail(row.id, "documents", "edit");
      const waybill = await documentRow("Waybill");
      const purchasingBox = within(waybill).getByRole("checkbox", { name: /Purchasing has it/ });
      const financeBox = within(waybill).getByRole("checkbox", { name: /Finance has it/ });
      offered(purchasingBox);
      refused(financeBox);

      await user.click(purchasingBox);
      // Typed in place: nothing is stored until Save all.
      expect(purchasingBox).toBeChecked();
      expect(db.rows("ipas_documents").find((d) => d.kind_id === options.document_kind.Waybill.id).purchasing_has).toBe(false);
      await user.click(screen.getByRole("button", { name: /^Save all/ }));

      await waitFor(() => expect(db.rows("ipas_documents").find((d) => d.kind_id === options.document_kind.Waybill.id).purchasing_has).toBe(true));
      expect(db.rows("ipas_events").at(-1)).toMatchObject({ kind: "document_ticked", detail: { side: "purchasing", value: true, label: "Waybill" } });
    });

    it.skipIf(!SHOW_HAS_TICKS)("shows a tick the moment it is made, and keeps it through a slow Save all", async () => {
      const row = ipas({ source: "import", created_by: purchaser.id });
      giveDocuments(row);
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      // The server is slow: the tick must not wait for it.
      stubRpc("ipas_tick_document", async (args) => {
        await held;
        const doc = db.internal.rowsOf("ipas_documents").find((d) => d.id === args.p_document_id);
        doc.purchasing_has = args.p_value;
        return doc;
      });
      const user = setupUser();

      renderDetail(row.id, "documents", "edit");
      const waybill = await documentRow("Waybill");
      const box = within(waybill).getByRole("checkbox", { name: /Purchasing has it/ });
      await user.click(box);
      await user.click(screen.getByRole("button", { name: /^Save all/ }));

      await waitFor(async () =>
        expect(within(await documentRow("Waybill")).getByRole("checkbox", { name: /Purchasing has it/ })).toBeChecked(),
      );
      expect(db.rows("ipas_documents").find((d) => d.kind_id === options.document_kind.Waybill.id).purchasing_has).toBe(false);

      release();
      await waitFor(() => expect(db.rows("ipas_documents").find((d) => d.kind_id === options.document_kind.Waybill.id).purchasing_has).toBe(true));
      expect(within(await documentRow("Waybill")).getByRole("checkbox", { name: /Purchasing has it/ })).toBeChecked();
    });

    it.skipIf(!SHOW_HAS_TICKS)("keeps the tick and says why, with Retry, when the server refuses the save", async () => {
      const row = ipas({ source: "import", created_by: purchaser.id });
      giveDocuments(row);
      stubRpc("ipas_tick_document", () => {
        const error = new Error("ipas_tick_document: only Purchasing ticks Purchasing has it");
        error.code = "42501";
        throw error;
      });
      const user = setupUser();

      renderDetail(row.id, "documents", "edit");
      const waybill = await documentRow("Waybill");
      await user.click(within(waybill).getByRole("checkbox", { name: /Purchasing has it/ }));
      await user.click(screen.getByRole("button", { name: /^Save all/ }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/only Purchasing ticks/i);
      expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
      // What was typed stays; nothing was stored.
      expect(within(await documentRow("Waybill")).getByRole("checkbox", { name: /Purchasing has it/ })).toBeChecked();
      expect(db.rows("ipas_documents").find((d) => d.kind_id === options.document_kind.Waybill.id).purchasing_has).toBe(false);
    });

    it.skipIf(!SHOW_HAS_TICKS)("offers Finance only its own tick and no way to change the list", async () => {
      mockUser.current = finance;
      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
      const row = ipas({ source: "import", created_by: purchaser.id });
      giveDocuments(row);
      const user = setupUser();

      renderDetail(row.id, "documents", "edit");
      const waybill = await documentRow("Waybill");
      refused(within(waybill).getByRole("checkbox", { name: /Purchasing has it/ }));
      const financeBox = within(waybill).getByRole("checkbox", { name: /Finance has it/ });
      offered(financeBox);
      expect(screen.queryByRole("button", { name: "Add document" })).not.toBeInTheDocument();
      expect(within(waybill).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();

      await user.click(financeBox);
      await user.click(screen.getByRole("button", { name: /^Save all/ }));

      await waitFor(() => expect(db.rows("ipas_documents").find((d) => d.kind_id === options.document_kind.Waybill.id).finance_has).toBe(true));
      expect(db.rows("ipas_events").at(-1)).toMatchObject({ kind: "document_ticked", actor_id: finance.id, detail: { side: "finance", value: true } });
    });

    it("offers Remove on a hand-added row only, never on a suggested one", async () => {
      const row = ipas({ source: "import", created_by: purchaser.id });
      giveDocuments(row);
      db.seed("ipas_documents", { ipas_id: row.id, kind_id: null, label: "Warranty card", attachment_url: null, purchasing_has: false, finance_has: false });
      const user = setupUser();

      renderDetail(row.id, "documents", "edit");
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
      const user = setupUser();

      renderDetail(row.id, "documents", "edit");
      await user.click(await screen.findByRole("button", { name: "Add document" }));
      // A new row to fill in, right there: no dialog.
      const fresh = await screen.findByRole("group", { name: "New document 1" });
      expect(queryOtherDialog()).not.toBeInTheDocument();
      expect(within(fresh).getByText("Needed")).toBeInTheDocument();
      await user.click(within(fresh).getByRole("combobox"));
      await user.click(await screen.findByRole("option", { name: /Something else/ }));
      await user.type(within(fresh).getByRole("textbox", { name: /^Name/ }), "Warranty card");
      await user.click(screen.getByRole("button", { name: /^Save all/ }));

      await waitFor(() => expect(db.rows("ipas_documents").some((d) => d.label === "Warranty card")).toBe(true));
      expect(await documentRow("Warranty card")).toBeTruthy();
    });

    it("offers a kind added to the list since the IPAS was raised, and adds it on request", async () => {
      const row = ipas({ source: "import", created_by: purchaser.id });
      giveDocuments(row);
      db.seed("ipas_options", { list: "document_kind", label: "Insurance Certificate", sort: 500, active: true, applies_to: "import", used_for: "documentation" });
      const user = setupUser();

      renderDetail(row.id, "documents", "edit");
      await user.click(await screen.findByRole("button", { name: "Add 1 suggested" }));

      expect(await documentRow("Insurance Certificate")).toBeTruthy();
      await waitFor(() => expect(screen.queryByRole("button", { name: /^Add \d+ suggested/ })).not.toBeInTheDocument());
    });

    it.skipIf(!SHOW_HAS_TICKS)("offers no document controls on a filed IPAS", async () => {
      const row = ipas({ source: "import", state: "filed", created_by: purchaser.id });
      giveDocuments(row);

      renderDetail(row.id, "documents", "edit");

      const waybill = await documentRow("Waybill");
      refused(within(waybill).getByRole("checkbox", { name: /Purchasing has it/ }));
      refused(within(waybill).getByRole("checkbox", { name: /Finance has it/ }));
      expect(screen.queryByRole("button", { name: "Add document" })).not.toBeInTheDocument();
    });
  });

  describe("Item Location", () => {
    it("types an Item Location from the list, in section 4", async () => {
      const row = ipas({ source: "local", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "delivery");
      // The row and the drawer both name the section.
      expect((await screen.findAllByText("4 · Delivery")).length).toBeGreaterThan(0);
      await user.click(screen.getByRole("combobox", { name: "Item Location" }));
      await user.click(await screen.findByRole("option", { name: "BM Office" }));

      await waitFor(() => expect(db.rows("ipas")[0].item_location_id).toBe(options.item_location["BM Office"].id));
      expect(screen.queryByText("from the TG03 Transmittals")).not.toBeInTheDocument();
    });

    it("shows the location read-only to Finance", async () => {
      mockUser.current = finance;
      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
      const row = ipas({ source: "local", created_by: purchaser.id, item_location_id: options.item_location["Marikina Warehouse"].id });

      renderDetail(row.id, "delivery");

      expect((await screen.findAllByText("Marikina Warehouse")).length).toBeGreaterThan(0);
      expect(screen.queryByRole("combobox", { name: "Item Location" })).not.toBeInTheDocument();
    });
  });

  describe("the IPAS Status dropdown", () => {
    it("lists the Import steps on the Status pill and saves a pick at once, with no day asked", async () => {
      const row = ipas({ source: "import", status: "order_draft", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "delivery");
      await user.click(await screen.findByRole("button", { name: /^Status\b/ }));
      const list = await screen.findByRole("listbox", { name: "Status" });
      for (const label of ["Order-Draft", "Ordered", "Customs / Port Hold", "Arrived at Local Hub", "Out for Delivery", "Delivered", "Done"]) {
        expect(within(list).getByRole("option", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
      }
      expect(within(list).getByRole("option", { name: /^Done/ })).toBeDisabled();
      expect(within(list).getByRole("option", { name: /^Order-Draft/ })).toBeDisabled();
      expect(screen.queryByTestId("ipas-status-steps")).not.toBeInTheDocument();

      await user.click(within(list).getByRole("option", { name: /^Ordered/ }));

      await waitFor(() => expect(db.rows("ipas")[0].status).toBe("ordered"));
      expect(queryOtherDialog()).not.toBeInTheDocument();
    });

    it("hides the Import-only steps on a Local IPAS", async () => {
      const row = ipas({ source: "local", status: "order_draft", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "delivery");
      await user.click(await screen.findByRole("button", { name: /^Status\b/ }));
      const list = await screen.findByRole("listbox", { name: "Status" });

      expect(within(list).getByRole("option", { name: /^Ordered/ })).toBeInTheDocument();
      expect(within(list).queryByRole("option", { name: /Customs/ })).not.toBeInTheDocument();
      expect(within(list).queryByRole("option", { name: /Local Hub/ })).not.toBeInTheDocument();
      expect(within(list).queryByRole("option", { name: /Out for Delivery/ })).not.toBeInTheDocument();
    });
  });

  describe("the buyer facts", () => {
    it("shows each fact with where it came from", async () => {
      const row = ipas({ source: "import", created_by: purchaser.id });

      renderDetail(row.id, "delivery");

      expect(await screen.findByTestId("ipas-track-with_pop")).toBeInTheDocument();
      expect(within(screen.getByTestId("ipas-track-with_pop")).getByText("derived from payments")).toBeInTheDocument();
      expect(within(screen.getByTestId("ipas-track-create_bill")).getByText("stamped from Odoo")).toBeInTheDocument();
      expect(within(screen.getByTestId("ipas-track-actual_checking")).getByText("stamped by Purchasing")).toBeInTheDocument();
      expect(within(screen.getByTestId("ipas-track-received_in_odoo")).getByText("stamped from Odoo")).toBeInTheDocument();
      // The typed facts are retired: the status steps carry them now.
      expect(screen.queryByTestId("ipas-track-purchase_order")).not.toBeInTheDocument();
      expect(screen.queryByTestId("ipas-track-import_clearance")).not.toBeInTheDocument();
      expect(screen.queryByTestId("ipas-track-delivered")).not.toBeInTheDocument();
    });

    it("shows With P.O.P once a payment carries proof", async () => {
      const row = ipas({ source: "local", created_by: purchaser.id });
      const method = options.payment_method["Dated Check"];

      db.seed("ipas_payments", { ipas_id: row.id, kind: "payment", paid_on: "2026-10-01", amount: 1000, php_debited: null, charge_fee_php: 0, method_id: method.id, proof_url: "https://res.cloudinary.com/demo/image/upload/pop.jpg" });
      renderDetail(row.id, "delivery");

      const pop = await screen.findByTestId("ipas-track-with_pop");
      await waitFor(() => expect(within(pop).getByText(/1 payment carries proof/)).toBeInTheDocument());
    });

    it("stamps Actual Checking by Purchasing, naming who, and can clear the stamp", async () => {
      const row = ipas({ source: "local", created_by: purchaser.id });
      const user = setupUser();

      renderDetail(row.id, "delivery");
      const checking = await screen.findByTestId("ipas-track-actual_checking");
      await user.click(within(checking).getByRole("button", { name: "Stamp" }));

      await waitFor(() => expect(db.rows("ipas")[0].actual_checking_by).toBe(purchaser.id));
      await waitFor(() => expect(within(screen.getByTestId("ipas-track-actual_checking")).getByText(/stamped by Buyer/)).toBeInTheDocument());

      await user.click(within(screen.getByTestId("ipas-track-actual_checking")).getByRole("button", { name: "Clear stamp" }));
      await waitFor(() => expect(db.rows("ipas")[0].actual_checking_by).toBeNull());
    });

    it("offers Finance no way to pick a step or stamp a fact", async () => {
      mockUser.current = finance;
      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
      const row = ipas({ source: "import", status: "order_draft", created_by: purchaser.id });

      renderDetail(row.id, "delivery");

      expect(await screen.findByTestId("ipas-track-actual_checking")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Status\b/ })).not.toBeInTheDocument();
      expect(within(screen.getByTestId("ipas-track-actual_checking")).queryByRole("button")).not.toBeInTheDocument();
    });

    it("keeps the typist's name and date in the history", async () => {
      const row = ipas({ source: "local", created_by: purchaser.id });
      db.seed("ipas_events", { ipas_id: row.id, actor_id: purchaser.id, kind: "status_typed", detail: { status: "delivered", from: null, to: "2026-10-09" } });
      db.seed("ipas_events", { ipas_id: row.id, actor_id: purchaser.id, kind: "document_ticked", detail: { label: "Waybill", side: "finance", value: true } });

      renderDetail(row.id, "history");

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
    const user = setupUser();

    renderSettings();
    await user.click(await screen.findByRole("tab", { name: "Document kinds" }));
    expect(await screen.findByText("BIR 2307")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "BIR 2307: Source" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "BIR 2307: used for" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Item locations" }));
    expect(await screen.findByText("BM Office")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Source/ })).not.toBeInTheDocument();
  });

  it("adds a document kind marked Import and filing", { timeout: 20000 }, async () => {
    const user = setupUser();

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
