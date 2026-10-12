/**
 * Pure numbers behind the Retail report. No React, no Supabase — the screen
 * hands in `retail_orders` rows and gets figures back, so a wrong total is
 * caught here rather than by looking at a chart.
 */

import { INCOME_STATUS, incomeStatus } from "../../supabase/functions/_shared/incomeStatus.ts"

export { INCOME_STATUS, incomeStatus }

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

/** What a filter holds when it is not narrowing anything: the word the app's other filter chips use. */
export const RETAIL_FILTER_ALL = "ALL"

// The label an order with a blank facet is filtered under, so it can be picked
// (and told apart) like any other value.
const marketplaceOf = (order) => order.marketplace || "Other"
const storefrontOf = (order) => order.partner_name || "Unknown"
const salespersonOf = (order) => order.odoo_salesperson_name || "Unassigned"

// The filters that match an order facet, and how an order reads under each.
// The one place the filter keys are named: the defaults, `applyFilters`,
// `hasActiveFilters` and `filterOptions` all follow this table.
const FACETS = {
  marketplace: marketplaceOf,
  storefront: storefrontOf,
  salesperson: salespersonOf,
  status: incomeStatus,
}
const FACET_KEYS = Object.keys(FACETS)

/** The Retail filters at rest. `status` is an `incomeStatus`; `search` is a Marketplace Order ID. */
export const DEFAULT_RETAIL_FILTERS = {
  ...Object.fromEntries(FACET_KEYS.map((key) => [key, RETAIL_FILTER_ALL])),
  search: "",
}

const isNarrowing = (value) => value != null && value !== "" && value !== RETAIL_FILTER_ALL

const searchTerm = (filters) => String(filters.search ?? "").trim().toLowerCase()

/** Whether a Marketplace Order ID search is on: the report then sets its date range aside. */
export const isSearching = (filters = {}) => searchTerm(filters) !== ""

/**
 * The one step every Retail figure reads from: the counted orders that fall in
 * the date range `bounds` AND pass every filter. Headline, Missing line,
 * monthly chart, month groups, breakdown and chase list all take this result,
 * so one set of controls drives the whole screen.
 *
 * `filters` is a `DEFAULT_RETAIL_FILTERS` shape (a missing key narrows nothing).
 * `search` matches part of a Marketplace Order ID, any case, and sets the date
 * range aside: an ID copied from Shopee or Lazada should find its order
 * however old it is. The other filters still apply.
 */
export function applyFilters(orders, filters = {}, bounds = {}) {
  const needle = searchTerm(filters)
  const narrowing = FACET_KEYS.filter((key) => isNarrowing(filters[key]))
  const matching = orders.filter((order) => {
    if (narrowing.some((key) => FACETS[key](order) !== filters[key])) return false
    if (needle && !String(order.marketplace_order_id ?? "").toLowerCase().includes(needle)) return false
    return true
  })
  return ordersInRange(matching, needle ? {} : bounds)
}

/** Whether any filter, the search included, is narrowing the report. */
export function hasActiveFilters(filters = {}) {
  return FACET_KEYS.some((key) => isNarrowing(filters[key])) || isSearching(filters)
}

/**
 * What each filter can be set to, A-Z, from the counted orders (whatever the
 * range or the other filters say, so a choice never vanishes from its own
 * list). Storefronts are those of the chosen Marketplace: a Lazada Storefront
 * is no use beside Shopee. Income status has a fixed list, so no options here.
 */
export function filterOptions(orders, { marketplace } = {}) {
  const counted = orders.filter(isCountedOrder)
  const distinct = (list, pick) => [...new Set(list.map(pick))].sort((a, b) => a.localeCompare(b))
  const ofMarketplace = isNarrowing(marketplace) ? counted.filter((o) => marketplaceOf(o) === marketplace) : counted
  return Object.fromEntries(
    FACET_KEYS.filter((key) => key !== "status").map((key) => [
      key,
      distinct(key === "storefront" ? ofMarketplace : counted, FACETS[key]),
    ]),
  )
}

const amountOf = (order) => Number(order.amount) || 0

