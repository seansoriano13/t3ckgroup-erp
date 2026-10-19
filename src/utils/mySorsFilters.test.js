import { describe, expect, it } from "vitest"
import {
  DEFAULT_MY_SORS_FILTERS,
  MY_SORS_ALL,
  MY_SORS_CURRENT,
  MY_SORS_ENDED,
  MY_SORS_FULL,
  MY_SORS_IN_WINDOW,
  SOURCE_CALLED_IN,
  SOURCE_DEAL_TEAM,
  SOURCE_MENTION,
  applyMySorsFilters,
  hasActiveMySorsFilters,
  migrateSavedMySorsFilters,
  mySorsFilterOptions,
} from "./mySorsFilters"

const row = (over) => ({
  opportunityId: over.id,
  salesReference: null,
  projectTitle: null,
  sorCode: null,
  clientName: null,
  currentStageName: null,
  saleTypeName: null,
  isOpen: true,
  windows: [],
  ...over,
})

const rows = [
  row({
    id: "a",
    salesReference: "SR-001",
    projectTitle: "Hospital chillers",
    sorCode: "SOR-0042",
    clientName: "Metro Hospital Corp",
    currentStageName: "Costing",
    saleTypeName: "Government",
    lastActivityAt: "2026-10-06T02:00:00Z",
    windows: [{ source: "mention", createdAt: "2026-10-05T02:00:00Z", closedAt: null }],
  }),
  row({
    id: "b",
    salesReference: "SR-002",
    projectTitle: "School CCTV",
    currentStageName: "Quotation",
    saleTypeName: "Outright",
    isOpen: false,
    lastActivityAt: "2026-09-20T02:00:00Z",
    windows: [{ source: "action", createdAt: "2026-09-12T02:00:00Z", closedAt: "2026-09-20T02:00:00Z" }],
  }),
  row({
    id: "c",
    salesReference: "SR-003",
    projectTitle: "Own deal",
    lastActivityAt: "2026-08-02T02:00:00Z",
    windows: [{ source: "deal_team", createdAt: null, closedAt: null }],
  }),
]

const run = (patch) => applyMySorsFilters(rows, { ...DEFAULT_MY_SORS_FILTERS, ...patch }).map((r) => r.opportunityId)

describe("applyMySorsFilters", () => {
  it("hides ended access by default", () => {
    expect(run({})).toEqual(["a", "c"])
    expect(run({ access: MY_SORS_ALL })).toEqual(["a", "b", "c"])
    expect(run({ access: MY_SORS_ENDED })).toEqual(["b"])
  })

  it("splits Full from In window", () => {
    expect(run({ access: MY_SORS_FULL })).toEqual(["c"])
    expect(run({ access: MY_SORS_IN_WINDOW })).toEqual(["a"])
  })

  it("searches Sales Reference, SOR code, client and project", () => {
    expect(run({ access: MY_SORS_ALL, search: "metro hosp" })).toEqual(["a"])
    expect(run({ access: MY_SORS_ALL, search: "sr-002" })).toEqual(["b"])
    expect(run({ access: MY_SORS_ALL, search: "0042" })).toEqual(["a"])
    expect(run({ access: MY_SORS_ALL, search: "cctv" })).toEqual(["b"])
  })

  it("filters by why I'm here, Stage and Sales Flow", () => {
    expect(run({ access: MY_SORS_ALL, via: SOURCE_DEAL_TEAM })).toEqual(["c"])
    expect(run({ access: MY_SORS_ALL, via: SOURCE_MENTION })).toEqual(["a"])
    expect(run({ access: MY_SORS_ALL, via: SOURCE_CALLED_IN })).toEqual(["b"])
    expect(run({ access: MY_SORS_ALL, stage: "Quotation" })).toEqual(["b"])
    expect(run({ access: MY_SORS_ALL, flow: "Government" })).toEqual(["a"])
  })

  it("filters by the SOR's last activity, not when a window opened", () => {
    expect(run({ access: MY_SORS_ALL, timeframe: "MONTHLY", period: "2026-09" })).toEqual(["b"])
    // "a" opened a window on the 5th but was last active on the 6th; "c" has no window date at all.
    expect(run({ access: MY_SORS_ALL, timeframe: "MONTHLY", period: "2026-08" })).toEqual(["c"])
    expect(run({ access: MY_SORS_ALL, timeframe: "YEARLY", period: "2026" })).toEqual(["a", "b", "c"])
  })
})

describe("mySorsFilterOptions / hasActiveMySorsFilters", () => {
  it("offers only the Stages and Sales Flows present", () => {
    expect(mySorsFilterOptions(rows)).toEqual({ stage: ["Costing", "Quotation"], flow: ["Government", "Outright"] })
  })

  it("counts the default view as not narrowed", () => {
    expect(hasActiveMySorsFilters(DEFAULT_MY_SORS_FILTERS)).toBe(false)
    expect(hasActiveMySorsFilters({ ...DEFAULT_MY_SORS_FILTERS, search: "x" })).toBe(true)
  })
})

describe("migrateSavedMySorsFilters", () => {
  it("reads an old saved access of OPEN as Current access, and leaves everything else alone", () => {
    expect(migrateSavedMySorsFilters({ ...DEFAULT_MY_SORS_FILTERS, access: "OPEN" }).access).toBe(MY_SORS_CURRENT)
    const inWindow = { ...DEFAULT_MY_SORS_FILTERS, access: MY_SORS_IN_WINDOW }
    expect(migrateSavedMySorsFilters(inWindow)).toBe(inWindow)
    expect(migrateSavedMySorsFilters(DEFAULT_MY_SORS_FILTERS)).toBe(DEFAULT_MY_SORS_FILTERS)
  })

  it("keeps rows with no last activity when no period is chosen", () => {
    const noActivity = [row({ id: "z", lastActivityAt: null })]
    expect(applyMySorsFilters(noActivity, DEFAULT_MY_SORS_FILTERS)).toHaveLength(1)
  })
})
