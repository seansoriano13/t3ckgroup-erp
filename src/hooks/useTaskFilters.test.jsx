import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useTaskFilters } from "./useTaskFilters"

/**
 * The filter engine behind every task list. It decides what an employee, a
 * head and HR each see, so a wrong predicate either hides someone's work or
 * exposes work that is not theirs to review.
 *
 * The suite runs in Asia/Manila (see vitest.config.js) because the date filters
 * compare a UTC-derived day string against a date the user picked locally.
 */
const task = (overrides = {}) => ({
  id: `task-${Math.random().toString(36).slice(2)}`,
  taskDescription: "Replace the office switch",
  projectTitle: null,
  categoryId: "IT-01",
  loggedById: "emp-1",
  loggedByName: "Ana Reyes",
  reportedTo: null,
  status: "INCOMPLETE",
  priority: "LOW",
  hrVerified: false,
  grade: 0,
  paymentVoucher: "",
  createdAt: "2026-03-05T02:00:00Z",
  ...overrides,
})

const filter = (tasks, filters = {}, options = {}) =>
  renderHook(() => useTaskFilters(tasks, filters, options)).result.current

describe("useTaskFilters", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe("what is always hidden", () => {
    it("never shows a deleted task", () => {
      const { filteredTasks } = filter([task({ status: "DELETED" }), task()])

      expect(filteredTasks).toHaveLength(1)
    })
  })

  describe("search", () => {
    it("matches the description, project, category, employee and voucher", () => {
      const tasks = [
        task({ taskDescription: "Replace the switch" }),
        task({ taskDescription: "Other", projectTitle: "Network refresh" }),
        task({ taskDescription: "Other", categoryId: "FIN-02" }),
        task({ taskDescription: "Other", loggedByName: "Ben Cruz" }),
        task({ taskDescription: "Other", paymentVoucher: "PV-2026-001" }),
        task({ taskDescription: "Unrelated" }),
      ]

      expect(filter(tasks, { searchTerm: "switch" }).filteredTasks).toHaveLength(1)
      expect(filter(tasks, { searchTerm: "network" }).filteredTasks).toHaveLength(1)
      expect(filter(tasks, { searchTerm: "FIN" }).filteredTasks).toHaveLength(1)
      expect(filter(tasks, { searchTerm: "cruz" }).filteredTasks).toHaveLength(1)
      expect(filter(tasks, { searchTerm: "PV-2026" }).filteredTasks).toHaveLength(1)
    })

    it("ignores case", () => {
      const tasks = [task({ taskDescription: "Replace the SWITCH" })]

      expect(filter(tasks, { searchTerm: "switch" }).filteredTasks).toHaveLength(1)
    })

    it("shows everything for an empty search", () => {
      expect(filter([task(), task()], { searchTerm: "" }).filteredTasks).toHaveLength(2)
    })

    it("does not crash on a task with missing text fields", () => {
      const tasks = [task({ taskDescription: null, categoryId: null, loggedByName: null })]

      expect(() => filter(tasks, { searchTerm: "x" })).not.toThrow()
    })
  })

  describe("status", () => {
    const byStatus = [
      task({ status: "INCOMPLETE" }),
      task({ status: "AWAITING APPROVAL" }),
      task({ status: "COMPLETED", hrVerified: false }),
      task({ status: "COMPLETED", hrVerified: true }),
      task({ status: "NOT APPROVED" }),
    ]

    it("shows everything on ALL", () => {
      expect(filter(byStatus, { statusFilter: "ALL" }).filteredTasks).toHaveLength(5)
    })

    it("narrows to a single status", () => {
      expect(filter(byStatus, { statusFilter: "INCOMPLETE" }).filteredTasks).toHaveLength(1)
      expect(filter(byStatus, { statusFilter: "AWAITING APPROVAL" }).filteredTasks).toHaveLength(1)
      expect(filter(byStatus, { statusFilter: "NOT APPROVED" }).filteredTasks).toHaveLength(1)
    })

    it("counts both verified and unverified as complete", () => {
      expect(filter(byStatus, { statusFilter: "COMPLETED" }).filteredTasks).toHaveLength(2)
    })

    it("separates complete-but-unverified from complete-and-verified", () => {
      const unverified = filter(byStatus, { statusFilter: "COMPLETE_UNVERIFIED" }).filteredTasks
      const verified = filter(byStatus, { statusFilter: "COMPLETE_VERIFIED" }).filteredTasks

      expect(unverified).toHaveLength(1)
      expect(unverified[0].hrVerified).toBe(false)
      expect(verified).toHaveLength(1)
      expect(verified[0].hrVerified).toBe(true)
    })

    describe("the delayed filter", () => {
      it("shows pending work older than 48 hours", () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-03-10T00:00:00Z"))
        const tasks = [
          task({ status: "INCOMPLETE", createdAt: "2026-03-01T00:00:00Z" }),
          task({ status: "AWAITING APPROVAL", createdAt: "2026-03-01T00:00:00Z" }),
          task({ status: "INCOMPLETE", createdAt: "2026-03-09T18:00:00Z" }),
        ]

        expect(filter(tasks, { statusFilter: "DELAYED" }).filteredTasks).toHaveLength(2)
      })

      it("never calls finished work delayed", () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-03-10T00:00:00Z"))
        const tasks = [
          task({ status: "COMPLETED", createdAt: "2026-01-01T00:00:00Z" }),
          task({ status: "NOT APPROVED", createdAt: "2026-01-01T00:00:00Z" }),
        ]

        expect(filter(tasks, { statusFilter: "DELAYED" }).filteredTasks).toEqual([])
      })

      it("excludes a task with no creation date rather than guessing", () => {
        const tasks = [task({ status: "INCOMPLETE", createdAt: null })]

        expect(filter(tasks, { statusFilter: "DELAYED" }).filteredTasks).toEqual([])
      })
    })
  })

  describe("priority and HR state", () => {
    it("narrows by priority", () => {
      const tasks = [task({ priority: "HIGH" }), task({ priority: "LOW" })]

      expect(filter(tasks, { priorityFilter: "HIGH" }).filteredTasks).toHaveLength(1)
    })

    it("shows only verified work on the verified filter", () => {
      const tasks = [
        task({ status: "COMPLETED", hrVerified: true }),
        task({ status: "COMPLETED", hrVerified: false }),
      ]

      expect(filter(tasks, { hrFilter: "VERIFIED" }).filteredTasks).toHaveLength(1)
    })

    it("shows only work waiting on HR on the pending filter", () => {
      const tasks = [
        task({ status: "COMPLETED", hrVerified: false }),
        task({ status: "COMPLETED", hrVerified: true }),
        task({ status: "INCOMPLETE", hrVerified: false }),
      ]

      const pending = filter(tasks, { hrFilter: "PENDING" }).filteredTasks

      expect(pending).toHaveLength(1)
      expect(pending[0].status).toBe("COMPLETED")
    })
  })

  describe("date filters", () => {
    it("matches a task logged on the chosen day, in the user's own timezone", () => {
      // 10:00 on 5 March in Manila is still 4 March in UTC. The picker offers a
      // local date, so the task has to be found under the local day.
      const tasks = [task({ createdAt: "2026-03-05T02:00:00Z" })]

      const found = filter(tasks, {
        timeframe: "DAILY",
        selectedDateFilter: "2026-03-05",
      }).filteredTasks

      expect(found).toHaveLength(1)
    })

    it("finds a task logged early in the morning, before UTC has rolled over", () => {
      // 07:00 on 5 March in Manila is 4 March 23:00 UTC. Anyone starting work
      // before 08:00 would otherwise drop out of their own daily view.
      const tasks = [task({ createdAt: "2026-03-04T23:00:00Z" })]

      const found = filter(tasks, {
        timeframe: "DAILY",
        selectedDateFilter: "2026-03-05",
      }).filteredTasks

      expect(found).toHaveLength(1)
    })

    it("excludes a task logged on a different day", () => {
      const tasks = [task({ createdAt: "2026-03-06T05:00:00Z" })]

      expect(
        filter(tasks, { timeframe: "DAILY", selectedDateFilter: "2026-03-05" }).filteredTasks,
      ).toEqual([])
    })

    it("matches a whole month", () => {
      const tasks = [
        task({ createdAt: "2026-03-05T02:00:00Z" }),
        task({ createdAt: "2026-04-05T02:00:00Z" }),
      ]

      expect(
        filter(tasks, { timeframe: "MONTHLY", selectedDateFilter: "2026-03" }).filteredTasks,
      ).toHaveLength(1)
    })

    it("keeps a task logged early on the first of the month inside that month", () => {
      // 01:00 on 1 March in Manila is still 28 February in UTC.
      const tasks = [task({ createdAt: "2026-02-28T17:00:00Z" })]

      expect(
        filter(tasks, { timeframe: "MONTHLY", selectedDateFilter: "2026-03" }).filteredTasks,
      ).toHaveLength(1)
    })

    it("matches a whole year", () => {
      const tasks = [
        task({ createdAt: "2026-03-05T02:00:00Z" }),
        task({ createdAt: "2025-03-05T02:00:00Z" }),
      ]

      expect(
        filter(tasks, { timeframe: "YEARLY", selectedDateFilter: "2026" }).filteredTasks,
      ).toHaveLength(1)
    })

    it("matches the Monday-to-Sunday week containing the chosen day", () => {
      // 2026-03-05 is a Thursday; its week runs Mon 2nd to Sun 8th.
      const tasks = [
        task({ createdAt: "2026-03-02T04:00:00Z" }),
        task({ createdAt: "2026-03-08T04:00:00Z" }),
        task({ createdAt: "2026-03-09T04:00:00Z" }),
        task({ createdAt: "2026-03-01T04:00:00Z" }),
      ]

      expect(
        filter(tasks, { timeframe: "WEEKLY", selectedDateFilter: "2026-03-05" }).filteredTasks,
      ).toHaveLength(2)
    })

    it("shows everything when no date is chosen", () => {
      const tasks = [task({ createdAt: "2020-01-01T00:00:00Z" }), task()]

      expect(filter(tasks, { timeframe: "DAILY", selectedDateFilter: "" }).filteredTasks)
        .toHaveLength(2)
    })
  })

  describe("management hierarchy filters", () => {
    const allEmployees = [
      { id: "emp-1", department: "IT", subDepartment: "Infra" },
      { id: "emp-2", department: "SALES", subDepartment: null },
    ]

    it("narrows to one employee", () => {
      const tasks = [task({ loggedById: "emp-1" }), task({ loggedById: "emp-2" })]

      const mine = filter(
        tasks,
        { employeeFilter: "emp-2" },
        { isManagement: true, allEmployees },
      ).filteredTasks

      expect(mine).toHaveLength(1)
      expect(mine[0].loggedById).toBe("emp-2")
    })

    it("applies the employee filter before the directory has loaded", () => {
      // Otherwise the list is briefly empty on every page load.
      const tasks = [task({ loggedById: "emp-1" }), task({ loggedById: "emp-2" })]

      const mine = filter(
        tasks,
        { employeeFilter: "emp-1" },
        { isManagement: true, allEmployees: [] },
      ).filteredTasks

      expect(mine).toHaveLength(1)
    })

    it("narrows by department and sub-department", () => {
      const tasks = [task({ loggedById: "emp-1" }), task({ loggedById: "emp-2" })]

      expect(
        filter(tasks, { deptFilter: "IT" }, { isManagement: true, allEmployees }).filteredTasks,
      ).toHaveLength(1)
      expect(
        filter(tasks, { subDeptFilter: "Infra" }, { isManagement: true, allEmployees })
          .filteredTasks,
      ).toHaveLength(1)
    })

    it("shows every task while the directory is still loading", () => {
      const tasks = [task({ loggedById: "emp-1" }), task({ loggedById: "emp-2" })]

      expect(
        filter(tasks, { deptFilter: "IT" }, { isManagement: true, allEmployees: [] })
          .filteredTasks,
      ).toHaveLength(2)
    })

    it("ignores the hierarchy filters for a non-management viewer", () => {
      const tasks = [task({ loggedById: "emp-1" }), task({ loggedById: "emp-2" })]

      expect(
        filter(tasks, { deptFilter: "IT", employeeFilter: "emp-1" }, { isManagement: false })
          .filteredTasks,
      ).toHaveLength(2)
    })

    it("narrows to the head a task was reported to, for anyone", () => {
      const tasks = [task({ reportedTo: "head-1" }), task({ reportedTo: "head-2" })]

      expect(filter(tasks, { reportedToFilter: "head-1" }).filteredTasks).toHaveLength(1)
    })

    it("combines the CRM filter with the team (department) filter", () => {
      const tasks = [
        task({ loggedById: "emp-1", opportunityId: "sor-1" }),
        task({ loggedById: "emp-1", opportunityId: null }),
        task({ loggedById: "emp-2", opportunityId: "sor-2" }),
      ]

      const found = filter(
        tasks,
        { crmOnly: true, deptFilter: "IT" },
        { isManagement: true, allEmployees },
      ).filteredTasks

      expect(found).toHaveLength(1)
      expect(found[0].opportunityId).toBe("sor-1")
    })
  })

  describe("crm filter", () => {
    it("shows only tasks linked to an SOR", () => {
      const tasks = [
        task({ opportunityId: "sor-1" }),
        task({ opportunityId: null }),
      ]

      expect(filter(tasks, { crmOnly: true }).filteredTasks).toHaveLength(1)
    })

    it("shows everything when off", () => {
      const tasks = [task({ opportunityId: "sor-1" }), task({ opportunityId: null })]

      expect(filter(tasks, { crmOnly: false }).filteredTasks).toHaveLength(2)
    })
  })

  describe("sorting", () => {
    it("puts open work above finished work", () => {
      const tasks = [
        task({ taskDescription: "Not approved", status: "NOT APPROVED" }),
        task({ taskDescription: "Complete", status: "COMPLETED" }),
        task({ taskDescription: "Awaiting", status: "AWAITING APPROVAL" }),
        task({ taskDescription: "Incomplete", status: "INCOMPLETE" }),
      ]

      const { filteredTasks } = filter(tasks)

      expect(filteredTasks.map((t) => t.taskDescription)).toEqual([
        "Incomplete",
        "Awaiting",
        "Complete",
        "Not approved",
      ])
    })

    it("puts higher priority first within a status", () => {
      const tasks = [
        task({ taskDescription: "Low", priority: "LOW" }),
        task({ taskDescription: "High", priority: "HIGH" }),
        task({ taskDescription: "Medium", priority: "MEDIUM" }),
      ]

      expect(filter(tasks).filteredTasks.map((t) => t.taskDescription)).toEqual([
        "High",
        "Medium",
        "Low",
      ])
    })

    it("breaks a tie with the newest task first by default", () => {
      const tasks = [
        task({ taskDescription: "Older", createdAt: "2026-03-01T00:00:00Z" }),
        task({ taskDescription: "Newer", createdAt: "2026-03-05T00:00:00Z" }),
      ]

      expect(filter(tasks).filteredTasks.map((t) => t.taskDescription)).toEqual([
        "Newer",
        "Older",
      ])
    })

    it("reverses the tiebreaker on OLDEST", () => {
      const tasks = [
        task({ taskDescription: "Older", createdAt: "2026-03-01T00:00:00Z" }),
        task({ taskDescription: "Newer", createdAt: "2026-03-05T00:00:00Z" }),
      ]

      expect(filter(tasks, { sortBy: "OLDEST" }).filteredTasks.map((t) => t.taskDescription))
        .toEqual(["Older", "Newer"])
    })

    it("groups by person when sorting by name, above status", () => {
      const tasks = [
        task({ loggedByName: "Zoe", status: "INCOMPLETE" }),
        task({ loggedByName: "Ana", status: "COMPLETED" }),
      ]

      expect(filter(tasks, { sortBy: "NAME" }).filteredTasks.map((t) => t.loggedByName)).toEqual([
        "Ana",
        "Zoe",
      ])
    })
  })

  describe("the per-employee summary", () => {
    it("stays empty until one employee is selected", () => {
      expect(filter([task()], { employeeFilter: "ALL" }).employeeStats).toBeNull()
    })

    it("reports the completion rate, average grade and HR backlog", () => {
      const tasks = [
        task({ loggedById: "emp-1", status: "COMPLETED", hrVerified: true, grade: 4 }),
        task({ loggedById: "emp-1", status: "COMPLETED", hrVerified: false, grade: 5 }),
        task({ loggedById: "emp-1", status: "INCOMPLETE", grade: 0 }),
        task({ loggedById: "emp-1", status: "INCOMPLETE", grade: 0 }),
      ]

      const { employeeStats } = filter(
        tasks,
        { employeeFilter: "emp-1" },
        { isManagement: true, allEmployees: [{ id: "emp-1", department: "IT" }] },
      )

      expect(employeeStats).toEqual({
        total: 4,
        completionRate: 50,
        avgGrade: "4.5",
        pendingHr: 1,
      })
    })

    it("reports no average when nothing has been graded", () => {
      const tasks = [task({ loggedById: "emp-1", status: "INCOMPLETE", grade: 0 })]

      const { employeeStats } = filter(
        tasks,
        { employeeFilter: "emp-1" },
        { isManagement: true, allEmployees: [{ id: "emp-1" }] },
      )

      expect(employeeStats.avgGrade).toBe("N/A")
    })

    it("stays empty when the selected employee has nothing matching", () => {
      const { employeeStats } = filter(
        [task({ loggedById: "emp-2" })],
        { employeeFilter: "emp-1" },
        { isManagement: true, allEmployees: [{ id: "emp-1" }] },
      )

      expect(employeeStats).toBeNull()
    })
  })
})
