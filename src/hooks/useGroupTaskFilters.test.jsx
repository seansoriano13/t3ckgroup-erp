import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useGroupTaskFilters } from "./useGroupTaskFilters"

/**
 * Filtering for the group board. Group tasks join in their creator and
 * their members, so the search has to reach across those relationships — a head
 * looking for "Alice" wants the tasks Alice is on, not just the ones she named.
 */
const groupTask = (overrides = {}) => ({
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
  renderHook(() => useGroupTaskFilters(tasks, filters)).result.current

describe("useGroupTaskFilters", () => {
  describe("status", () => {
    it("shows everything by default", () => {
      const tasks = [groupTask({ status: "ACTIVE" }), groupTask({ status: "COMPLETED" })]

      expect(filter(tasks).filteredTasks).toHaveLength(2)
    })

    it("narrows to active work", () => {
      const tasks = [groupTask({ status: "ACTIVE" }), groupTask({ status: "COMPLETED" })]

      expect(filter(tasks, { statusFilter: "ACTIVE" }).filteredTasks).toHaveLength(1)
    })

    it("treats every non-active state as finished", () => {
      const tasks = [
        groupTask({ status: "ACTIVE" }),
        groupTask({ status: "COMPLETED" }),
        groupTask({ status: "HR_PENDING" }),
      ]

      expect(filter(tasks, { statusFilter: "COMPLETED" }).filteredTasks).toHaveLength(2)
    })
  })

  describe("search", () => {
    it("matches the title", () => {
      const tasks = [groupTask({ title: "Year-end inventory" }), groupTask({ title: "Fire drill" })]

      expect(filter(tasks, { searchTerm: "inventory" }).filteredTasks).toHaveLength(1)
    })

    it("matches the description", () => {
      const tasks = [
        groupTask({ description: "Count everything in the warehouse" }),
        groupTask({ description: "Something else" }),
      ]

      expect(filter(tasks, { searchTerm: "warehouse" }).filteredTasks).toHaveLength(1)
    })

    it("matches the creator's name", () => {
      const tasks = [
        groupTask({ creator: { name: "Head Ito" } }),
        groupTask({ creator: { name: "Other Head" } }),
      ]

      expect(filter(tasks, { searchTerm: "ito" }).filteredTasks).toHaveLength(1)
    })

    it("matches a member's name", () => {
      const tasks = [
        groupTask({ members: [{ employee: { name: "Alice Santos" } }] }),
        groupTask({ members: [{ employee: { name: "Bob Cruz" } }] }),
      ]

      expect(filter(tasks, { searchTerm: "alice" }).filteredTasks).toHaveLength(1)
    })

    it("ignores case", () => {
      const tasks = [groupTask({ title: "Year-End INVENTORY" })]

      expect(filter(tasks, { searchTerm: "inventory" }).filteredTasks).toHaveLength(1)
    })

    it("copes with a task that has no description or members", () => {
      const tasks = [groupTask({ description: null, members: [] })]

      expect(() => filter(tasks, { searchTerm: "anything" })).not.toThrow()
    })
  })

  describe("creator", () => {
    it("narrows to one creator", () => {
      const tasks = [
        groupTask({ created_by: "head-1" }),
        groupTask({ created_by: "head-2" }),
      ]

      expect(filter(tasks, { creatorFilter: "head-2" }).filteredTasks).toHaveLength(1)
    })

    it("lists each distinct creator once, for the dropdown", () => {
      const tasks = [
        groupTask({ created_by: "head-1", creator: { name: "Head Ito" } }),
        groupTask({ created_by: "head-1", creator: { name: "Head Ito" } }),
        groupTask({ created_by: "head-2", creator: { name: "Other Head" } }),
      ]

      expect(filter(tasks).uniqueCreators).toEqual([
        { id: "head-1", name: "Head Ito" },
        { id: "head-2", name: "Other Head" },
      ])
    })

    it("skips a task whose creator was not joined in", () => {
      const tasks = [groupTask({ created_by: "head-1", creator: null })]

      expect(filter(tasks).uniqueCreators).toEqual([])
    })
  })

  describe("due date", () => {
    it("matches tasks due on the chosen calendar day", () => {
      // Both sides are compared as local calendar days: 2026-04-30T16:00Z is
      // midnight on 1 May in Manila, and the chosen "2026-05-01" parses to
      // 08:00 on 1 May local — the same day.
      const tasks = [
        groupTask({ title: "Due 1 May", due_date: "2026-04-30T16:00:00Z" }),
        groupTask({ title: "Due 2 May", due_date: "2026-05-01T16:00:00Z" }),
      ]

      const found = filter(tasks, { dueDate: "2026-05-01" }).filteredTasks

      expect(found.map((t) => t.title)).toEqual(["Due 1 May"])
    })

    it("excludes a task with no due date once a date is chosen", () => {
      const tasks = [groupTask({ due_date: null })]

      expect(filter(tasks, { dueDate: "2026-05-01" }).filteredTasks).toEqual([])
    })

    it("shows everything when no date is chosen", () => {
      const tasks = [groupTask({ due_date: null }), groupTask({ due_date: "2026-04-30" })]

      expect(filter(tasks, { dueDate: null }).filteredTasks).toHaveLength(2)
    })
  })

  it("applies every active filter together", () => {
    const tasks = [
      groupTask({ title: "Inventory", status: "ACTIVE", created_by: "head-1" }),
      groupTask({ title: "Inventory", status: "COMPLETED", created_by: "head-1" }),
      groupTask({ title: "Fire drill", status: "ACTIVE", created_by: "head-1" }),
      groupTask({ title: "Inventory", status: "ACTIVE", created_by: "head-2" }),
    ]

    const found = filter(tasks, {
      searchTerm: "inventory",
      statusFilter: "ACTIVE",
      creatorFilter: "head-1",
    }).filteredTasks

    expect(found).toHaveLength(1)
  })

  it("crmOnly keeps only tasks linked to an SOR", () => {
    const tasks = [
      groupTask({ title: "Linked", opportunity_id: "sor-1" }),
      groupTask({ title: "Unlinked", opportunity_id: null }),
    ]

    const found = filter(tasks, { crmOnly: true }).filteredTasks
    expect(found.map((t) => t.title)).toEqual(["Linked"])
  })
})
