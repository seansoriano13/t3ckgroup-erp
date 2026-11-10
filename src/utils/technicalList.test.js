import { describe, expect, it } from "vitest"
import { TECHNICAL_TAB, checkedLabel, filterTechnical, judgingProgress, overallCompliance, shapeTechnicalList, technicalState } from "./technicalList"

const row = (over = {}) => ({ opportunityId: "o1", sorNumber: "SOR-3", soNumber: "S03204", projectTitle: "Fire", clientName: "Marikina", stage: "Lead", team: "RRD", rowsTotal: 12, rowsJudged: 7, rowsDeviates: 0, compliance: null, approved: false, isMine: true, ...over })

describe("shapeTechnicalList", () => {
  it("camelCases a row and turns the counts into numbers", () => {
    const [shaped] = shapeTechnicalList([
      { opportunity_id: "o1", sor_code: "SOR-3", sales_reference: "S03204", project_title: "Fire", client_name: "Marikina", stage: "Lead", team: "RRD", rows_total: "12", rows_judged: "7", approved: false, is_mine: true },
    ])
    expect(shaped).toEqual(row())
  })

  it("copes with no rows and with blank names", () => {
    expect(shapeTechnicalList(null)).toEqual([])
    const [shaped] = shapeTechnicalList([{ opportunity_id: "o1", team: "IOE" }])
    expect(shaped.soNumber).toBe("")
    expect(shaped.rowsTotal).toBe(0)
    expect(shaped.isMine).toBe(false)
  })

  it("never carries a money field through", () => {
    const [shaped] = shapeTechnicalList([{ opportunity_id: "o1", team: "RRD", final_offer_total: 5, acquire_total: 3 }])
    expect(Object.keys(shaped).join(",")).not.toMatch(/offer|acquire|price|cost|landed/i)
  })
})

describe("checkedLabel", () => {
  it("says how many are checked", () => {
    expect(checkedLabel({ rowsJudged: 7, rowsTotal: 12 })).toBe("7 of 12 judged")
    expect(checkedLabel({ rowsJudged: 0, rowsTotal: 3 })).toBe("0 of 3 judged")
  })

  it("says all checked when none is left, but not for an empty list", () => {
    expect(checkedLabel({ rowsJudged: 12, rowsTotal: 12 })).toBe("All 12 judged")
    expect(checkedLabel({ rowsJudged: 0, rowsTotal: 0 })).toBe("0 of 0 judged")
  })
})

describe("overallCompliance (#932)", () => {
  const c = (compliance) => ({ compliance })

  it("is Complies only when every product complies", () => {
    expect(overallCompliance([c("complies"), c("complies")])).toBe("complies")
  })

  it("is Deviates as soon as one product deviates, even with others unjudged", () => {
    expect(overallCompliance([c("complies"), c("deviates")])).toBe("deviates")
    expect(overallCompliance([c(null), c("deviates")])).toBe("deviates")
  })

  it("is unjudged while any product is unjudged, and for no products", () => {
    expect(overallCompliance([c("complies"), c(null)])).toBeNull()
    expect(overallCompliance([])).toBeNull()
    expect(overallCompliance(null)).toBeNull()
  })
})

describe("judgingProgress (#932)", () => {
  it("counts judged of total and the deviations while judging", () => {
    expect(judgingProgress({ rowsTotal: 5, rowsJudged: 2, rowsDeviates: 1 })).toEqual({ total: 5, judged: 2, deviates: 1, done: false, result: null })
  })

  it("turns into the result once every product is judged", () => {
    expect(judgingProgress({ rowsTotal: 3, rowsJudged: 3, rowsDeviates: 0 })).toMatchObject({ done: true, result: "complies" })
    expect(judgingProgress({ rowsTotal: 3, rowsJudged: 3, rowsDeviates: 2 })).toMatchObject({ done: true, result: "deviates" })
  })

  it("is never done with no products", () => {
    expect(judgingProgress({ rowsTotal: 0, rowsJudged: 0 })).toMatchObject({ done: false, result: null })
  })
})

describe("technicalState", () => {
  it("is To check while any row is open, Checked once every row is answered, Approved after sign-off", () => {
    expect(technicalState(row()).key).toBe("to_check")
    expect(technicalState(row({ rowsJudged: 12 }))).toEqual({ key: "checked", label: "Checked" })
    expect(technicalState(row({ rowsJudged: 12, approved: true }))).toEqual({ key: "approved", label: "Approved" })
  })

  it("is To check for a team with no rows yet", () => {
    expect(technicalState(row({ rowsTotal: 0, rowsJudged: 0 })).key).toBe("to_check")
  })
})

describe("filterTechnical", () => {
  const rows = [
    row({ opportunityId: "a", sorNumber: "SOR-3", team: "RRD" }),
    row({ opportunityId: "b", sorNumber: "SOR-4", soNumber: "S04081", projectTitle: "Roof mounts", clientName: "Quezon", team: "IOE", rowsJudged: 12 }),
    row({ opportunityId: "c", sorNumber: "SOR-5", team: "RRD", rowsJudged: 12, approved: true }),
  ]
  const ids = (list) => list.map((r) => r.opportunityId)

  it("splits To check from Done, and All has both", () => {
    expect(ids(filterTechnical(rows, { tab: TECHNICAL_TAB.TO_CHECK }))).toEqual(["a"])
    expect(ids(filterTechnical(rows, { tab: TECHNICAL_TAB.DONE }))).toEqual(["b", "c"])
    expect(ids(filterTechnical(rows, { tab: TECHNICAL_TAB.ALL }))).toEqual(["a", "b", "c"])
  })

  it("lists under To approve only what has a verdict and no approval yet", () => {
    expect(ids(filterTechnical(rows, { tab: TECHNICAL_TAB.TO_APPROVE }))).toEqual(["b"])
  })

  it("searches the SOR number, SO number, project and client", () => {
    expect(ids(filterTechnical(rows, { search: "S04081" }))).toEqual(["b"])
    expect(ids(filterTechnical(rows, { search: "roof" }))).toEqual(["b"])
    expect(ids(filterTechnical(rows, { search: "quezon" }))).toEqual(["b"])
    expect(ids(filterTechnical(rows, { search: "SOR-5" }))).toEqual(["c"])
    expect(filterTechnical(rows, { search: "nothing like this" })).toEqual([])
  })
})

