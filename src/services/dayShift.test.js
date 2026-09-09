import { describe, expect, it } from "vitest"
import { DEFAULT_DAY_SHIFT_CONFIG, getShiftForDate, isWorkingDay } from "./dayShift"

describe("getShiftForDate", () => {
  it("returns the configured start and end time for an ordinary weekday", () => {
    expect(getShiftForDate("2026-03-10")).toEqual({ startTime: "07:30", endTime: "18:00", isWorkingDay: true }) // Tuesday
  })

  it("returns Wednesday's later finish", () => {
    expect(getShiftForDate("2026-03-11")).toEqual({ startTime: "07:30", endTime: "18:30", isWorkingDay: true })
  })

  it("reports a weekend as a non-working day", () => {
    expect(getShiftForDate("2026-03-14")).toEqual({ startTime: null, endTime: null, isWorkingDay: false }) // Saturday
    expect(getShiftForDate("2026-03-15")).toEqual({ startTime: null, endTime: null, isWorkingDay: false }) // Sunday
  })

  it("reads a custom configuration rather than the defaults", () => {
    const config = DEFAULT_DAY_SHIFT_CONFIG.map((d) =>
      d.weekday === 1 ? { ...d, startTime: "08:00", endTime: "17:00" } : d,
    )
    expect(getShiftForDate("2026-03-09", config)).toEqual({ startTime: "08:00", endTime: "17:00", isWorkingDay: true }) // Monday
  })

  // The defect this whole spec exists to fix: the two removed copies disagreed
  // about how to read the date — one in local time, one in UTC — so near
  // midnight they could disagree about which weekday it even was.
  it("resolves the same weekday near midnight regardless of the caller's local offset", () => {
    // "2026-03-11" is a plain date string. `new Date(...)` parses it as UTC
    // midnight, so a caller in any timezone — ahead of or behind UTC — must
    // still see Wednesday's shift, never Tuesday's or Thursday's.
    expect(getShiftForDate("2026-03-11").endTime).toBe("18:30")
  })

  it("reports a non-working day rather than throwing for an incomplete or invalid date", () => {
    // A form field mid-edit (e.g. "2026-03-1") is not yet a valid date; the
    // old two literal copies guarded this with `isNaN(dateObj)` before
    // pre-filling, so the shared resolver has to guard it too.
    expect(getShiftForDate("")).toEqual({ startTime: null, endTime: null, isWorkingDay: false })
    expect(getShiftForDate("not-a-date")).toEqual({ startTime: null, endTime: null, isWorkingDay: false })
  })
})

describe("isWorkingDay", () => {
  it("is true for a weekday and false for a weekend", () => {
    expect(isWorkingDay("2026-03-10")).toBe(true)
    expect(isWorkingDay("2026-03-14")).toBe(false)
  })
})
