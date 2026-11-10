import { describe, expect, it } from "vitest"
import { resolvePeople, resolveGroupMemberIds, teamOptions, departmentOptions } from "./resolvePeople"

const employees = [
  { id: "ana", sub_department: "PURCHASING" },
  { id: "ben", sub_department: " purchasing " },
  { id: "cy", sub_department: "MARKETING" },
  { id: "dee", sub_department: "PURCHASING", is_deleted: true },
  { id: "eli", sub_department: null },
  { id: "fay", sub_department: "ALL" },
]

describe("resolvePeople", () => {
  it("combines hand-picked people and a Team, each person once", () => {
    const groupMembersById = { g1: { employeeIds: ["cy", "ana"], teams: ["Purchasing"] } }

    expect(resolvePeople([{ type: "group", id: "g1" }], { employees, groupMembersById })).toEqual([
      "ana",
      "ben",
      "cy",
    ])
  })

  it("never counts a deleted employee, however they were named", () => {
    const groupMembersById = { g1: { employeeIds: ["dee"], teams: [] } }

    expect(
      resolvePeople(
        [
          { type: "employee", id: "dee" },
          { type: "group", id: "g1" },
          { type: "team", team: "PURCHASING" },
        ],
        { employees, groupMembersById },
      ),
    ).toEqual(["ana", "ben"])
  })

  it("resolves a Deal Team role against the SOR it is given", () => {
    const opportunity = { deal_owner_id: "cy", support_sales_1_id: "ana", support_sales_2_id: "eli" }

    expect(resolvePeople([{ type: "role", role: "deal_owner" }], { employees, opportunity })).toEqual(["cy"])
    expect(resolvePeople([{ type: "role", role: "support_sales" }], { employees, opportunity })).toEqual([
      "ana",
      "eli",
    ])
  })

  it("resolves a role to nobody without an SOR", () => {
    expect(resolvePeople([{ type: "role", role: "deal_owner" }], { employees })).toEqual([])
  })

  it("still resolves an archived group", () => {
    const groupMembersById = {
      old: { archived_at: "2026-09-01T00:00:00Z", employeeIds: ["eli"], teams: ["MARKETING"] },
    }

    expect(resolvePeople([{ type: "group", id: "old" }], { employees, groupMembersById })).toEqual([
      "cy",
      "eli",
    ])
  })

  it("resolves a group it knows nothing about to nobody", () => {
    expect(resolvePeople([{ type: "group", id: "missing" }], { employees })).toEqual([])
  })
})

describe("resolvePeople everyone", () => {
  it("resolves to every non-deleted employee, with or without a Sub-department", () => {
    expect(resolvePeople([{ type: "everyone" }], { employees })).toEqual(["ana", "ben", "cy", "eli", "fay"])
  })

  it("covers an employee added after the selector was saved", () => {
    const later = [...employees, { id: "gus", sub_department: null }]
    expect(resolvePeople([{ type: "everyone" }], { employees: later })).toContain("gus")
  })
})

describe("resolveGroupMemberIds", () => {
  it("matches a Team after trimming and upper-casing both sides", () => {
    expect(resolveGroupMemberIds({ teams: [" purchasing"] }, employees)).toEqual(["ana", "ben"])
  })
})

describe("teamOptions", () => {
  it("offers each non-blank Sub-department once, without ALL or deleted people's teams", () => {
    expect(teamOptions([...employees, { id: "gus", sub_department: "LOGISTICS", is_deleted: true }])).toEqual([
      "MARKETING",
      "PURCHASING",
    ])
  })
})

describe("app-shaped employees (camelCase subDepartment)", () => {
  const appStaff = [
    { id: "ana", subDepartment: "PURCHASING" },
    { id: "ben", subDepartment: "MARKETING" },
  ]

  it("offers Teams from the shape employeeService returns", () => {
    expect(teamOptions(appStaff)).toEqual(["MARKETING", "PURCHASING"])
  })

  it("resolves a Team selector and a group's Teams the same way", () => {
    expect(resolvePeople([{ type: "team", team: "purchasing" }], { employees: appStaff })).toEqual(["ana"])
    expect(resolveGroupMemberIds({ teams: ["MARKETING"] }, appStaff)).toEqual(["ben"])
  })
})

describe("resolvePeople department", () => {
  const staff = [
    { id: "sam", department: "SALES", sub_department: "" },
    { id: "gus", department: " sales ", sub_department: "GOV" },
    { id: "val", department: "SALES", sub_department: "SALES" },
    { id: "ops", department: "OPERATIONS", sub_department: "SALES" },
    { id: "gone", department: "SALES", is_deleted: true },
    { id: "nul", department: null },
  ]

  it("covers the whole Department whatever the Sub-department, ignoring case and spacing", () => {
    expect(resolvePeople([{ type: "department", department: "Sales" }], { employees: staff })).toEqual([
      "sam",
      "gus",
      "val",
    ])
  })

  it("resolves a blank Department to nobody", () => {
    expect(resolvePeople([{ type: "department", department: "  " }], { employees: staff })).toEqual([])
  })
})

describe("departmentOptions", () => {
  it("lists distinct live non-blank Departments, upper-cased, without ALL", () => {
    expect(
      departmentOptions([
        { department: "sales" },
        { department: "SALES " },
        { department: "OPERATIONS" },
        { department: "ALL" },
        { department: null },
        { department: "ADMIN", is_deleted: true },
      ]),
    ).toEqual(["OPERATIONS", "SALES"])
  })
})
