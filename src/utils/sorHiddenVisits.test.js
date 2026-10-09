import { describe, expect, it } from "vitest"
import { hiddenVisits, withHiddenVisits } from "./sorHiddenVisits"

const visit = (id, sequence, enteredAt, stageName) => ({ id, sequence, entered_at: enteredAt, flow_stages: { name: stageName } })

describe("hiddenVisits", () => {
  const visits = [
    visit("v1", 1, "2026-10-01T00:00:00Z", "Lead"),
    visit("v2", 2, "2026-10-02T00:00:00Z", "Costing"),
    visit("v3", 3, "2026-10-03T00:00:00Z", "Quotation"),
  ]

  it("lists every visit the viewer cannot read, oldest first", () => {
    expect(hiddenVisits(visits, ["v2"], "participant").map((v) => v.id)).toEqual(["v1", "v3"])
  })

  it("says a full-access viewer's hidden visit is restricted, anyone else's is not shared", () => {
    expect(hiddenVisits(visits, ["v1", "v3"], "full")).toEqual([
      { id: "v2", stageName: "Costing", enteredAt: "2026-10-02T00:00:00Z", reason: "restricted" },
    ])
    expect(hiddenVisits(visits, ["v1", "v3"], "participant")[0].reason).toBe("not_shared")
  })

  it("hides nothing when every visit is readable, or the SOR has none", () => {
    expect(hiddenVisits(visits, ["v1", "v2", "v3"], "full")).toEqual([])
    expect(hiddenVisits([], [], "participant")).toEqual([])
  })
})

describe("withHiddenVisits", () => {
  it("places each hidden visit among the notes by when it was entered", () => {
    const notes = [
      { id: "n1", created_at: "2026-10-01T05:00:00Z" },
      { id: "n2", created_at: "2026-10-03T05:00:00Z" },
    ]
    const hidden = [{ id: "v2", stageName: "Costing", enteredAt: "2026-10-02T00:00:00Z", reason: "not_shared" }]
    expect(withHiddenVisits(notes, hidden).map((i) => (i.kind === "note" ? i.note.id : i.visit.id))).toEqual([
      "n1",
      "v2",
      "n2",
    ])
  })

  it("returns the notes alone when nothing is hidden", () => {
    const notes = [{ id: "n1", created_at: "2026-10-01T05:00:00Z" }]
    expect(withHiddenVisits(notes, [])).toEqual([{ kind: "note", note: notes[0] }])
  })
})
