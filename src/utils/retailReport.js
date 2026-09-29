/**
 * Pure numbers behind the Retail report. No React, no Supabase — the screen
 * hands in `retail_orders` rows and gets figures back, so a wrong total is
 * caught here rather than by looking at a chart.
 */

/** Preset ranges the Retail report offers, in display order. */
export const RETAIL_RANGES = [
  { value: "30d", label: "30 days" },
  { value: "3m", label: "3 months" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom" },
]

/**
 * An order counts toward the report unless somebody dismissed it in the old
 * queue or Odoo cancelled it. A null Odoo state (a backfilled row the sync has
 * not refreshed yet) counts.
 */
export function isCountedOrder(order) {
  return !order.is_excluded && order.odoo_state !== "cancel"
}

/** "2026-08" — the sortable key a month is grouped under, in local time. */
export function monthKey(date) {
  if (!date) return null
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

/** "August 2026" for a `monthKey`. */
export function monthLabel(key) {
  if (!key) return "Unknown"
  const [year, month] = key.split("-").map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString("en-PH", { year: "numeric", month: "long" })
}

/** "Aug 2026" for chart ticks. */
export function monthShortLabel(key) {
  if (!key) return "?"
  const [year, month] = key.split("-").map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString("en-PH", { year: "2-digit", month: "short" })
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/**
 * `{ from, to }` (either may be null = unbounded) for a preset relative to
 * `now`. Custom bounds arrive as `YYYY-MM-DD` strings; `to` is inclusive of
 * that whole day. A half-filled or backwards custom range is left open on the
 * missing side rather than throwing — it is being typed live, in render.
 */
export function rangeBounds(range, now = new Date(), custom = {}) {
  switch (range) {
    case "30d": {
      const from = startOfDay(now)
      from.setDate(from.getDate() - 30)
      return { from, to: null }
    }
    case "3m":
      return { from: new Date(now.getFullYear(), now.getMonth() - 2, 1), to: null }
    case "year":
      return { from: new Date(now.getFullYear(), 0, 1), to: null }
    case "custom": {
      const from = custom.from ? new Date(`${custom.from}T00:00:00`) : null
      const to = custom.to ? new Date(`${custom.to}T23:59:59.999`) : null
      return {
        from: from && !Number.isNaN(from.getTime()) ? from : null,
        to: to && !Number.isNaN(to.getTime()) ? to : null,
      }
    }
    default:
      return { from: null, to: null }
  }
}

/** The counted orders whose order date falls inside `{ from, to }`. */
export function ordersInRange(orders, { from, to } = {}) {
  return orders.filter((order) => {
    if (!isCountedOrder(order)) return false
    if (!from && !to) return true
    if (!order.ordered_at) return false
    const at = new Date(order.ordered_at)
    if (from && at < from) return false
    if (to && at > to) return false
    return true
  })
}

const amountOf = (order) => Number(order.amount) || 0

/** Total sales, order count and average order value. */
export function summarize(orders) {
  const total = orders.reduce((sum, o) => sum + amountOf(o), 0)
  const count = orders.length
  return { total, count, average: count === 0 ? 0 : total / count }
}

/**
 * This calendar month against the last one, whatever range is on screen — the
 * question "are we up or down" does not change with a filter. `deltaPct` is
 * null when last month had nothing to compare against.
 */
export function monthOverMonth(orders, now = new Date()) {
  const thisKey = monthKey(now)
  const lastKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  let thisMonth = 0
  let lastMonth = 0
  for (const order of orders) {
    if (!isCountedOrder(order) || !order.ordered_at) continue
    const key = monthKey(order.ordered_at)
    if (key === thisKey) thisMonth += amountOf(order)
    else if (key === lastKey) lastMonth += amountOf(order)
  }
  return {
    thisMonth,
    lastMonth,
    deltaPct: lastMonth === 0 ? null : ((thisMonth - lastMonth) / lastMonth) * 100,
  }
}

/**
 * Per-month sales, one column per storefront, oldest month first, for the
 * stacked chart. Months with no orders between the first and last are filled
 * with zeros so a quiet month shows as a gap, not a skipped label.
 */
export function monthlySeries(orders) {
  const storefronts = [...new Set(orders.map((o) => o.storefront || "Other"))].sort()
  const byMonth = new Map()
  for (const order of orders) {
    const key = monthKey(order.ordered_at)
    if (!key) continue
    if (!byMonth.has(key)) byMonth.set(key, { key, total: 0 })
    const row = byMonth.get(key)
    const storefront = order.storefront || "Other"
    row[storefront] = (row[storefront] || 0) + amountOf(order)
    row.total += amountOf(order)
  }
  if (byMonth.size === 0) return { rows: [], storefronts }

  const keys = [...byMonth.keys()].sort()
  const rows = []
  let [year, month] = keys[0].split("-").map(Number)
  const [lastYear, lastMonth] = keys[keys.length - 1].split("-").map(Number)
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const key = `${year}-${String(month).padStart(2, "0")}`
    const row = byMonth.get(key) || { key, total: 0 }
    rows.push({ ...row, label: monthShortLabel(key) })
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return { rows, storefronts }
}

/**
 * The month × storefront breakdown under the chart: newest month first, then
 * storefront A–Z. Orders with no date sit in a trailing "Unknown" group.
 */
export function monthStorefrontGroups(orders) {
  const groups = new Map()
  for (const order of orders) {
    const key = monthKey(order.ordered_at)
    const storefront = order.storefront || "Other"
    const id = `${key ?? "unknown"}::${storefront}`
    if (!groups.has(id)) groups.set(id, { id, monthKey: key, month: monthLabel(key), storefront, total: 0, orders: [] })
    const group = groups.get(id)
    group.total += amountOf(order)
    group.orders.push(order)
  }
  const list = [...groups.values()]
  for (const group of list) {
    group.orders.sort((a, b) => new Date(b.ordered_at || 0) - new Date(a.ordered_at || 0))
  }
  return list.sort((a, b) => {
    if (a.monthKey !== b.monthKey) {
      if (a.monthKey === null) return 1
      if (b.monthKey === null) return -1
      return b.monthKey.localeCompare(a.monthKey)
    }
    return a.storefront.localeCompare(b.storefront)
  })
}
