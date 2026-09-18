import { describe, it, expect } from "vitest"
import { addEntry, todayInManila } from "../../../scripts/lib/changelog.mjs"

// The changelog is the app's version record: `src/data/changelog.json[0].version`
// is what Settings shows and what `last_seen_changelog_version` compares
// against. A malformed or duplicate entry therefore doesn't just look wrong,
// it decides whether every employee is shown a "What's New" modal.

const existing = [
  {
    date: "2026-09-07",
    title: "Retail Orders Queue",
    version: "1.7.0",
    changes: ["Added a Retail Queue tab."],
  },
  {
    date: "2026-09-05",
    title: "Flow Plans",
    version: "1.6.0",
    changes: ["Edit one plan together."],
  },
]

const valid = {
  version: "1.8.0",
  title: "Version in Settings",
  changes: ["Settings now shows which version you are running."],
}

describe("addEntry", () => {
  it("puts the new release first, since the app reads entry zero as current", () => {
    const result = addEntry(existing, { ...valid, date: "2026-09-08" })

    expect(result[0].version).toBe("1.8.0")
    expect(result.slice(1)).toEqual(existing)
  })

  it("writes the four fields the modal renders, in the order the file already uses", () => {
    const result = addEntry(existing, { ...valid, date: "2026-09-08" })

    expect(Object.keys(result[0])).toEqual(["date", "title", "version", "changes"])
    expect(result[0]).toEqual({
      date: "2026-09-08",
      title: "Version in Settings",
      version: "1.8.0",
      changes: ["Settings now shows which version you are running."],
    })
  })

  it("leaves the entries it was given untouched, so a failed write can't half-apply", () => {
    const before = JSON.stringify(existing)

    addEntry(existing, { ...valid, date: "2026-09-08" })

    expect(JSON.stringify(existing)).toBe(before)
  })

  it("dates the entry today in Manila when no date is given", () => {
    const result = addEntry(existing, valid)

    expect(result[0].date).toBe(todayInManila())
  })

  it("refuses a version already in the file, which would strand the modal", () => {
    expect(() => addEntry(existing, { ...valid, version: "1.7.0" })).toThrow(
      /1\.7\.0 is already in the changelog/,
    )
  })

  it("refuses a version that is not three numbers", () => {
    expect(() => addEntry(existing, { ...valid, version: "1.8" })).toThrow(/major\.minor\.patch/)
    expect(() => addEntry(existing, { ...valid, version: "v1.8.0" })).toThrow(/major\.minor\.patch/)
  })

  it("refuses an entry with no title, since the modal headlines with it", () => {
    expect(() => addEntry(existing, { ...valid, title: "  " })).toThrow(/title/)
  })

  it("refuses an entry with nothing to announce", () => {
    expect(() => addEntry(existing, { ...valid, changes: [] })).toThrow(/at least one change/)
    expect(() => addEntry(existing, { ...valid, changes: ["", "  "] })).toThrow(/at least one change/)
  })

  it("drops blank lines from an otherwise real change list", () => {
    const result = addEntry(existing, { ...valid, changes: ["A real change.", "   "] })

    expect(result[0].changes).toEqual(["A real change."])
  })
})

describe("todayInManila", () => {
  it("returns an ISO date, not a timestamp", () => {
    expect(todayInManila()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
