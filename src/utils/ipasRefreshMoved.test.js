import { describe, expect, it } from "vitest";
import { odooRefreshMoved } from "./ipas";

// #928: opening an IPAS refreshes it from Odoo; the record reads again only when the refresh moved something it shows.
const copy = { po: { state: "purchase", amount_total: 100 }, lines: [{ price_subtotal: 100 }], receipts: { done: 0, total: 1 } };
const cached = { odoo_copy: copy, supplier_contact: "Ann", pi_number: null, odoo_change_note: null, odoo_changed_since_filing: false, odoo_po_id: 7 };
const row = { ...cached, odoo_fetched_at: "2026-11-09T10:00:00Z", updated_at: "2026-11-09T10:00:00Z" };

describe("odooRefreshMoved", () => {
  it("moves nothing when the refresh failed or was skipped", () => {
    expect(odooRefreshMoved(cached, { ok: false })).toBe(false);
    expect(odooRefreshMoved(cached, { ok: true, skipped: true })).toBe(false);
    expect(odooRefreshMoved(cached, null)).toBe(false);
  });

  it("moves nothing when only the fetch time is new", () => {
    expect(odooRefreshMoved(cached, { ok: true, changed: false, approvalsCleared: [], row })).toBe(false);
  });

  it("moves when lines changed or approvals were cleared", () => {
    expect(odooRefreshMoved(cached, { ok: true, changed: true, row })).toBe(true);
    expect(odooRefreshMoved(cached, { ok: true, changed: false, approvalsCleared: [1], row })).toBe(true);
  });

  it("moves when a shown field differs: a receipt done, the contact filled in", () => {
    const received = { ...row, odoo_copy: { ...copy, receipts: { done: 1, total: 1 } } };
    expect(odooRefreshMoved(cached, { ok: true, changed: false, row: received })).toBe(true);
    expect(odooRefreshMoved(cached, { ok: true, changed: false, row: { ...row, pi_number: "PI-1" } })).toBe(true);
  });

  it("moves when there is nothing to compare with", () => {
    expect(odooRefreshMoved(undefined, { ok: true, changed: false, row })).toBe(true);
    expect(odooRefreshMoved(cached, { ok: true, changed: false })).toBe(true);
  });
});
