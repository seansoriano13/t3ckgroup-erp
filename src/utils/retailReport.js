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
 * Odoo states that are a real sale. A quotation (draft, sent) is not one yet,
 * and a cancelled order is not one any more.
 */
const CONFIRMED_STATES = ["sale", "done"]

/**
 * An order counts toward the report when Odoo has confirmed it and nobody
 * dismissed it in the old queue. A null Odoo state (a backfilled row the sync
 * has not refreshed yet) counts until the sync says otherwise.
 */
export function isCountedOrder(order) {
  if (order.is_excluded) return false
  return order.odoo_state == null || CONFIRMED_STATES.includes(order.odoo_state)
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

/**
 * Whether an order's Order Income can be trusted, derived and never stored.
 * Missing: no Order Income. Suspect: income above the Order Amount, or a
 * Marketplace Fee that eats the whole Order Amount. Fee + income differing from
 * the Order Amount alone is normal (shipping, vouchers) and stays OK.
 */
export function incomeStatus(order) {
  if (order.order_income == null) return "missing"
  const amount = amountOf(order)
  if (Number(order.order_income) > amount) return "suspect"
  if (order.marketplace_fee != null && Number(order.marketplace_fee) >= amount) return "suspect"
  return "ok"
}

/** The Order Income an order contributes to a total: only OK orders carry any. */
export const incomeOf = (order) => (incomeStatus(order) === "ok" ? Number(order.order_income) || 0 : 0)

/**
 * Headline figures. `total`/`average` are Order Income over OK orders only;
 * `count` is every order given; Missing and Suspect orders are counted with the
 * Order Amount they put at stake.
 */
export function summarize(orders) {
  let total = 0
  let okCount = 0
  let missingCount = 0
  let missingAmount = 0
  let suspectCount = 0
  let suspectAmount = 0
  for (const order of orders) {
    const status = incomeStatus(order)
    if (status === "ok") {
      total += Number(order.order_income) || 0
      okCount += 1
    } else if (status === "missing") {
      missingCount += 1
      missingAmount += amountOf(order)
    } else {
      suspectCount += 1
      suspectAmount += amountOf(order)
    }
  }
  return {
    total,
    count: orders.length,
    average: okCount === 0 ? 0 : total / okCount,
    missingCount,
    missingAmount,
    suspectCount,
    suspectAmount,
  }
}

/**
 * The Shopee-vs-Lazada breakdown: one row per Marketplace, A–Z, over the orders
 * given (so the date range, and any filter, is applied before it gets here). A
 * Marketplace is the platform, so a Marketplace's several Storefronts roll into
 * one row.
 *
 * `orderCount` is every order given, Missing and Suspect included, so the rows
 * add up to the headline order count. Everything money-shaped — `orderIncome`,
 * `averageIncome` (Order Income ÷ OK orders, null with no OK order),
 * `totalFees` — counts OK orders only.
 *
 * `feeRate` is a fraction, Σfee ÷ (Σfee + Σincome), over the OK orders that have
 * both a Marketplace Fee and an Order Income. It is null when there are none (or
 * when both sums are zero) rather than a rate made up from nothing. An OK order
 * with an income but no fee still counts toward `orderIncome`; it is left out of
 * the rate so a missing fee cannot read as a cheap one.
 */
export function marketplaceBreakdown(orders) {
  const byMarketplace = new Map()
  for (const order of orders) {
    const marketplace = order.marketplace || "Other"
    if (!byMarketplace.has(marketplace)) {
      byMarketplace.set(marketplace, {
        marketplace,
        orderIncome: 0,
        orderCount: 0,
        totalFees: 0,
        missingCount: 0,
        okCount: 0,
        ratedIncome: 0, // income of the OK orders that also carry a fee
      })
    }
    const row = byMarketplace.get(marketplace)
    row.orderCount += 1
    const status = incomeStatus(order)
    if (status === "missing") row.missingCount += 1
    if (status !== "ok") continue

    const income = incomeOf(order)
    row.okCount += 1
    row.orderIncome += income
    if (order.marketplace_fee != null) {
      row.totalFees += Number(order.marketplace_fee) || 0
      row.ratedIncome += income
    }
  }

  return [...byMarketplace.values()]
    .sort((a, b) => a.marketplace.localeCompare(b.marketplace))
    .map(({ okCount, ratedIncome, ...row }) => {
      const ratedTotal = row.totalFees + ratedIncome
      return {
        ...row,
        averageIncome: okCount === 0 ? null : row.orderIncome / okCount,
        feeRate: ratedTotal === 0 ? null : row.totalFees / ratedTotal,
      }
    })
}

/**
 * Who to chase for Order Income: every Missing and Suspect order, grouped by
 * Odoo salesperson. Takes the orders already narrowed to what is on screen
 * (`ordersInRange`, and any filter on top), like `summarize`, so it follows the
 * range and filters rather than deciding them. Each group has a count and the
 * `orderAmount` its orders put at stake (Order Amount, never Order Income, which
 * these orders lack or cannot be trusted for); the list has a grand count and
 * `orderAmount`. Biggest Order Amount first, ties A–Z; orders with no
 * salesperson sit in one `salesperson: null` group, always last. A group's
 * orders run newest first.
 */
export function chaseList(orders) {
  const bySalesperson = new Map()
  let count = 0
  let orderAmount = 0
  for (const order of orders) {
    if (incomeStatus(order) === "ok") continue
    const salesperson = order.odoo_salesperson_name?.trim() || null
    if (!bySalesperson.has(salesperson)) {
      bySalesperson.set(salesperson, {
        id: salesperson === null ? "unassigned" : `salesperson::${salesperson}`,
        salesperson,
        count: 0,
        orderAmount: 0,
        orders: [],
      })
    }
    const group = bySalesperson.get(salesperson)
    group.count += 1
    group.orderAmount += amountOf(order)
    group.orders.push(order)
    count += 1
    orderAmount += amountOf(order)
  }
  const groups = [...bySalesperson.values()]
  for (const group of groups) {
    group.orders.sort((a, b) => new Date(b.ordered_at || 0) - new Date(a.ordered_at || 0))
  }
  groups.sort((a, b) => {
    if (a.salesperson === null || b.salesperson === null) return (a.salesperson === null) - (b.salesperson === null)
    return b.orderAmount - a.orderAmount || a.salesperson.localeCompare(b.salesperson)
  })
  return { groups, count, orderAmount }
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
    if (key === thisKey) thisMonth += incomeOf(order)
    else if (key === lastKey) lastMonth += incomeOf(order)
  }
  return {
    thisMonth,
    lastMonth,
    deltaPct: lastMonth === 0 ? null : ((thisMonth - lastMonth) / lastMonth) * 100,
  }
}

