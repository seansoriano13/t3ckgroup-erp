import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useCommitteeTaskFilters } from "./useCommitteeTaskFilters"

/**
 * Filtering for the committee board. Committee tasks join in their creator and
 * their members, so the search has to reach across those relationships — a head
 * looking for "Alice" wants the tasks Alice is on, not just the ones she named.
 */
const committeeTask = (overrides = {}) => ({
  id: `ct-${Math.random().toString(36).slice(2)}`,
  title: "Year-end inventory",
  description: "Count everything in the warehouse",
  status: "ACTIVE",
  created_by: "head-1",
  creator: { name: "Head Ito" },
  due_date: null,
  members: [{ employee: { name: "Alice Santos" } }],
  ...overrides,
})

const filter = (tasks, filters = {}) =>
  renderHook(() => useCommitteeTaskFilters(tasks, filters)).result.current

describe("useCommitteeTaskFilters", () => {
  describe("status", () => {
    it("shows everything by default", () => {
      const tasks = [committeeTask({ status: "ACTIVE" }), committeeTask({ status: "COMPLETED" })]

      expect(filter(tasks).filteredTasks).toHaveLength(2)
    })

    it("narrows to active work", () => {
      const tasks = [committeeTask({ status: "ACTIVE" }), committeeTask({ status: "COMPLETED" })]

      expect(filter(tasks, { statusFilter: "ACTIVE" }).filteredTasks).toHaveLength(1)
    })

    it("treats every non-active state as finished", () => {
      const tasks = [
        committeeTask({ status: "ACTIVE" }),
        committeeTask({ status: "COMPLETED" }),
        committeeTask({ status: "HR_PENDING" }),
      ]

      expect(filter(tasks, { statusFilter: "COMPLETED" }).filteredTasks).toHaveLength(2)
    })
  })

  describe("search", () => {
    it("matches the title", () => {
      const tasks = [committeeTask({ title: "Year-end inventory" }), committeeTask({ title: "Fire drill" })]

      expect(filter(tasks, { searchTerm: "inventory" }).filteredTasks).toHaveLength(1)
    })

    it("matches the description", () => {
      const tasks = [
        committeeTask({ description: "Count everything in the warehouse" }),
        committeeTask({ description: "Something else" }),
      ]

      expect(filter(tasks, { searchTerm: "warehouse" }).filteredTasks).toHaveLength(1)
    })

    it("matches the creator's name", () => {
      const tasks = [
        committeeTask({ creator: { name: "Head Ito" } }),
        committeeTask({ creator: { name: "Other Head" } }),
      ]

      expect(filter(tasks, { searchTerm: "ito" }).filteredTasks).toHaveLength(1)
    })

    it("matches a member's name", () => {
      const tasks = [
        committeeTask({ members: [{ employee: { name: "Alice Santos" } }] }),
        committeeTask({ members: [{ employee: { name: "Bob Cruz" } }] }),
      ]

      expect(filter(tasks, { searchTerm: "alice" }).filteredTasks).toHaveLength(1)
    })

    it("ignores case", () => {
      const tasks = [committeeTask({ title: "Year-End INVENTORY" })]

      expect(filter(tasks, { searchTerm: "inventory" }).filteredTasks).toHaveLength(1)
    })

    it("copes with a task that has no description or members", () => {
      const tasks = [committeeTask({ description: null, members: [] })]

      expect(() => filter(tasks, { searchTerm: "anything" })).not.toThrow()
    })
  })

  describe("creator", () => {
    it("narrows to one creator", () => {
      const tasks = [
        committeeTask({ created_by: "head-1" }),
        committeeTask({ created_by: "head-2" }),
      ]

      expect(filter(tasks, { creatorFilter: "head-2" }).filteredTasks).toHaveLength(1)
    })

    it("lists each distinct creator once, for the dropdown", () => {
      const tasks = [
        committeeTask({ created_by: "head-1", creator: { name: "Head Ito" } }),
        committeeTask({ created_by: "head-1", creator: { name: "Head Ito" } }),
        committeeTask({ created_by: "head-2", creator: { name: "Other Head" } }),
      ]

      expect(filter(tasks).uniqueCreators).toEqual([
        { id: "head-1", name: "Head Ito" },
        { id: "head-2", name: "Other Head" },
      ])
    })

    it("skips a task whose creator was not joined in", () => {
      const tasks = [committeeTask({ created_by: "head-1", creator: null })]

      expect(filter(tasks).uniqueCreators).toEqual([])
    })
  })

  describe("due date", () => {
    it("matches tasks due on the chosen calendar day", () => {
      // Both sides are compared as local calendar days: 2026-04-30T16:00Z is
      // midnight on 1 May in Manila, and the chosen "2026-05-01" parses to
      // 08:00 on 1 May local — the same day.
      const tasks = [
        committeeTask({ title: "Due 1 May", due_date: "2026-04-30T16:00:00Z" }),
        committeeTask({ title: "Due 2 May", due_date: "2026-05-01T16:00:00Z" }),
      ]

      const found = filter(tasks, { dueDate: "2026-05-01" }).filteredTasks

      expect(found.map((t) => t.title)).toEqual(["Due 1 May"])
    })

    it("excludes a task with no due date once a date is chosen", () => {
      const tasks = [committeeTask({ due_date: null })]

      expect(filter(tasks, { dueDate: "2026-05-01" }).filteredTasks).toEqual([])
    })

    it("shows everything when no date is chosen", () => {
      const tasks = [committeeTask({ due_date: null }), committeeTask({ due_date: "2026-04-30" })]

      expect(filter(tasks, { dueDate: null }).filteredTasks).toHaveLength(2)
    })
  })

  it("applies every active filter together", () => {
    const tasks = [
      committeeTask({ title: "Inventory", status: "ACTIVE", created_by: "head-1" }),
      committeeTask({ title: "Inventory", status: "COMPLETED", created_by: "head-1" }),
      committeeTask({ title: "Fire drill", status: "ACTIVE", created_by: "head-1" }),
      committeeTask({ title: "Inventory", status: "ACTIVE", created_by: "head-2" }),
    ]

    const found = filter(tasks, {
      searchTerm: "inventory",
      statusFilter: "ACTIVE",
      creatorFilter: "head-1",
    }).filteredTasks

    expect(found).toHaveLength(1)
  })
})
