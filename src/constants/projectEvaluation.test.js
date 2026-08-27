import { describe, expect, it } from "vitest"
import {
  COMPLETENESS,
  COMPLETENESS_VALUES,
  MIN_CANVASS_OFFERS,
  SOURCING,
  SOURCING_VALUES,
  applyWinner,
  canSetSourcing,
  canvassNeedsMoreOffers,
  completenessForOutcome,
  countsTowardCompleteness,
  isCompleteness,
  isSourcing,
  outstandingInclusions,
  summariseCompleteness,
  winningOffer,
} from "./projectEvaluation"
import { PROCUREMENT_OUTCOME } from "./procurement"

/**
 * Issue #43. What is asserted here is what somebody reads off the screen — how
 * much of the client's spec is answered — never how the arithmetic reached it.
 */

const inclusion = (completeness, overrides = {}) => ({
  description: `Item ${completeness}`,
  quantity: 1,
  completeness,
  sourcing: null,
  ...overrides,
})

describe("completeness states", () => {
  it("recognises exactly the four states the schema stores", () => {
    expect(COMPLETENESS_VALUES).toHaveLength(4)
    COMPLETENESS_VALUES.forEach((v) => expect(isCompleteness(v)).toBe(true))
  })

  it("rejects anything else, including a lowercase spelling of a real one", () => {
    expect(isCompleteness("covered")).toBe(false)
    expect(isCompleteness("PENDING")).toBe(false)
    expect(isCompleteness(null)).toBe(false)
  })

  it("puts the states somebody has to act on first", () => {
    expect(COMPLETENESS_VALUES[0]).toBe(COMPLETENESS.MISSING)
  })
})

describe("sourcing states", () => {
  // The middle case is the point. A boolean is_source_out would fold
  // "we stock it but have none" into one of the two extremes, and that case is
  // most of purchasing's actual work.
  it("keeps stockable-but-empty distinct from source-out", () => {
    expect(SOURCING.STOCKABLE_NEEDS_ORDERING).not.toBe(SOURCING.SOURCE_OUT)
    expect(SOURCING.STOCKABLE_NEEDS_ORDERING).not.toBe(SOURCING.STOCKABLE_AVAILABLE)
    expect(SOURCING_VALUES).toHaveLength(3)
  })

  it("rejects a value outside the three", () => {
    expect(isSourcing("LOCAL")).toBe(false)
    expect(isSourcing(null)).toBe(false)
  })

  it("allows any real value to follow any other, since it is an observation", () => {
    expect(canSetSourcing(SOURCING.SOURCE_OUT, SOURCING.STOCKABLE_AVAILABLE)).toBe(true)
    expect(canSetSourcing(null, SOURCING.SOURCE_OUT)).toBe(true)
  })

  it("allows clearing an assessment back to none", () => {
    expect(canSetSourcing(SOURCING.SOURCE_OUT, null)).toBe(true)
  })

  it("still refuses a value that is not one of the three", () => {
    expect(canSetSourcing(SOURCING.SOURCE_OUT, "IMPORTED")).toBe(false)
  })
})

describe("summariseCompleteness", () => {
  it("reports how much of the spec is answered", () => {
    const summary = summariseCompleteness([
      inclusion(COMPLETENESS.COVERED),
      inclusion(COMPLETENESS.COVERED),
      inclusion(COMPLETENESS.MISSING),
      inclusion(COMPLETENESS.MISSING),
    ])

    expect(summary.covered).toBe(2)
    expect(summary.outstanding).toBe(2)
    expect(summary.percent).toBe(50)
    expect(summary.isComplete).toBe(false)
  })

  // The requirement is met, just not with the thing the client named. The
  // consequence is that sales must re-price, not that the spec has a hole.
  it("counts a substituted item as answered, and says so separately", () => {
    const summary = summariseCompleteness([
      inclusion(COMPLETENESS.COVERED),
      inclusion(COMPLETENESS.SUBSTITUTED),
    ])

    expect(summary.answered).toBe(2)
    expect(summary.substituted).toBe(1)
    expect(summary.outstanding).toBe(0)
    expect(summary.percent).toBe(100)
    expect(summary.isComplete).toBe(true)
  })

  // Counting it as covered instead would let a breakdown reach 100% by
  // dismissing everything in it.
  it("drops a not-required item out of both sides of the fraction", () => {
    const summary = summariseCompleteness([
      inclusion(COMPLETENESS.COVERED),
      inclusion(COMPLETENESS.NOT_REQUIRED),
      inclusion(COMPLETENESS.NOT_REQUIRED),
    ])

    expect(summary.total).toBe(3)
    expect(summary.counted).toBe(1)
    expect(summary.excluded).toBe(2)
    expect(summary.percent).toBe(100)
  })

  // An untouched breakdown has not been assessed. Rendering that as 0% tells a
  // salesperson their spec is failing when nobody has looked at it yet.
  it("has no percentage at all when there is nothing to measure", () => {
    const empty = summariseCompleteness([])
    expect(empty.percent).toBeNull()
    expect(empty.isComplete).toBe(false)
    expect(empty.total).toBe(0)
  })

  it("has no percentage when every listed item turned out not to be required", () => {
    const summary = summariseCompleteness([
      inclusion(COMPLETENESS.NOT_REQUIRED),
      inclusion(COMPLETENESS.NOT_REQUIRED),
    ])

    expect(summary.percent).toBeNull()
    expect(summary.isComplete).toBe(false)
  })

  it("survives being handed nothing at all", () => {
    expect(summariseCompleteness().total).toBe(0)
    expect(summariseCompleteness(null).percent).toBeNull()
  })

  it("does not treat an unrecognised state as answered", () => {
    const summary = summariseCompleteness([
      inclusion(COMPLETENESS.COVERED),
      inclusion("PENDING"),
    ])

    expect(summary.answered).toBe(1)
    expect(summary.outstanding).toBe(1)
  })
})

