import { describe, expect, it } from "vitest"
import { groupLeaveRows } from "./leaveGroups"

/**
 * HR's Leaves Manager reads one entry per submission, not one per day-row, so
 * this is the seam that turns a 3-day leave's three rows back into the single
 * application an employee actually made (ticket #63).
 */
describe("groupLeaveRows", () => {
  it("collapses rows sharing a leave_group_id into one entry with inclusive dates and a day count", () => {
    const rows = [
      { id: "r1", leave_group_id: "g1", date: "2026-03-17", hours: 4, status: "PENDING" },
      { id: "r2", leave_group_id: "g1", date: "2026-03-16", hours: 8, status: "PENDING" },
    ]

    const [group] = groupLeaveRows(rows)

    expect(group.leave_group_id).toBe("g1")
    expect(group.dates).toEqual(["2026-03-16", "2026-03-17"])
    expect(group.startDate).toBe("2026-03-16")
    expect(group.endDate).toBe("2026-03-17")
    expect(group.dayCount).toBe(2)
    expect(group.hours).toBe(12)
  })

  it("treats a row with no leave_group_id as a group of one, keyed by its own id", () => {
    const rows = [{ id: "r1", date: "2026-03-10", hours: 4, status: "PENDING" }]

    const [group] = groupLeaveRows(rows)

    expect(group.leave_group_id).toBe("r1")
    expect(group.dayCount).toBe(1)
    expect(group.hours).toBe(4)
  })

  it("keeps separate groups separate", () => {
    const rows = [
      { id: "r1", leave_group_id: "g1", date: "2026-03-10", hours: 8, status: "PENDING" },
      { id: "r2", leave_group_id: "g2", date: "2026-03-11", hours: 8, status: "PENDING" },
    ]

    const groups = groupLeaveRows(rows)

    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.leave_group_id)).toEqual(["g1", "g2"])
  })

  it("carries the other fields from the earliest day in the group", () => {
    const rows = [
      { id: "r1", leave_group_id: "g1", date: "2026-03-17", hours: 8, status: "APPROVED", reason: "Trip", employee: { name: "Ana" } },
      { id: "r2", leave_group_id: "g1", date: "2026-03-16", hours: 8, status: "APPROVED", reason: "Trip", employee: { name: "Ana" } },
    ]

    const [group] = groupLeaveRows(rows)

    expect(group.date).toBe("2026-03-16")
    expect(group.reason).toBe("Trip")
    expect(group.status).toBe("APPROVED")
    expect(group.employee).toEqual({ name: "Ana" })
  })

  it("reports the latest updated_at across the group's rows", () => {
    const rows = [
      { id: "r1", leave_group_id: "g1", date: "2026-03-16", hours: 8, updated_at: "2026-03-20T01:00:00.000Z" },
      { id: "r2", leave_group_id: "g1", date: "2026-03-17", hours: 8, updated_at: "2026-03-20T03:00:00.000Z" },
    ]

    const [group] = groupLeaveRows(rows)

    expect(group.updated_at).toBe("2026-03-20T03:00:00.000Z")
  })

  it("returns an empty list for an empty input", () => {
    expect(groupLeaveRows([])).toEqual([])
  })
})
