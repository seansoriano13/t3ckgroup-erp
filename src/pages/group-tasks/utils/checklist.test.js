import { describe, expect, it } from "vitest"
import { parseChecklist, countChecklist, hasChecklistContent, resolveAssignment } from "./checklist"

/**
 * Group task assignments carry a description and a checklist in separate
 * columns. Rows created before 0016 still have the checklist serialised inside
 * task_description, so every reader goes through resolveAssignment and has to
 * work on both sides of that backfill — that is what lets the migration and the
 * deploy happen in either order.
 */
describe("resolveAssignment", () => {
  it("reads a post-backfill row, description and checklist side by side", () => {
    const result = resolveAssignment({
      task_description: "Count aisle A",
      checklist: [{ text: "Shelf 1", checked: true }],
    })

    expect(result.description).toBe("Count aisle A")
    expect(result.checklist).toEqual([{ text: "Shelf 1", checked: true }])
  })

  it("reads a pre-backfill row whose checklist is still in task_description", () => {
    const result = resolveAssignment({
      task_description: '[{"text":"Shelf 1","checked":false}]',
      checklist: null,
    })

    // The serialised array is not prose, so it must not surface as description.
    expect(result.description).toBe("")
    expect(result.checklist).toEqual([{ text: "Shelf 1", checked: false }])
  })

  it("reads the legacy {title, items} shape out of task_description", () => {
    const result = resolveAssignment({
      task_description: '{"title":"Aisle A","items":[{"text":"Shelf 1"}]}',
      checklist: null,
    })

    expect(result.description).toBe("")
    expect(result.checklist).toEqual([{ text: "Shelf 1" }])
  })

  it("leaves a plain-text assignment alone", () => {
    const result = resolveAssignment({
      task_description: "Count aisle A",
      checklist: null,
    })

    expect(result.description).toBe("Count aisle A")
    expect(result.checklist).toEqual([])
  })

  it("keeps prose that merely starts with a bracket as prose", () => {
    const result = resolveAssignment({
      task_description: "[URGENT] count aisle A before Friday",
      checklist: null,
    })

    expect(result.description).toBe("[URGENT] count aisle A before Friday")
    expect(result.checklist).toEqual([])
  })

  it("accepts the camelCase shape the create modal uses", () => {
    const result = resolveAssignment({
      taskDescription: "Count aisle A",
      checklist: [{ text: "Shelf 1" }],
    })

    expect(result.description).toBe("Count aisle A")
    expect(result.checklist).toEqual([{ text: "Shelf 1" }])
  })

  it("survives a missing member", () => {
    expect(resolveAssignment(null)).toEqual({ description: "", checklist: [] })
  })
})

describe("parseChecklist", () => {
  it("passes through an array from jsonb", () => {
    expect(parseChecklist([{ text: "a" }])).toEqual([{ text: "a" }])
  })

  it("returns nothing for prose, null, or malformed JSON", () => {
    expect(parseChecklist("just text")).toEqual([])
    expect(parseChecklist(null)).toEqual([])
    expect(parseChecklist("[{broken")).toEqual([])
  })
})

describe("countChecklist", () => {
  it("counts checked against total for the rail's progress badge", () => {
    expect(
      countChecklist([
        { text: "a", checked: true },
        { text: "b", checked: false },
        { text: "c", checked: true },
      ]),
    ).toEqual({ total: 3, checked: 2 })
  })
})

describe("hasChecklistContent", () => {
  it("ignores items that are only whitespace", () => {
    expect(hasChecklistContent([{ text: "   " }, { text: "" }])).toBe(false)
    expect(hasChecklistContent([{ text: "   " }, { text: "real" }])).toBe(true)
  })
})
