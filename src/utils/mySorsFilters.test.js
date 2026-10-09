import { describe, expect, it } from "vitest"
import { DEFAULT_MY_SORS_FILTERS, MY_SORS_ALL, applyMySorsFilters, hasActiveMySorsFilters, mySorsFilterOptions } from "./mySorsFilters"

const row = (over) => ({
  opportunityId: over.id,
  salesReference: null,
  projectTitle: null,
  sorCode: null,
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
    currentStageName: "Costing",
    saleTypeName: "Government",
    windows: [{ source: "mention", createdAt: "2026-10-05T02:00:00Z", closedAt: null }],
  }),
  row({
    id: "b",
    salesReference: "SR-002",
    projectTitle: "School CCTV",
    currentStageName: "Quotation",
    saleTypeName: "Outright",
    isOpen: false,
    windows: [{ source: "action", createdAt: "2026-09-12T02:00:00Z", closedAt: "2026-09-20T02:00:00Z" }],
  }),
]

const run = (patch) => applyMySorsFilters(rows, { ...DEFAULT_MY_SORS_FILTERS, ...patch }).map((r) => r.opportunityId)

describe("applyMySorsFilters", () => {
  it("hides ended access by default", () => {
    expect(run({})).toEqual(["a"])
    expect(run({ access: MY_SORS_ALL })).toEqual(["a", "b"])
    expect(run({ access: "ENDED" })).toEqual(["b"])
  })

  it("searches Sales Reference, SOR code and project", () => {
    expect(run({ access: MY_SORS_ALL, search: "sr-002" })).toEqual(["b"])
    expect(run({ access: MY_SORS_ALL, search: "0042" })).toEqual(["a"])
    expect(run({ access: MY_SORS_ALL, search: "cctv" })).toEqual(["b"])
  })

  it("filters by why I'm here, Stage and Sales Flow", () => {
    expect(run({ access: MY_SORS_ALL, via: "mention" })).toEqual(["a"])
    expect(run({ access: MY_SORS_ALL, via: "called_in" })).toEqual(["b"])
    expect(run({ access: MY_SORS_ALL, stage: "Quotation" })).toEqual(["b"])
    expect(run({ access: MY_SORS_ALL, flow: "Government" })).toEqual(["a"])
  })

  it("filters by the period a window was opened in", () => {
    expect(run({ access: MY_SORS_ALL, timeframe: "MONTHLY", period: "2026-09" })).toEqual(["b"])
    expect(run({ access: MY_SORS_ALL, timeframe: "YEARLY", period: "2026" })).toEqual(["a", "b"])
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