/**
 * Per-month Order Income, one column per marketplace, oldest month first, for the
 * stacked chart. Months with no orders between the first and last are filled
 * with zeros so a quiet month shows as a gap, not a skipped label.
 */
export function monthlySeries(orders) {
  const marketplaces = [...new Set(orders.map((o) => o.marketplace || "Other"))].sort()
  const byMonth = new Map()
  for (const order of orders) {
    const key = monthKey(order.ordered_at)
    if (!key) continue
    if (!byMonth.has(key)) byMonth.set(key, { key, total: 0 })
    const row = byMonth.get(key)
    const marketplace = order.marketplace || "Other"
    row[marketplace] = (row[marketplace] || 0) + incomeOf(order)
    row.total += incomeOf(order)
  }
  if (byMonth.size === 0) return { rows: [], marketplaces }

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
  return { rows, marketplaces }
}

/**
 * The month × marketplace breakdown under the chart: newest month first, then
 * marketplace A–Z. Orders with no date sit in a trailing "Unknown" group.
 */
export function monthMarketplaceGroups(orders) {
  const groups = new Map()
  for (const order of orders) {
    const key = monthKey(order.ordered_at)
    const marketplace = order.marketplace || "Other"
    const id = `${key ?? "unknown"}::${marketplace}`
    if (!groups.has(id)) groups.set(id, { id, monthKey: key, month: monthLabel(key), marketplace, total: 0, orders: [] })
    const group = groups.get(id)
    group.total += incomeOf(order)
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
    return a.marketplace.localeCompare(b.marketplace)
  })
}