describe("countsTowardCompleteness", () => {
  it("excludes only the not-required rows", () => {
    expect(countsTowardCompleteness(inclusion(COMPLETENESS.MISSING))).toBe(true)
    expect(countsTowardCompleteness(inclusion(COMPLETENESS.NOT_REQUIRED))).toBe(false)
  })
})

describe("outstandingInclusions", () => {
  it("returns the rows still holding the specification open", () => {
    const rows = [
      inclusion(COMPLETENESS.COVERED, { description: "Stretcher" }),
      inclusion(COMPLETENESS.MISSING, { description: "Oxygen tank" }),
      inclusion(COMPLETENESS.NOT_REQUIRED, { description: "Spare wheel" }),
      inclusion(COMPLETENESS.SUBSTITUTED, { description: "Siren" }),
    ]

    expect(outstandingInclusions(rows).map((r) => r.description)).toEqual([
      "Oxygen tank",
    ])
  })
})

describe("completenessForOutcome", () => {
  it("reads a buy as covering the requirement", () => {
    expect(completenessForOutcome(PROCUREMENT_OUTCOME.PURCHASED)).toBe(COMPLETENESS.COVERED)
    expect(completenessForOutcome(PROCUREMENT_OUTCOME.DELIVERED)).toBe(COMPLETENESS.COVERED)
  })

  // Purchasing found it in Odoo under a different name and bought nothing. The
  // client gets exactly what they asked for, so calling this SUBSTITUTED would
  // send sales off to re-price a line that has not changed.
  it("reads 'already in Odoo' as covered, not substituted", () => {
    expect(completenessForOutcome(PROCUREMENT_OUTCOME.ALREADY_EXISTS)).toBe(
      COMPLETENESS.COVERED,
    )
  })

  it("reads a different product sourced as a substitution", () => {
    expect(completenessForOutcome(PROCUREMENT_OUTCOME.SUBSTITUTED)).toBe(
      COMPLETENESS.SUBSTITUTED,
    )
  })

  it("puts an unsourceable item back on the outstanding list", () => {
    expect(completenessForOutcome(PROCUREMENT_OUTCOME.UNAVAILABLE)).toBe(
      COMPLETENESS.MISSING,
    )
  })

  // Reverting an answer has to un-answer the Inclusion, or a spec keeps
  // reading as satisfied by a request that is an open question again.
  it("un-answers the item when purchasing reverts to in-progress", () => {
    expect(completenessForOutcome(PROCUREMENT_OUTCOME.IN_PROGRESS)).toBe(
      COMPLETENESS.MISSING,
    )
  })

  // 0019 renamed ON_ORDER to PURCHASED. Rows written before it still say
  // ON_ORDER, and skipping them would be wrong on exactly the oldest deals.
  it("still understands the outcome an earlier build wrote", () => {
    expect(completenessForOutcome("ON_ORDER")).toBe(COMPLETENESS.COVERED)
  })

  it("says nothing about an unresolved request", () => {
    expect(completenessForOutcome(null)).toBeNull()
    expect(completenessForOutcome(undefined)).toBeNull()
  })
})

// Issue #46/#47.
describe("canvassNeedsMoreOffers", () => {
  it("warns under the three-offer policy minimum", () => {
    expect(MIN_CANVASS_OFFERS).toBe(3)
    expect(canvassNeedsMoreOffers([])).toBe(true)
    expect(canvassNeedsMoreOffers([{ id: "1" }, { id: "2" }])).toBe(true)
  })

  it("stops warning once the minimum is met, and never blocks past it", () => {
    expect(canvassNeedsMoreOffers([{ id: "1" }, { id: "2" }, { id: "3" }])).toBe(false)
    expect(
      canvassNeedsMoreOffers([{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }]),
    ).toBe(false)
  })

  it("survives being handed nothing at all", () => {
    expect(canvassNeedsMoreOffers()).toBe(true)
    expect(canvassNeedsMoreOffers(null)).toBe(true)
  })
})

describe("winningOffer", () => {
  it("finds the offer marked the winner", () => {
    const offers = [
      { id: "1", is_winner: false },
      { id: "2", is_winner: true },
      { id: "3", is_winner: false },
    ]
    expect(winningOffer(offers)?.id).toBe("2")
  })

  it("returns null when no offer has won yet", () => {
    expect(winningOffer([{ id: "1", is_winner: false }])).toBeNull()
    expect(winningOffer([])).toBeNull()
  })
})

describe("applyWinner", () => {
  it("marks exactly the given offer the winner and clears every other", () => {
    const offers = [
      { id: "1", is_winner: true },
      { id: "2", is_winner: false },
      { id: "3", is_winner: false },
    ]

    const next = applyWinner(offers, "2")

    expect(next.find((o) => o.id === "1").is_winner).toBe(false)
    expect(next.find((o) => o.id === "2").is_winner).toBe(true)
    expect(next.find((o) => o.id === "3").is_winner).toBe(false)
  })

  it("leaves at most one winner even when the input already had none", () => {
    const offers = [{ id: "1", is_winner: false }, { id: "2", is_winner: false }]
    const next = applyWinner(offers, "1")
    expect(next.filter((o) => o.is_winner)).toHaveLength(1)
  })

  it("refuses to crown an offer that isn't part of the Canvass", () => {
    const offers = [{ id: "1", is_winner: false }]
    expect(() => applyWinner(offers, "not-here")).toThrow(/isn't part of this Canvass/)
  })

  it("refuses a missing winner id", () => {
    expect(() => applyWinner([{ id: "1", is_winner: false }], null)).toThrow()
  })
})
