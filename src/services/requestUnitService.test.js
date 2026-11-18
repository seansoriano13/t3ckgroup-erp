import { describe, expect, it } from "vitest"
import { requestUnitService } from "./requestUnitService"
import { db } from "@/test/db/store"

/**
 * The Unit dropdown of a Purchasing Request is a list the business edits. The service keeps it tidy (no
 * empty names, no two units that differ only by case, new ones go last) and never deletes.
 */
const seedUnits = () =>
  db.seed("request_units", [
    { label: "unit", sort: 10, active: true },
    { label: "pc", sort: 20, active: true },
    { label: "box", sort: 30, active: false },
  ])

describe("requestUnitService", () => {
  it("lists the units in display order, switched-off ones included", async () => {
    db.seed("request_units", [
      { label: "box", sort: 30, active: false },
      { label: "unit", sort: 10, active: true },
      { label: "pc", sort: 20, active: true },
    ])

    const units = await requestUnitService.list()

    expect(units.map((u) => u.label)).toEqual(["unit", "pc", "box"])
  })

  it("adds a unit at the end of the list, switched on", async () => {
    seedUnits()

    const added = await requestUnitService.add("  carton ")

    expect(added).toMatchObject({ label: "carton", sort: 40, active: true })
    expect((await requestUnitService.list()).map((u) => u.label)).toEqual(["unit", "pc", "box", "carton"])
  })

  it("refuses an empty name", async () => {
    seedUnits()
    await expect(requestUnitService.add("   ")).rejects.toThrow("Type the unit's name.")
  })

  it("refuses a unit that is already there, ignoring case and spaces", async () => {
    seedUnits()
    await expect(requestUnitService.add(" PC ")).rejects.toThrow('"pc" is already on the list.')
  })

  it("renames a unit, and refuses a name another unit has", async () => {
    seedUnits()
    const [unit, pc] = await requestUnitService.list()

    await requestUnitService.rename(unit.id, "each")
    await expect(requestUnitService.rename(pc.id, "EACH")).rejects.toThrow('"each" is already on the list.')

    expect((await requestUnitService.list()).map((u) => u.label)).toEqual(["each", "pc", "box"])
  })

  it("lets a unit keep its own name when it is renamed to the same word in another case", async () => {
    seedUnits()
    const [unit] = await requestUnitService.list()

    await requestUnitService.rename(unit.id, "Unit")

    expect((await requestUnitService.list())[0].label).toBe("Unit")
  })

  it("switches a unit off and on without deleting it", async () => {
    seedUnits()
    const [unit] = await requestUnitService.list()

    expect((await requestUnitService.setActive(unit.id, false)).active).toBe(false)
    expect((await requestUnitService.list()).map((u) => u.label)).toContain("unit")
    expect((await requestUnitService.setActive(unit.id, true)).active).toBe(true)
  })

  it("puts the units in the order given, and keeps any not named after them", async () => {
    seedUnits()
    const [unit, pc, box] = await requestUnitService.list()

    await requestUnitService.reorder([box.id, pc.id])

    const after = await requestUnitService.list()
    expect(after.map((u) => u.label)).toEqual(["box", "pc", "unit"])
    expect(after.map((u) => u.sort)).toEqual([10, 20, 30])
    expect(after.find((u) => u.id === unit.id)).toBeTruthy()
  })
})
