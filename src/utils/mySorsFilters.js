import { periodValue } from "../lib/period"

/**
 * My SORs filters (#478). The list only grows — every window anyone opens on
 * someone stays listed after it ends — so the default view is "still in a
 * window", and the rest narrow it the way the other registers do.
 */
export const MY_SORS_ALL = "ALL"

export const DEFAULT_MY_SORS_FILTERS = {
  search: "",
  access: "OPEN", // ALL | OPEN | ENDED
  via: MY_SORS_ALL, // ALL | called_in | mention
  stage: MY_SORS_ALL,
  flow: MY_SORS_ALL,
  timeframe: "MONTHLY",
  period: "",
}

const localPeriod = (iso, timeframe) => (iso ? periodValue(timeframe, new Date(iso)) : null)

export function applyMySorsFilters(rows, filters) {
  const f = { ...DEFAULT_MY_SORS_FILTERS, ...filters }
  const needle = f.search.trim().toLowerCase()
  return (rows || []).filter((r) => {
    if (f.access === "OPEN" && !r.isOpen) return false
    if (f.access === "ENDED" && r.isOpen) return false
    if (needle && ![r.salesReference, r.sorCode, r.projectTitle].some((v) => (v || "").toLowerCase().includes(needle))) return false
    if (f.via === "mention" && !r.windows.some((w) => w.source === "mention")) return false
    if (f.via === "called_in" && !r.windows.some((w) => w.source !== "mention")) return false
    if (f.stage !== MY_SORS_ALL && r.currentStageName !== f.stage) return false
    if (f.flow !== MY_SORS_ALL && r.saleTypeName !== f.flow) return false
    if (f.period && !r.windows.some((w) => localPeriod(w.createdAt, f.timeframe) === f.period)) return false
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
