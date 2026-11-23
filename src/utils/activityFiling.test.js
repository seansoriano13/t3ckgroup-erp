import { describe, expect, it } from "vitest"
import { getActivitySettings } from "./activitySettings"
import { canFileActivityType, fileableActivityTypes, formTypeOptions, newActivityLabel } from "./activityFiling"

const ordinary = { id: "e1" }
const head = { id: "h1", is_head: true }

describe("who files each Activity type (#1063)", () => {
  it("lets anyone file a Meeting", () => {
    expect(canFileActivityType(ordinary, "MEETING")).toBe(true)
    expect(canFileActivityType(head, "MEETING")).toBe(true)
  })

  it("lets only a department head file an Admin Task, an Operations Task or an Event", () => {
    for (const type of ["ADMIN_TASK", "OPERATIONS_TASK", "EVENT"]) {
      expect(canFileActivityType(ordinary, type)).toBe(false)
      expect(canFileActivityType(head, type)).toBe(true)
      expect(canFileActivityType({ id: "h2", isHead: true }, type)).toBe(true)
    }
  })

  it("files nothing for nobody, and refuses an unknown type", () => {
    expect(canFileActivityType(null, "MEETING")).toBe(false)
    expect(canFileActivityType(head, "PARTY")).toBe(false)
  })

  it("offers a non-head only Meetings and a head everything", () => {
    expect(fileableActivityTypes(ordinary)).toEqual(["MEETING"])
    expect(fileableActivityTypes(head)).toEqual(["MEETING", "ADMIN_TASK", "OPERATIONS_TASK", "EVENT"])
  })

  it("lets an edit keep an Activity's own type but never offers a type the viewer cannot file", () => {
    expect(formTypeOptions(ordinary, "ADMIN_TASK")).toEqual(["MEETING", "ADMIN_TASK"])
    expect(formTypeOptions(ordinary)).toEqual(["MEETING"])
  })

  it("names the New button after what the viewer may file", () => {
    expect(newActivityLabel(ordinary)).toBe("New Meeting")
    expect(newActivityLabel(head)).toBe("New Activity")
  })

  it("lets a person on the Also allowed list file a heads-only type, and only that type", () => {
    const settings = getActivitySettings()
    const withList = { ...settings, types: { ...settings.types, OPERATIONS_TASK: { ...settings.types.OPERATIONS_TASK, alsoAllowed: ["e1"] } } }
    expect(canFileActivityType(ordinary, "OPERATIONS_TASK", withList)).toBe(true)
    expect(canFileActivityType(ordinary, "ADMIN_TASK", withList)).toBe(false)
    expect(canFileActivityType({ id: "e2" }, "OPERATIONS_TASK", withList)).toBe(false)
    expect(fileableActivityTypes(ordinary, withList)).toEqual(["MEETING", "OPERATIONS_TASK"])
  })
})
