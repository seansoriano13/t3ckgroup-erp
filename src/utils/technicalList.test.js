import { describe, expect, it } from "vitest"
import { judgedLabel, linesForTeams, shapeTechnicalList } from "./technicalList"

describe("shapeTechnicalList", () => {
  it("camelCases a row and turns the counts into numbers", () => {
    const [row] = shapeTechnicalList([
      { opportunity_id: "o1", sor_code: "SOR-3", sales_reference: "S03204", project_title: "Fire", client_name: "Marikina", stage: "Lead", team: "RRD", rows_total: "12", rows_judged: "7", approved: false, is_mine: true },
    ])
    expect(row).toEqual({
      opportunityId: "o1", sorNumber: "SOR-3", soNumber: "S03204", projectTitle: "Fire", clientName: "Marikina",
      stage: "Lead", team: "RRD", rowsTotal: 12, rowsJudged: 7, approved: false, isMine: true,
    })
  })

  it("copes with no rows and with blank names", () => {
    expect(shapeTechnicalList(null)).toEqual([])
    const [row] = shapeTechnicalList([{ opportunity_id: "o1", team: "IOE" }])
    expect(row.soNumber).toBe("")
    expect(row.rowsTotal).toBe(0)
  })

  it("never carries a money field through", () => {
    const [row] = shapeTechnicalList([{ opportunity_id: "o1", team: "RRD", final_offer_total: 5, acquire_total: 3 }])
    expect(Object.keys(row).join(",")).not.toMatch(/offer|acquire|price|cost|landed/i)
  })
})

describe("judgedLabel", () => {
  it("says how many are judged", () => {
    expect(judgedLabel({ rowsJudged: 7, rowsTotal: 12 })).toBe("7 of 12 judged")
    expect(judgedLabel({ rowsJudged: 0, rowsTotal: 3 })).toBe("0 of 3 judged")
  })

  it("says all judged when none is left, but not for an empty list", () => {
    expect(judgedLabel({ rowsJudged: 12, rowsTotal: 12 })).toBe("All 12 judged")
    expect(judgedLabel({ rowsJudged: 0, rowsTotal: 0 })).toBe("0 of 0 judged")
  })
})

describe("linesForTeams", () => {
  const lines = [
    { id: 1, evaluating_team: "RRD" },
    { id: 2, evaluating_team: "IOE" },
    { id: 3, evaluating_team: null },
  ]

  it("keeps only the rows of the caller's teams", () => {
    expect(linesForTeams(lines, ["RRD"]).map((l) => l.id)).toEqual([1])
    expect(linesForTeams(lines, ["RRD", "IOE"]).map((l) => l.id)).toEqual([1, 2])
  })

  it("gives a Super Admin (teams null) every team's rows, and never a row with no team", () => {
    expect(linesForTeams(lines, null).map((l) => l.id)).toEqual([1, 2])
  })

  it("gives nothing to someone on no team", () => {
    expect(linesForTeams(lines, [])).toEqual([])
    expect(linesForTeams(undefined, ["RRD"])).toEqual([])
  })
})
