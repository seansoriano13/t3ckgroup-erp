import { describe, expect, it } from "vitest"
import {
  formatDateToYMD,
  getMonthBoundaries,
  getMonthKeysInRange,
  getQuarterBoundaries,
  getQuarterFromMonth,
  getQuarterLabel,
  getYearBoundaries,
} from "./dateUtils"

/**
 * These boundaries are fed straight into `.gte(start)` / `.lt(end)` Supabase
 * filters, so an off-by-one month silently changes which rows a report counts.
 * Tests run pinned to Asia/Manila (see vitest.config.js) because the helpers
 * mix UTC-parsed and local-constructed Dates, and that difference only shows up
 * in a zone that is not UTC.
 */
describe("getMonthBoundaries", () => {
  it("spans from the first of the month to the first of the next", () => {
    expect(getMonthBoundaries("2026-03")).toEqual({
      startDate: "2026-03-01",
      endDate: "2026-04-01",
    })
  })

  it("rolls over into the following year in December", () => {
    expect(getMonthBoundaries("2026-12")).toEqual({
      startDate: "2026-12-01",
      endDate: "2027-01-01",
    })
  })

  it("ends February on March 1 in both common and leap years", () => {
    expect(getMonthBoundaries("2026-02").endDate).toBe("2026-03-01")
    expect(getMonthBoundaries("2028-02").endDate).toBe("2028-03-01")
  })

  it("zero-pads single-digit months", () => {
    expect(getMonthBoundaries("2026-9")).toEqual({
      startDate: "2026-09-01",
      endDate: "2026-10-01",
    })
  })
})

describe("getQuarterBoundaries", () => {
  it("maps each quarter to its opening month", () => {
    expect(getQuarterBoundaries(2026, 1).startDate).toBe("2026-01-01")
    expect(getQuarterBoundaries(2026, 2).startDate).toBe("2026-04-01")
    expect(getQuarterBoundaries(2026, 3).startDate).toBe("2026-07-01")
    expect(getQuarterBoundaries(2026, 4).startDate).toBe("2026-10-01")
  })

  it("ends a quarter on the first day of the month after it", () => {
    expect(getQuarterBoundaries(2026, 1).endDate).toBe("2026-04-01")
    expect(getQuarterBoundaries(2026, 4).endDate).toBe("2027-01-01")
  })
})

describe("getYearBoundaries", () => {
  it("spans January 1 to January 1 of the next year", () => {
    expect(getYearBoundaries(2026)).toEqual({
      startDate: "2026-01-01",
      endDate: "2027-01-01",
    })
  })
})

describe("getMonthKeysInRange", () => {
  it("lists every month the range opens, excluding the end date", () => {
    expect(getMonthKeysInRange("2026-01-01", "2026-04-01")).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ])
  })

  it("returns a single key for a one-month range", () => {
    expect(getMonthKeysInRange("2026-03-01", "2026-04-01")).toEqual(["2026-03-01"])
  })

  it("crosses a year boundary", () => {
    expect(getMonthKeysInRange("2026-11-01", "2027-02-01")).toEqual([
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ])
  })

  it("covers a whole year with twelve keys", () => {
    const { startDate, endDate } = getYearBoundaries(2026)

    expect(getMonthKeysInRange(startDate, endDate)).toHaveLength(12)
  })

  it("covers a quarter with three keys", () => {
    const { startDate, endDate } = getQuarterBoundaries(2026, 2)

    expect(getMonthKeysInRange(startDate, endDate)).toEqual([
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
    ])
  })

  it("returns nothing when the range is empty", () => {
    expect(getMonthKeysInRange("2026-03-01", "2026-03-01")).toEqual([])
  })

  it("still excludes the end month when the range ends mid-month", () => {
    expect(getMonthKeysInRange("2026-01-01", "2026-03-15")).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ])
  })
})

describe("getQuarterFromMonth", () => {
  it("maps a month string to its calendar quarter", () => {
    expect(getQuarterFromMonth("2026-01")).toBe(1)
    expect(getQuarterFromMonth("2026-03")).toBe(1)
    expect(getQuarterFromMonth("2026-04")).toBe(2)
    expect(getQuarterFromMonth("2026-09")).toBe(3)
    expect(getQuarterFromMonth("2026-10")).toBe(4)
    expect(getQuarterFromMonth("2026-12")).toBe(4)
  })
})

describe("getQuarterLabel", () => {
  it("reads as Q<n> <year>", () => {
    expect(getQuarterLabel(3, 2026)).toBe("Q3 2026")
  })
})

describe("formatDateToYMD", () => {
  it("formats a local date without shifting it to UTC", () => {
    // 08:00 Manila on Mar 5 is Mar 4 in UTC — toISOString() would report the
    // wrong day, which is why this helper builds the string from local parts.
    expect(formatDateToYMD(new Date(2026, 2, 5, 8, 0, 0))).toBe("2026-03-05")
  })

  it("zero-pads single-digit months and days", () => {
    expect(formatDateToYMD(new Date(2026, 0, 9))).toBe("2026-01-09")
  })

  it("keeps the local day for a time just before midnight", () => {
    expect(formatDateToYMD(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31")
  })
})
