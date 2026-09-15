import { describe, expect, it } from "vitest"
import { resolvePeople, resolveGroupMemberIds, teamOptions } from "./resolvePeople"

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
