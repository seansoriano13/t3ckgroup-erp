import { describe, expect, it } from "vitest"
import { assertNotWeekend, applyLunchDeduction, deriveLeaveHours, assertSilEligible, SIL_ELIGIBLE_STATUS } from "./leaveRules"

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
    expect(deriveLeaveHours("09:00", "13:00")).toBe(4)
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
