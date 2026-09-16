import { describe, it, expect } from "vitest"
import { navigate, sectionSizes, positionLabel, SECTIONS } from "./presentationDeck"

// Driven from a keyboard in front of an audience, so the failure that matters
// is losing your place: an arrow that dead-ends, or a wrap that jumps back to
// the start mid-sentence. Left and right run the whole deck end to end; up and
// down jump between sections. Nothing wraps around the ends.

const sizes = [12, 1, 4, 5]

describe("navigate", () => {
  describe("ArrowRight", () => {
    it("advances within a section", () => {
      expect(navigate({ section: 0, item: 0 }, "ArrowRight", sizes)).toEqual({
        section: 0,
        item: 1,
      })
    })

    it("rolls into the next section at the end of one", () => {
      expect(navigate({ section: 0, item: 11 }, "ArrowRight", sizes)).toEqual({
        section: 1,
        item: 0,
      })
    })

    it("stops at the last item of the last section", () => {
      const end = { section: 3, item: 4 }
      expect(navigate(end, "ArrowRight", sizes)).toEqual(end)
    })
  })

  describe("ArrowLeft", () => {
    it("steps back within a section", () => {
      expect(navigate({ section: 0, item: 1 }, "ArrowLeft", sizes)).toEqual({
        section: 0,
        item: 0,
      })
    })

    it("lands on the last item of the previous section, not its first", () => {
      expect(navigate({ section: 1, item: 0 }, "ArrowLeft", sizes)).toEqual({
        section: 0,
        item: 11,
      })
    })

    it("stops at the very beginning", () => {
      const start = { section: 0, item: 0 }
      expect(navigate(start, "ArrowLeft", sizes)).toEqual(start)
    })
  })

  describe("ArrowDown and ArrowUp", () => {
    it("jumps to the start of the next section from anywhere inside one", () => {
      expect(navigate({ section: 0, item: 5 }, "ArrowDown", sizes)).toEqual({
        section: 1,
        item: 0,
      })
    })

    it("jumps to the start of the previous section", () => {
      expect(navigate({ section: 2, item: 3 }, "ArrowUp", sizes)).toEqual({
        section: 1,
        item: 0,
      })
    })

    it("does not fall off either end", () => {
      expect(navigate({ section: 3, item: 2 }, "ArrowDown", sizes)).toEqual({
        section: 3,
        item: 2,
      })
      expect(navigate({ section: 0, item: 4 }, "ArrowUp", sizes)).toEqual({
        section: 0,
        item: 4,
      })
    })
  })

  it("ignores a key it does not handle", () => {
    const pos = { section: 1, item: 0 }
    expect(navigate(pos, "Enter", sizes)).toBe(pos)
  })

  it("survives a section that is empty", () => {
    expect(navigate({ section: 0, item: 0 }, "ArrowRight", [1, 0, 2])).toEqual({
      section: 2,
      item: 0,
    })
  })
})

describe("sectionSizes", () => {
  it("counts what each section actually renders", () => {
    const data = {
      headline: [{ id: "a" }, { id: "b" }],
      underTheHood: { items: [{ title: "x" }] },
      roadmap: { phases: [{ name: "p" }, { name: "q" }] },
      prototypes: [{ id: "one" }],
    }
    // Under the hood is one card however many fixes it lists.
    expect(sectionSizes(data)).toEqual([2, 1, 2, 1])
  })

  it("counts no under-the-hood card when nothing was generated for it", () => {
    expect(sectionSizes({ underTheHood: { items: [] } })).toEqual([0, 0, 0, 0])
  })

  it("does not crash on a deck with nothing in it", () => {
    expect(sectionSizes({})).toEqual([0, 0, 0, 0])
  })
})

describe("positionLabel", () => {
  it("reads as position within the named section", () => {
    expect(positionLabel({ section: 0, item: 2 }, sizes)).toBe(
      `3 / 12 · ${SECTIONS[0].label}`,
    )
  })

  it("names the section even when it holds a single card", () => {
    expect(positionLabel({ section: 1, item: 0 }, sizes)).toBe(
      `1 / 1 · ${SECTIONS[1].label}`,
    )
  })
})
