import { describe, it, expect } from "vitest"
import {
  isCountedOrder,
  monthKey,
  rangeBounds,
  ordersInRange,
  summarize,
  monthOverMonth,
  monthlySeries,
  monthStorefrontGroups,
} from "./retailReport"

// Local-time dates, so the assertions hold in any timezone the suite runs in.
const at = (y, m, d) => new Date(y, m - 1, d, 12).toISOString()

const order = (overrides = {}) => ({
  storefront: "Shopee",
  amount: 100,
  ordered_at: at(2026, 9, 10),
  odoo_state: "sale",
  is_excluded: false,
  ...overrides,
})

const NOW = new Date(2026, 8, 29, 12) // 29 Sep 2026

describe("isCountedOrder", () => {
  it("counts an ordinary order and one whose Odoo state is not known yet", () => {
    expect(isCountedOrder(order())).toBe(true)
    expect(isCountedOrder(order({ odoo_state: null }))).toBe(true)
  })

  it("leaves out a cancelled order and one dismissed in the old queue", () => {
    expect(isCountedOrder(order({ odoo_state: "cancel" }))).toBe(false)
    expect(isCountedOrder(order({ is_excluded: true }))).toBe(false)
  })
})

describe("rangeBounds + ordersInRange", () => {
  const orders = [
    order({ id: "old", ordered_at: at(2025, 12, 20) }),
    order({ id: "aug", ordered_at: at(2026, 8, 5) }),
    order({ id: "sep", ordered_at: at(2026, 9, 25) }),
    order({ id: "nodate", ordered_at: null }),
    order({ id: "cancelled", ordered_at: at(2026, 9, 25), odoo_state: "cancel" }),
  ]
  const ids = (list) => list.map((o) => o.id).sort()

  it("all time keeps every counted order, dated or not", () => {
    expect(ids(ordersInRange(orders, rangeBounds("all", NOW)))).toEqual(["aug", "nodate", "old", "sep"])
  })

  it("30 days reaches back 30 days from today", () => {
    expect(ids(ordersInRange(orders, rangeBounds("30d", NOW)))).toEqual(["sep"])
  })

  it("3 months is this calendar month and the two before it", () => {
    expect(ids(ordersInRange(orders, rangeBounds("3m", NOW)))).toEqual(["aug", "sep"])
  })

  it("this year starts on 1 January", () => {
    expect(ids(ordersInRange(orders, rangeBounds("year", NOW)))).toEqual(["aug", "sep"])
  })

  it("a custom range includes its whole last day", () => {
    const bounds = rangeBounds("custom", NOW, { from: "2026-08-05", to: "2026-08-05" })
    expect(ids(ordersInRange(orders, bounds))).toEqual(["aug"])
  })

  it("a half-typed custom range stays open on the missing side instead of throwing", () => {
    expect(rangeBounds("custom", NOW, { from: "2026-08-01", to: "" }).to).toBeNull()
    expect(rangeBounds("custom", NOW, { from: "not a date" }).from).toBeNull()
  })
})

describe("summarize", () => {
  it("totals, counts and averages", () => {
    expect(summarize([order({ amount: 100 }), order({ amount: 300 })])).toEqual({ total: 400, count: 2, average: 200 })
  })

  it("has no average for no orders", () => {
    expect(summarize([])).toEqual({ total: 0, count: 0, average: 0 })
  })

  it("reads a numeric string amount, as Postgres numeric arrives", () => {
    expect(summarize([order({ amount: "250.50" })]).total).toBe(250.5)
  })
})

describe("monthOverMonth", () => {
  it("compares this calendar month with the last, whatever else is on screen", () => {
    const orders = [
      order({ amount: 600, ordered_at: at(2026, 9, 3) }),
      order({ amount: 400, ordered_at: at(2026, 8, 20) }),
      order({ amount: 999, ordered_at: at(2026, 7, 20) }),
      order({ amount: 999, ordered_at: at(2026, 9, 3), odoo_state: "cancel" }),
    ]
    const { thisMonth, lastMonth, deltaPct } = monthOverMonth(orders, NOW)
    expect(thisMonth).toBe(600)
    expect(lastMonth).toBe(400)
    expect(deltaPct).toBe(50)
  })

  it("has no percentage when last month had no sales", () => {
    expect(monthOverMonth([order({ ordered_at: at(2026, 9, 3) })], NOW).deltaPct).toBeNull()
  })
})

describe("monthlySeries", () => {
  it("stacks storefronts per month, oldest first, and fills a quiet month with zero", () => {
    const { rows, storefronts } = monthlySeries([
      order({ storefront: "Shopee", amount: 100, ordered_at: at(2026, 7, 5) }),
      order({ storefront: "Lazada", amount: 50, ordered_at: at(2026, 7, 6) }),
      order({ storefront: "Shopee", amount: 300, ordered_at: at(2026, 9, 5) }),
    ])
    expect(storefronts).toEqual(["Lazada", "Shopee"])
    expect(rows.map((r) => r.key)).toEqual(["2026-07", "2026-08", "2026-09"])
    expect(rows[0]).toMatchObject({ Shopee: 100, Lazada: 50, total: 150 })
    expect(rows[1].total).toBe(0)
    expect(rows[2]).toMatchObject({ Shopee: 300, total: 300 })
  })

  it("crosses a year boundary without skipping December", () => {
    const { rows } = monthlySeries([
      order({ ordered_at: at(2025, 12, 5) }),
      order({ ordered_at: at(2026, 2, 5) }),
    ])
    expect(rows.map((r) => r.key)).toEqual(["2025-12", "2026-01", "2026-02"])
  })

  it("is empty for no orders", () => {
    expect(monthlySeries([])).toEqual({ rows: [], storefronts: [] })
  })
})

describe("monthStorefrontGroups", () => {
  it("orders months newest first (not alphabetically) and storefronts A–Z", () => {
    const groups = monthStorefrontGroups([
      order({ storefront: "Shopee", ordered_at: at(2026, 8, 5) }),
      order({ storefront: "Shopee", ordered_at: at(2026, 12, 5) }),
      order({ storefront: "Lazada", ordered_at: at(2026, 12, 6) }),
    ])
    expect(groups.map((g) => `${g.monthKey}/${g.storefront}`)).toEqual([
      "2026-12/Lazada",
      "2026-12/Shopee",
      "2026-08/Shopee",
    ])
  })

  it("puts undated orders in a trailing Unknown group and sorts orders newest first", () => {
    const groups = monthStorefrontGroups([
      order({ id: "a", ordered_at: null }),
      order({ id: "b", ordered_at: at(2026, 9, 1) }),
      order({ id: "c", ordered_at: at(2026, 9, 20) }),
    ])
    expect(groups[groups.length - 1].month).toBe("Unknown")
    expect(groups[0].orders.map((o) => o.id)).toEqual(["c", "b"])
    expect(groups[0].total).toBe(200)
  })
})

describe("monthKey", () => {
  it("is null for a missing or bad date", () => {
    expect(monthKey(null)).toBeNull()
    expect(monthKey("nope")).toBeNull()
  })
})