/** The Order Income an order contributes to a total: only OK orders carry any. */
export const incomeOf = (order) => (incomeStatus(order) === INCOME_STATUS.OK ? Number(order.order_income) || 0 : 0)

/**
 * Headline figures. `total`/`average` are Order Income over OK orders only;
 * `count` is every order given; Missing and Suspect orders are counted with the
 * Order Amount they put at stake.
 */
export function summarize(orders) {
  let total = 0
  let okOrderCount = 0
  let missingCount = 0
  let missingAmount = 0
  let suspectCount = 0
  let suspectAmount = 0
  for (const order of orders) {
    const status = incomeStatus(order)
    if (status === INCOME_STATUS.OK) {
      total += Number(order.order_income) || 0
      okOrderCount += 1
    } else if (status === INCOME_STATUS.MISSING) {
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
    average: okOrderCount === 0 ? 0 : total / okOrderCount,
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
    const marketplace = marketplaceOf(order)
    if (!byMarketplace.has(marketplace)) {
      byMarketplace.set(marketplace, {
        marketplace,
        orderIncome: 0,
        orderCount: 0,
        totalFees: 0,
        missingCount: 0,
        okOrderCount: 0,
        incomeWithFee: 0, // income of the OK orders that also carry a fee
      })
    }
    const row = byMarketplace.get(marketplace)
    row.orderCount += 1
    const status = incomeStatus(order)
    if (status === INCOME_STATUS.MISSING) row.missingCount += 1
    if (status !== INCOME_STATUS.OK) continue

    const income = incomeOf(order)
    row.okOrderCount += 1
    row.orderIncome += income
    if (order.marketplace_fee != null) {
      row.totalFees += Number(order.marketplace_fee) || 0
      row.incomeWithFee += income
    }
  }

  return [...byMarketplace.values()]
    .sort((a, b) => a.marketplace.localeCompare(b.marketplace))
    .map(({ okOrderCount, incomeWithFee, ...row }) => {
      const ratedTotal = row.totalFees + incomeWithFee
      return {
        ...row,
        averageIncome: okOrderCount === 0 ? null : row.orderIncome / okOrderCount,
        feeRate: ratedTotal === 0 ? null : row.totalFees / ratedTotal,
      }
    })
}

/**
 * Who to chase for Order Income: every Missing and Suspect order, grouped by
 * Odoo salesperson. Takes the orders already narrowed to what is on screen
 * (`applyFilters`: range plus filters), like `summarize`, so it follows the
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
    if (incomeStatus(order) === INCOME_STATUS.OK) continue
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
    const amount = amountOf(order)
    const group = bySalesperson.get(salesperson)
    group.count += 1
    group.orderAmount += amount
    group.orders.push(order)
    count += 1
    orderAmount += amount
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
 * This calendar month so far against the same days of the last one (day 1 to
 * today's day-of-month), whatever date range is on screen — the question "are
 * we up or down" does not change with the range. The caller
 * passes the orders that pass the other filters (`applyFilters` without a
 * range). `deltaPct` is null when last month had nothing to compare against.
 */
export function monthOverMonth(orders, now = new Date()) {
  const thisKey = monthKey(now)
  const lastKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const dayOfMonth = now.getDate()
  let thisMonth = 0
  let lastMonth = 0
  for (const order of orders) {
    if (!isCountedOrder(order) || !order.ordered_at) continue
    const key = monthKey(order.ordered_at)
    if (key === thisKey) thisMonth += incomeOf(order)
    else if (key === lastKey && new Date(order.ordered_at).getDate() <= dayOfMonth) lastMonth += incomeOf(order)
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
  const marketplaces = [...new Set(orders.map(marketplaceOf))].sort()
  const byMonth = new Map()
  for (const order of orders) {
    const key = monthKey(order.ordered_at)
    if (!key) continue
    if (!byMonth.has(key)) byMonth.set(key, { key, total: 0 })
    const row = byMonth.get(key)
    const marketplace = marketplaceOf(order)
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
    const marketplace = marketplaceOf(order)
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
