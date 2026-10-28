import { describe, expect, it } from "vitest"
import {
  assertNotWeekend,
  applyLunchDeduction,
  deriveLeaveHours,
  deriveUndertimeHours,
  assertSilEligible,
  SIL_ELIGIBLE_STATUS,
  computeAvailableHours,
  assertWithinAvailableBalance,
} from "./leaveRules"

describe("assertNotWeekend", () => {
  it("rejects a Saturday and a Sunday", () => {
    expect(() => assertNotWeekend("2026-03-14")).toThrow(/cannot be applied on weekends/i)
    expect(() => assertNotWeekend("2026-03-15")).toThrow(/cannot be applied on weekends/i)
  })

  it("allows a weekday", () => {
    expect(() => assertNotWeekend("2026-03-10")).not.toThrow()
  })

  it("includes the offending date when a label is given, for range callers", () => {
    expect(() => assertNotWeekend("2026-03-14", "2026-03-14")).toThrow("2026-03-14")
  })
})

describe("applyLunchDeduction", () => {
  it("leaves a window under 5 hours untouched", () => {
    expect(applyLunchDeduction(4.99)).toBe(4.99)
  })

  it("deducts 1 hour once the window reaches 5 hours", () => {
    expect(applyLunchDeduction(5)).toBe(4)
  })

  it("deducts 1 hour for a full 8-hour day", () => {
    expect(applyLunchDeduction(8)).toBe(7)
  })
})

describe("deriveLeaveHours", () => {
  it("derives net hours for a window, lunch already deducted", () => {
    expect(deriveLeaveHours("07:30", "18:00")).toBe(9.5) // 10.5-hour window minus 1 hour for lunch
  })

  it("does not deduct for a short window", () => {
    expect(deriveLeaveHours("13:00", "17:00")).toBe(4)
  })
})

describe("assertSilEligible", () => {
  it("allows a Regular employee", () => {
    expect(() => assertSilEligible(SIL_ELIGIBLE_STATUS)).not.toThrow()
  })

  it("refuses a Probationary or OJT employee", () => {
    expect(() => assertSilEligible("Probationary")).toThrow("Only Regular employees are eligible for SIL leave.")
    expect(() => assertSilEligible("OJT")).toThrow("Only Regular employees are eligible for SIL leave.")
  })
})

describe("computeAvailableHours", () => {
  it("subtracts what's already pending from the balance", () => {
    expect(computeAvailableHours(16, 4)).toBe(12)
  })

  it("treats a missing balance or pending figure as zero", () => {
    expect(computeAvailableHours(null, 4)).toBe(-4)
    expect(computeAvailableHours(16, undefined)).toBe(16)
  })
})

// Issue #106 (HR-03): the raw balance column is not enough to validate a new
// application against — nothing is deducted from it until HR approves, so an
// employee's own pending applications have to be counted too.
describe("assertWithinAvailableBalance", () => {
  it("allows a request that fits within what's available", () => {
    expect(() =>
      assertWithinAvailableBalance({ currentBalance: 16, pendingHours: 4, requestedHours: 12, leaveTypeLabel: "offset" }),
    ).not.toThrow()
  })

  it("allows a request that exactly exhausts what's available", () => {
    expect(() =>
      assertWithinAvailableBalance({ currentBalance: 4, pendingHours: 0, requestedHours: 4, leaveTypeLabel: "offset" }),
    ).not.toThrow()
  })

  it("refuses a request that would exceed the balance once pending applications are counted, naming both figures", () => {
    expect(() =>
      assertWithinAvailableBalance({ currentBalance: 4, pendingHours: 4, requestedHours: 4, leaveTypeLabel: "offset" }),
    ).toThrow("Insufficient offset hours. 4 hrs already committed to pending applications, leaving 0 hrs available.")
  })

  it("refuses even when the raw balance alone would have covered it", () => {
    // 4 hrs of balance, but 3 of it is already pending — only 1 is free.
    expect(() =>
      assertWithinAvailableBalance({ currentBalance: 4, pendingHours: 3, requestedHours: 2, leaveTypeLabel: "SIL" }),
    ).toThrow("Insufficient SIL hours. 3 hrs already committed to pending applications, leaving 1 hrs available.")
  })
})

describe("deriveUndertimeHours", () => {
  it("computes the shortfall for a Wednesday shift (07:30-18:30 scheduled, left at 16:30)", () => {
    // Scheduled: 07:30-18:30 -> 11h - 1h lunch = 10h. Actual: 07:30-16:30 -> 9h - 1h lunch = 8h.
    const hours = deriveUndertimeHours(
      { startTime: "07:30", endTime: "18:30" },
      { startTime: "07:30", endTime: "16:30" },
    )
    expect(hours).toBe(2)
  })

  it("is zero when the actual window matches the original exactly", () => {
    const hours = deriveUndertimeHours(
      { startTime: "07:30", endTime: "18:00" },
      { startTime: "07:30", endTime: "18:00" },
    )
    expect(hours).toBe(0)
  })

  it("deducts lunch independently on each side when only one window crosses the 5-hour threshold", () => {
    // Original: 07:30-13:00 -> 5.5h, crosses the threshold -> 4.5h net.
    // Actual:   07:30-12:00 -> 4.5h, under the threshold -> 4.5h net (no lunch deducted).
    const hours = deriveUndertimeHours(
      { startTime: "07:30", endTime: "13:00" },
      { startTime: "07:30", endTime: "12:00" },
    )
    expect(hours).toBe(0)
  })
})
