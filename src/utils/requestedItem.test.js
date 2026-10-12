import { describe, expect, it } from "vitest"
import {
  ITEM_SOURCE,
  SOR_LINE_CHANGE,
  formatAmount,
  isLineRequested,
  poLineNotPicked,
  requestedItemStock,
  sorLineChange,
} from "./requestedItem"
import { STOCK_BADGE } from "@/constants/stock"

const fromLine = (overrides = {}) => ({
  id: "i1",
  source: ITEM_SOURCE.SOR_LINE,
  status: "requested",
  odoo_product_id: 101,
  name: "Full Body Harness",
  quantity: 10,
  unit: "pc",
  sor_line_snapshot: { name: "Full Body Harness", quantity: 10, unit: "pc" },
  sorLine: { found: true, quantity: 10, unit: "pc" },
  ...overrides,
})

describe("sorLineChange", () => {
  it("says nothing while the line still says what was picked", () => {
    expect(sorLineChange(fromLine())).toBeNull()
  })

  it("reports the line's new quantity", () => {
    expect(sorLineChange(fromLine({ sorLine: { found: true, quantity: 12, unit: "pc" } }))).toEqual({
      kind: SOR_LINE_CHANGE.CHANGED,
      quantity: 12,
      unit: "pc",
      label: "SOR line now says 12 pc",
    })
  })

  it("reports a changed unit", () => {
    expect(sorLineChange(fromLine({ sorLine: { found: true, quantity: 10, unit: "box" } }))?.label).toBe(
      "SOR line now says 10 box",
    )
  })

  it("ignores a unit's case and spacing", () => {
    expect(sorLineChange(fromLine({ sorLine: { found: true, quantity: "10.00", unit: " PC " } }))).toBeNull()
  })

  it("says the line is gone", () => {
    expect(sorLineChange(fromLine({ sorLine: { found: false, quantity: null, unit: null } }))).toEqual({
      kind: SOR_LINE_CHANGE.REMOVED,
      label: "SOR line removed",
    })
  })

  it("says nothing until the line has been read", () => {
    expect(sorLineChange(fromLine({ sorLine: undefined }))).toBeNull()
  })

  it("says nothing for a new product", () => {
    expect(sorLineChange({ source: ITEM_SOURCE.NEW, name: "Bracket", quantity: 1 })).toBeNull()
  })
})

describe("requestedItemStock", () => {
  const snapshot = {
    fetched_at: "2026-10-07T01:00:00Z",
    data: { products: { 101: { type: "product", free: 4, onHand: 6, forecast: 6 } } },
  }
  const sameDay = new Date("2026-10-07T09:00:00Z").getTime()

  it("judges the product's free stock against the quantity requested, with the read time", () => {
    expect(requestedItemStock(fromLine(), snapshot, sameDay)).toEqual({
      badge: { kind: STOCK_BADGE.PARTIAL, label: "Partial · 4 of 10", free: 4 },
      fetchedAt: "2026-10-07T01:00:00Z",
      stale: false,
    })
  })

  it("marks a reading older than a day stale (#501)", () => {
    const later = new Date("2026-10-08T01:00:01Z").getTime()
    expect(requestedItemStock(fromLine(), snapshot, later)).toMatchObject({
      badge: { kind: STOCK_BADGE.PARTIAL },
      fetchedAt: "2026-10-07T01:00:00Z",
      stale: true,
    })
  })

  it("is Not checked when the SOR's stock hasn't been read", () => {
    expect(requestedItemStock(fromLine(), null)).toEqual({
      badge: { kind: STOCK_BADGE.NOT_CHECKED, label: "Not checked", free: null },
      fetchedAt: null,
      stale: false,
    })
  })

  it("is Not linked for a line typed without an Odoo product", () => {
    expect(requestedItemStock(fromLine({ odoo_product_id: null }), snapshot)?.badge.kind).toBe(STOCK_BADGE.NOT_LINKED)
  })

  it("has none for a new product", () => {
    expect(requestedItemStock({ source: ITEM_SOURCE.NEW, quantity: 1 }, snapshot)).toBeNull()
  })
})

describe("isLineRequested", () => {
  const line = { id: "l1", product_name: "Full Body Harness", odoo_product_id: 101 }

  it("matches a live item on the same Odoo product", () => {
    expect(isLineRequested(line, [fromLine()])).toBe(true)
  })

  it("matches a hand-typed line by name", () => {
    const typed = { id: "l2", product_name: " rope, 11mm ", odoo_product_id: null }
    const item = fromLine({ odoo_product_id: null, sor_line_snapshot: { name: "Rope, 11mm", quantity: 1, unit: null } })
    expect(isLineRequested(typed, [item])).toBe(true)
  })

  it("doesn't count a cancelled item or a new product", () => {
    expect(isLineRequested(line, [fromLine({ status: "cancelled" })])).toBe(false)
    expect(isLineRequested(line, [{ source: ITEM_SOURCE.NEW, name: "Full Body Harness", status: "requested" }])).toBe(false)
  })
})

describe("formatAmount", () => {
  it("drops trailing zeros and adds the unit", () => {
    expect(formatAmount("10.00", "pc")).toBe("10 pc")
    expect(formatAmount(2.5, null)).toBe("2.5")
  })
})

describe("poLineNotPicked (#312)", () => {
  const ordered = (overrides = {}) => ({ status: "ordered", po_number: "P01234", odoo_po_line_ids: [], ...overrides })

  it("flags an Ordered item with a PO but no line", () => {
    expect(poLineNotPicked(ordered())).toBe(true)
    expect(poLineNotPicked(ordered({ odoo_po_line_ids: undefined }))).toBe(true)
  })

  it("still flags it once Received", () => {
    expect(poLineNotPicked(ordered({ status: "received" }))).toBe(true)
  })

  it("says nothing once a line is picked, with no PO number, or before Ordered", () => {
    expect(poLineNotPicked(ordered({ odoo_po_line_ids: [501] }))).toBe(false)
    expect(poLineNotPicked(ordered({ po_number: null }))).toBe(false)
    expect(poLineNotPicked(ordered({ status: "to_order" }))).toBe(false)
    expect(poLineNotPicked(null)).toBe(false)
  })
})
