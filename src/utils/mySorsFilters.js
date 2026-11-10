import { periodValue } from "../lib/period"

/**
 * My SORs filters (#478). The list only grows — every window anyone opens on
 * someone stays listed after it ends — so the default view is "still in a
 * window", and the rest narrow it the way the other registers do.
 */
export const MY_SORS_ALL = "ALL"
/** Access choice that hides ended rows - the default. "ALL" shows them too. */
export const MY_SORS_CURRENT = "CURRENT"
/** Access choices: Full (Deal Team), In window (called in / mentioned and still open), Access ended. */
export const MY_SORS_FULL = "FULL"
export const MY_SORS_IN_WINDOW = "IN_WINDOW"
export const MY_SORS_ENDED = "ENDED"
/** Window sources ("Why I'm here"). Any other source is a called-in one. */
export const SOURCE_DEAL_TEAM = "deal_team"
export const SOURCE_MENTION = "mention"
export const SOURCE_CALLED_IN = "called_in"

export const DEFAULT_MY_SORS_FILTERS = {
  search: "",
  access: MY_SORS_CURRENT, // CURRENT | ALL | FULL | IN_WINDOW | ENDED
  via: MY_SORS_ALL, // ALL | deal_team | called_in | mention
  stage: MY_SORS_ALL,
  flow: MY_SORS_ALL,
  timeframe: "MONTHLY",
  period: "",
}

/**
 * A saved default from before Full/In window existed holds `access: "OPEN"`,
 * which then meant "hide ended rows" - today's "Current access". Read it that
 * way so existing users keep their view. (In window is "IN_WINDOW", so a new
 * save never collides with the old value.)
 */
export function migrateSavedMySorsFilters(filters) {
  return filters?.access === "OPEN" ? { ...filters, access: MY_SORS_CURRENT } : filters
}

const localPeriod = (iso, timeframe) => (iso ? periodValue(timeframe, new Date(iso)) : null)

/** The date a row sits under in the period filter: last activity, else its latest window's end, else its start. */
function rowDate(r) {
  if (r.lastActivityAt) return r.lastActivityAt
  const times = (key) => (r.windows || []).map((w) => w[key]).filter(Boolean).sort()
  return times("closedAt").pop() || times("createdAt").pop() || null
}

export function applyMySorsFilters(rows, filters) {
  const f = { ...DEFAULT_MY_SORS_FILTERS, ...filters }
  const needle = f.search.trim().toLowerCase()
  return (rows || []).filter((r) => {
    if (f.access === MY_SORS_CURRENT && !r.isOpen) return false
    if (f.access === MY_SORS_FULL && !r.windows.some((w) => w.source === SOURCE_DEAL_TEAM)) return false
    if (f.access === MY_SORS_IN_WINDOW && !r.windows.some((w) => w.source !== SOURCE_DEAL_TEAM && !w.closedAt)) return false
    if (f.access === MY_SORS_ENDED && r.isOpen) return false
    if (needle && ![r.salesReference, r.sorCode, r.clientName, r.projectTitle].some((v) => (v || "").toLowerCase().includes(needle))) return false
    if (f.via === SOURCE_MENTION && !r.windows.some((w) => w.source === SOURCE_MENTION)) return false
    if (f.via === SOURCE_DEAL_TEAM && !r.windows.some((w) => w.source === SOURCE_DEAL_TEAM)) return false
    if (f.via === SOURCE_CALLED_IN && !r.windows.some((w) => w.source !== SOURCE_MENTION && w.source !== SOURCE_DEAL_TEAM)) return false
    if (f.stage !== MY_SORS_ALL && r.currentStageName !== f.stage) return false
    if (f.flow !== MY_SORS_ALL && r.saleTypeName !== f.flow) return false
    // The SOR's last activity, not when a window opened. Locked / ended rows
    // carry none, so they fall back to their own window's time.
    if (f.period && localPeriod(rowDate(r), f.timeframe) !== f.period) return false
    return true
  })
}

const distinct = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))

export function mySorsFilterOptions(rows) {
  return {
    stage: distinct((rows || []).map((r) => r.currentStageName)),
    flow: distinct((rows || []).map((r) => r.saleTypeName)),
  }
}

export function hasActiveMySorsFilters(filters) {
  const f = { ...DEFAULT_MY_SORS_FILTERS, ...filters }
  return (
    f.search.trim() !== "" ||
    f.access !== DEFAULT_MY_SORS_FILTERS.access ||
    f.via !== MY_SORS_ALL ||
    f.stage !== MY_SORS_ALL ||
    f.flow !== MY_SORS_ALL ||
    f.period !== ""
  )
}
