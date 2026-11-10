import { describe, expect, it } from "vitest"
import {
  COMPLETENESS,
  COMPLETENESS_VALUES,
  SOURCING,
  SOURCING_VALUES,
  calculateProjectMargin,
  canSetSourcing,
  completenessForOutcome,
  countsTowardCompleteness,
  isCompleteness,
  isSourcing,
  outstandingInclusions,
  priceDelta,
  rollUpBaseCost,
  summariseCompleteness,
  sumActualCost,
  visiblePurchaseOrders,
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

  // The condition is met, just not with the thing the client named. The
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
  it("reads a buy as covering the condition", () => {
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

describe("rollUpBaseCost", () => {
  it("sums each costed inclusion's cost times its quantity", () => {
    const result = rollUpBaseCost([
      { cost_amount: 850000, quantity: 1 },
      { cost_amount: 100, quantity: 3 },
    ])

    expect(result.amount).toBe(850300)
    expect(result.costedCount).toBe(2)
    expect(result.totalCount).toBe(2)
    expect(result.isComplete).toBe(true)
  })

  it("reads as no base cost, not zero, when nothing is costed yet", () => {
    const result = rollUpBaseCost([{ cost_amount: null, quantity: 1 }])
    expect(result.amount).toBeNull()
    expect(result.isComplete).toBe(false)
  })

  it("reads as no base cost on an SOR with no Inclusions at all", () => {
    expect(rollUpBaseCost([]).amount).toBeNull()
    expect(rollUpBaseCost().amount).toBeNull()
  })

  it("reports a partial roll-up as partial, not as finished", () => {
    const result = rollUpBaseCost([
      { cost_amount: 500, quantity: 1 },
      { cost_amount: null, quantity: 1 },
    ])

    expect(result.amount).toBe(500)
    expect(result.costedCount).toBe(1)
    expect(result.totalCount).toBe(2)
    expect(result.isComplete).toBe(false)
  })

  it("defaults a missing quantity to one rather than zeroing the line out", () => {
    const result = rollUpBaseCost([{ cost_amount: 500, quantity: null }])
    expect(result.amount).toBe(500)
  })
})

describe("calculateProjectMargin", () => {
  // Worked example, government client: matches the Commission Pool's own
  // worked example (1,000,000 @ 12% VAT, 8% withholding, 1% retention) so the
  // two screens are checked against the same arithmetic.
  // 1,000,000 / 1.12 = 892,857.142857... (VAT-exclusive)
  // 892,857.142857... * 0.92 = 821,428.571428... (after withholding)
  // 821,428.571428... * 0.99 = 813,214.285714... (after retention)
  it("nets government deductions out of the candidate price before margin", () => {
    const result = calculateProjectMargin({
      candidateSalesPrice: 1_000_000,
      baseCost: 500_000,
      estimatedOpex: 50_000,
      isGovernmentClient: true,
      vatPercent: 12,
      withholdingPercent: 8,
      retentionPercent: 1,
    })

    expect(result.netRevenue).toBeCloseTo(813_214.29, 2)
    expect(result.marginAmount).toBeCloseTo(263_214.29, 2)
    expect(result.marginPercent).toBeCloseTo(32.37, 2)
  })

  it("takes the candidate price as-is for a private client — no deductions", () => {
    const result = calculateProjectMargin({
      candidateSalesPrice: 1_000_000,
      baseCost: 500_000,
      estimatedOpex: 50_000,
      isGovernmentClient: false,
    })

    expect(result.netRevenue).toBe(1_000_000)
    expect(result.marginAmount).toBe(450_000)
    expect(result.marginPercent).toBe(45)
  })

  it("reports a negative margin as a negative number and percentage, not a floor of zero", () => {
    const result = calculateProjectMargin({
      candidateSalesPrice: 100_000,
      baseCost: 90_000,
      estimatedOpex: 20_000,
      isGovernmentClient: false,
    })

    expect(result.marginAmount).toBe(-10_000)
    expect(result.marginPercent).toBe(-10)
  })

  it("treats a missing base cost or opex as zero, not as a thrown error", () => {
    const result = calculateProjectMargin({
      candidateSalesPrice: 100_000,
      isGovernmentClient: false,
    })

    expect(result.marginAmount).toBe(100_000)
  })

  it("is null, never a division error, when net revenue is nothing at all", () => {
    const result = calculateProjectMargin({ candidateSalesPrice: 0, isGovernmentClient: false })
    expect(result.marginPercent).toBeNull()
  })
})

describe("priceDelta", () => {
  it("reports how far the Odoo order price sits from the candidate price", () => {
    expect(priceDelta(900_000, 950_000)).toBe(50_000)
    expect(priceDelta(950_000, 900_000)).toBe(-50_000)
  })

  it("is null, not zero, when either side is unknown", () => {
    expect(priceDelta(null, 950_000)).toBeNull()
    expect(priceDelta(900_000, null)).toBeNull()
    expect(priceDelta(undefined, undefined)).toBeNull()
  })

  it("reports no drift at all as an honest zero", () => {
    expect(priceDelta(900_000, 900_000)).toBe(0)
  })
})

// Issue #49.
describe("visiblePurchaseOrders", () => {
  const orders = [
    { name: "P02560", amount_untaxed: 117 },
    { name: "P02561", amount_untaxed: 238 },
    { name: "P02562", amount_untaxed: 375 },
  ]

  it("returns every Odoo match when nothing has been detached", () => {
    expect(visiblePurchaseOrders(orders, [])).toEqual(orders)
  })

  it("excludes a purchase order that was detached, even though Odoo still matches it", () => {
    const visible = visiblePurchaseOrders(orders, [
      { po_number: "P02561", origin: "ODOO_ORIGIN", is_detached: true },
    ])

    expect(visible.map((o) => o.name)).toEqual(["P02560", "P02562"])
  })

  it("is unaffected by a non-detached override — a manual attach is already inside odooOrders by then", () => {
    const visible = visiblePurchaseOrders(orders, [
      { po_number: "P02560", origin: "MANUAL", is_detached: false },
    ])
    expect(visible).toEqual(orders)
  })

  it("survives being handed nothing at all", () => {
    expect(visiblePurchaseOrders()).toEqual([])
    expect(visiblePurchaseOrders(null, null)).toEqual([])
  })
})

describe("sumActualCost", () => {
  it("totals the tax-exclusive amount across every visible order", () => {
    const result = sumActualCost([
      { name: "P02560", amount_untaxed: 117 },
      { name: "P02561", amount_untaxed: 238 },
    ])
    expect(result.amount).toBe(355)
    expect(result.orderCount).toBe(2)
  })

  it("reads as no actuals yet, not as zero spend, when there is nothing to total", () => {
    expect(sumActualCost([]).amount).toBeNull()
    expect(sumActualCost().amount).toBeNull()
  })
})
