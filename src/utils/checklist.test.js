import { describe, expect, it } from "vitest"
import {
  parseChecklist,
  countChecklist,
  hasChecklistContent,
  resolveAssignment,
  parseChecklistGroups,
  getChecklistProgress,
  cleanChecklistForSave,
  isGroupedChecklist,
} from "./checklist"

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

  it("checks across all groups in a grouped checklist", () => {
    const grouped = [
      { id: "g1", title: "Step 1", items: [{ text: "   " }] },
      { id: "g2", title: "Step 2", items: [{ text: "Order supplies" }] },
    ]
    expect(hasChecklistContent(grouped)).toBe(true)
  })
})

describe("parseChecklistGroups", () => {
  it("normalises a legacy flat array into a single default group", () => {
    const groups = parseChecklistGroups([{ text: "Task A", checked: true }])
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe("")
    expect(groups[0].items).toHaveLength(1)
    expect(groups[0].items[0].text).toBe("Task A")
    expect(groups[0].items[0].checked).toBe(true)
  })

  it("preserves multiple groups and items", () => {
    const input = [
      { id: "p1", title: "Phase 1", items: [{ id: "i1", text: "A", checked: true }] },
      { id: "p2", title: "Phase 2", items: [{ id: "i2", text: "B", checked: false }] },
    ]
    const groups = parseChecklistGroups(input)
    expect(groups).toHaveLength(2)
    expect(groups[0].title).toBe("Phase 1")
    expect(groups[0].items[0].text).toBe("A")
    expect(groups[1].title).toBe("Phase 2")
    expect(groups[1].items[0].checked).toBe(false)
  })

  it("parses stringified JSON groups", () => {
    const json = JSON.stringify([
      { title: "Prep", items: [{ text: "Item 1", checked: true }] },
    ])
    const groups = parseChecklistGroups(json)
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe("Prep")
    expect(groups[0].items[0].text).toBe("Item 1")
  })
})

describe("parseChecklist with groups", () => {
  it("flattens items from multiple groups into a single array", () => {
    const input = [
      { title: "G1", items: [{ text: "1" }, { text: "2" }] },
      { title: "G2", items: [{ text: "3" }] },
    ]
    expect(parseChecklist(input)).toEqual([
      { text: "1" },
      { text: "2" },
      { text: "3" },
    ])
  })
})

describe("getChecklistProgress", () => {
  it("calculates activeStepIndex and step-level completions", () => {
    const input = [
      {
        id: "g1",
        title: "Step 1",
        items: [{ text: "A", checked: true }, { text: "B", checked: true }],
      },
      {
        id: "g2",
        title: "Step 2",
        items: [{ text: "C", checked: false }],
      },
      {
        id: "g3",
        title: "Step 3",
        items: [{ text: "D", checked: false }],
      },
    ]

    const progress = getChecklistProgress(input)
    expect(progress.total).toBe(4)
    expect(progress.checked).toBe(2)
    expect(progress.isGrouped).toBe(true)
    expect(progress.totalSteps).toBe(3)
    expect(progress.activeStepIndex).toBe(1) // Step 2 is active because Step 1 is complete
    expect(progress.groups[0].isCompleted).toBe(true)
    expect(progress.groups[1].isCompleted).toBe(false)
  })

  it("handles un-grouped flat checklists cleanly", () => {
    const input = [{ text: "A", checked: false }, { text: "B", checked: true }]
    const progress = getChecklistProgress(input)
    expect(progress.total).toBe(2)
    expect(progress.checked).toBe(1)
    expect(progress.isGrouped).toBe(false)
    expect(progress.totalSteps).toBe(1)
    expect(progress.activeStepIndex).toBe(0)
  })
})

describe("cleanChecklistForSave", () => {
  it("flattens a single untitled group back to a flat array for legacy compatibility", () => {
    const input = [
      {
        title: "",
        items: [
          { text: "  Clean kitchen  ", checked: false },
          { text: "   ", checked: false }, // should be stripped
        ],
      },
    ]
    const cleaned = cleanChecklistForSave(input)
    expect(cleaned).toEqual([{ text: "Clean kitchen", checked: false }])
  })

  it("preserves groups when titles or multiple groups exist", () => {
    const input = [
      {
        title: "Phase 1",
        items: [{ text: "Item 1", checked: true }],
      },
      {
        title: "Phase 2",
        items: [{ text: "Item 2", checked: false }],
      },
    ]
    const cleaned = cleanChecklistForSave(input)
    expect(Array.isArray(cleaned)).toBe(true)
    expect(cleaned).toHaveLength(2)
    expect(cleaned[0].title).toBe("Phase 1")
    expect(cleaned[0].items[0].text).toBe("Item 1")
  })

  it("resets checked flags to false when resetChecked is true", () => {
    const input = [
      {
        title: "Phase 1",
        items: [{ text: "Item 1", checked: true }],
      },
    ]
    const cleaned = cleanChecklistForSave(input, { resetChecked: true })
    expect(cleaned[0].items[0].checked).toBe(false)
  })
})

describe("hasChecklistContent", () => {
  it("returns true for grouped checklists with non-empty items", () => {
    const input = [
      {
        title: "Phase 1",
        items: [{ text: "Buy materials", checked: false }],
      },
    ]
    expect(hasChecklistContent(input)).toBe(true)
  })

  it("returns false for grouped checklists with only blank whitespace", () => {
    const input = [
      {
        title: "Phase 1",
        items: [{ text: "   ", checked: false }],
      },
    ]
    expect(hasChecklistContent(input)).toBe(false)
  })

  it("returns true for JSON stringified grouped checklists", () => {
    const input = JSON.stringify([
      {
        title: "Phase 1",
        items: [{ text: "Task 1", checked: false }],
      },
    ])
    expect(hasChecklistContent(input)).toBe(true)
  })

  it("returns false for null or empty checklist", () => {
    expect(hasChecklistContent(null)).toBe(false)
    expect(hasChecklistContent([])).toBe(false)
  })
})

describe("isGroupedChecklist", () => {
  it("returns true when array contains group objects with items arrays", () => {
    expect(isGroupedChecklist([{ title: "P1", items: [] }])).toBe(true)
  })

  it("returns false for flat item arrays or non-arrays", () => {
    expect(isGroupedChecklist([{ text: "A", checked: false }])).toBe(false)
    expect(isGroupedChecklist(null)).toBe(false)
    expect(isGroupedChecklist([])).toBe(false)
  })
})

