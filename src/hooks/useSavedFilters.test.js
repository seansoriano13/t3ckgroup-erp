import { renderHook, act } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { useSavedFilters } from "./useSavedFilters"

/**
 * "Save my current filters as my default for this page" (issue #205), the
 * same localStorage mechanism the sidebar uses for its remembered accordion
 * state (ADR 0001) — per-user, per-page, read once and written only on an
 * explicit save or clear.
 */
describe("useSavedFilters", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("starts from the page's own defaults when nothing is saved", () => {
    const { result } = renderHook(() => useSavedFilters("tasks", "user-1", { crmOnly: false }))

    expect(result.current.initial).toEqual({ crmOnly: false })
    expect(result.current.hasSavedDefault).toBe(false)
  })

  it("saves the current filters as the default", () => {
    const { result } = renderHook(() => useSavedFilters("tasks", "user-1", { crmOnly: false }))

    act(() => result.current.saveDefault({ crmOnly: true }))

    expect(result.current.hasSavedDefault).toBe(true)
    expect(JSON.parse(localStorage.getItem("erp_saved_filters_tasks_user-1"))).toEqual({
      crmOnly: true,
    })
  })

  it("reads back a saved default merged over the page defaults on next mount", () => {
    localStorage.setItem("erp_saved_filters_tasks_user-1", JSON.stringify({ crmOnly: true }))

    const { result } = renderHook(() =>
      useSavedFilters("tasks", "user-1", { crmOnly: false, statusFilter: "ALL" }),
    )

    expect(result.current.initial).toEqual({ crmOnly: true, statusFilter: "ALL" })
    expect(result.current.hasSavedDefault).toBe(true)
  })

  it("clears a saved default back to the page's own default", () => {
    localStorage.setItem("erp_saved_filters_tasks_user-1", JSON.stringify({ crmOnly: true }))
    const { result } = renderHook(() => useSavedFilters("tasks", "user-1", { crmOnly: false }))

    act(() => result.current.clearDefault())

    expect(result.current.hasSavedDefault).toBe(false)
    expect(localStorage.getItem("erp_saved_filters_tasks_user-1")).toBeNull()
  })

  it("keeps different users' saved defaults separate", () => {
    localStorage.setItem("erp_saved_filters_tasks_user-1", JSON.stringify({ crmOnly: true }))

    const { result } = renderHook(() => useSavedFilters("tasks", "user-2", { crmOnly: false }))

    expect(result.current.initial).toEqual({ crmOnly: false })
    expect(result.current.hasSavedDefault).toBe(false)
  })

  it("falls back to the page default for a filter missing from, or null in, the saved default", () => {
    localStorage.setItem("erp_saved_filters_tasks_user-1", JSON.stringify({ crmOnly: true, deptFilter: null }))

    const { result } = renderHook(() =>
      useSavedFilters("tasks", "user-1", { crmOnly: false, deptFilter: "IT", statusFilter: "ALL" }),
    )

    expect(result.current.initial).toEqual({ crmOnly: true, deptFilter: "IT", statusFilter: "ALL" })
    expect(result.current.isDirty({ crmOnly: true, deptFilter: "IT", statusFilter: "ALL" })).toBe(false)
  })

  it("calls the filters changed only when they differ from the saved default", () => {
    const { result } = renderHook(() => useSavedFilters("tasks", "user-1", { crmOnly: false, tags: [] }))
    expect(result.current.isDirty({ crmOnly: true, tags: [] })).toBe(false)

    act(() => result.current.saveDefault({ crmOnly: true, tags: ["a"] }))

    expect(result.current.isDirty({ crmOnly: true, tags: ["a"] })).toBe(false)
    expect(result.current.isDirty({ crmOnly: false, tags: ["a"] })).toBe(true)
    expect(result.current.isDirty({ crmOnly: true, tags: ["a", "b"] })).toBe(true)
  })
})
