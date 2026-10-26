import { describe, expect, it } from "vitest"
import {
  ITEM_SOURCE,
  SOR_LINE_CHANGE,
  componentLabel,
  formatAmount,
  isFromS0,
  itemSectionLabel,
  poLineNotPicked,
  requestedItemStock,
  sorLineChange,
} from "./requestedItem"
import { STOCK_BADGE } from "@/constants/stock"

const fromLine = (overrides = {}) => ({
  id: "i1",
  source: ITEM_SOURCE.SOR_LINE,
  status: "not_checked",
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
      asked: { quantity: 10, unit: "pc" },
      quantityChanged: true,
      unitChanged: false,
      label: "SOR line now says 12 pc",
    })
  })

  it("says which of the quantity and the unit changed", () => {
    expect(sorLineChange(fromLine({ sorLine: { found: true, quantity: 10, unit: "box" } }))).toMatchObject({
      asked: { quantity: 10, unit: "pc" },
      quantityChanged: false,
      unitChanged: true,
    })
  })

  it("stays quiet once someone kept the item as asked, until the SOR says something else", () => {
    const changed = { found: true, quantity: 12, unit: "pc" }
    const kept = { quantity: 12, unit: "pc" }
    expect(sorLineChange(fromLine({ sorLine: changed, sor_change_seen: kept }))).toBeNull()
    expect(sorLineChange(fromLine({ sorLine: { ...changed, quantity: 15 }, sor_change_seen: kept }))?.quantity).toBe(15)
  })

  it("still says the line is gone after the item was kept as asked", () => {
    expect(
      sorLineChange(fromLine({ sorLine: { found: false }, sor_change_seen: { quantity: 12, unit: "pc" } }))?.kind,
    ).toBe(SOR_LINE_CHANGE.REMOVED)
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
      figure: "4 free of 10",
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
      figure: "Not read yet",
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

describe("isFromS0 and itemSectionLabel (#678)", () => {
  it("puts an item with an SOR line in From the S0", () => {
    const item = fromLine({ sor_item_id: "l1" })
    expect(isFromS0(item)).toBe(true)
    expect(itemSectionLabel(item)).toBe("From the S0")
  })

  it("makes an item with no SOR line an Other request, whatever its source", () => {
    for (const item of [{ source: ITEM_SOURCE.NEW }, fromLine({ sor_item_id: null }), { source: ITEM_SOURCE.COMPONENT }]) {
      expect(isFromS0(item)).toBe(false)
      expect(itemSectionLabel(item)).toBe("Other request")
    }
    expect(isFromS0(null)).toBe(false)
  })
})

describe("formatAmount", () => {
  it("drops trailing zeros and adds the unit", () => {
    expect(formatAmount("10.00", "pc")).toBe("10 pc")
    expect(formatAmount(2.5, null)).toBe("2.5")
  })
})

describe("poLineNotPicked (#312)", () => {
  const ordered = (overrides = {}) => ({ status: "purchased", po_number: "P01234", odoo_po_line_ids: [], ...overrides })

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
    expect(poLineNotPicked(ordered({ status: "to_purchase" }))).toBe(false)
    expect(poLineNotPicked(null)).toBe(false)
  })
})

describe("Requested Items for Components (#273)", () => {
  it('labels an item "1.2 · name" and nothing when it names no Component', () => {
    expect(componentLabel({ component: { number: "1.2", name: "Nozzle" } })).toBe("1.2 · Nozzle")
    expect(componentLabel({ component: undefined })).toBeNull()
    expect(componentLabel(null)).toBeNull()
  })
})
