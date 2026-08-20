import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  formatDate,
  formatDueDate,
  formatTaskDateTime,
  getCurrentLocalDate,
  getCurrentLocalTime,
  toLocalDatetimeString,
} from "./formatDate"

/**
 * All of these render in the viewer's local zone, which the suite pins to
 * Asia/Manila (UTC+8) — the same zone the company works in. The UTC instants
 * below are chosen so the local rendering differs from the UTC one, which is
 * what makes the assertions meaningful.
 */
describe("formatDate", () => {
  it("renders a timestamp as a readable local date and time", () => {
    expect(formatDate("2026-03-05T01:30:00Z")).toBe("Mar 5, 2026, 09:30 AM")
  })

  it("rolls into the next local day for a late-evening UTC instant", () => {
    expect(formatDate("2026-03-05T17:00:00Z")).toBe("Mar 6, 2026, 01:00 AM")
  })

  it("shows N/A when there is no date", () => {
    expect(formatDate(null)).toBe("N/A")
    expect(formatDate("")).toBe("N/A")
    expect(formatDate(undefined)).toBe("N/A")
  })
})

describe("toLocalDatetimeString", () => {
  it("produces the value a datetime-local input expects", () => {
    expect(toLocalDatetimeString("2026-03-05T01:30:00Z")).toBe("2026-03-05T09:30")
  })

  it("zero-pads every component", () => {
    expect(toLocalDatetimeString("2026-01-02T00:05:00Z")).toBe("2026-01-02T08:05")
  })

  it("returns an empty string for a missing or unparseable value", () => {
    expect(toLocalDatetimeString(null)).toBe("")
    expect(toLocalDatetimeString("")).toBe("")
    expect(toLocalDatetimeString("not a date")).toBe("")
  })
})

describe("getCurrentLocalTime", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-03-05T01:30:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("reports now in the form a datetime-local input expects", () => {
    expect(getCurrentLocalTime()).toBe("2026-03-05T09:30")
  })
})

describe("getCurrentLocalDate", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("reports today's date in the local zone as YYYY-MM-DD", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-03-05T01:30:00Z"))

    expect(getCurrentLocalDate()).toBe("2026-03-05")
  })

  it("rolls into the next local day for a late-evening UTC instant", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-03-05T17:00:00Z"))

    expect(getCurrentLocalDate()).toBe("2026-03-06")
  })

  it("zero-pads the month and day", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-02T08:05:00Z"))

    expect(getCurrentLocalDate()).toBe("2026-01-02")
  })
})

describe("formatTaskDateTime", () => {
  it("renders a short day and 12-hour time", () => {
    expect(formatTaskDateTime("2026-03-05T01:30:00Z")).toBe("Mar 5, 9:30 AM")
  })

  it("omits the year, which task rows show separately", () => {
    expect(formatTaskDateTime("2026-03-05T01:30:00Z")).not.toContain("2026")
  })

  it("returns null when there is no value", () => {
    expect(formatTaskDateTime(null)).toBeNull()
    expect(formatTaskDateTime("")).toBeNull()
  })
})

describe("formatDueDate", () => {
  it("shows date only when the due time is local midnight", () => {
    // A date-only due date arrives as midnight; showing "12:00 AM" would imply
    // a precision the user never set.
    expect(formatDueDate("2026-03-04T16:00:00Z")).toBe("Mar 5, 2026")
  })

  it("shows the time when the due date carries one", () => {
    expect(formatDueDate("2026-03-05T09:00:00Z")).toBe("Mar 5, 2026, 5:00 PM")
  })

  it("returns null when there is no due date", () => {
    expect(formatDueDate(null)).toBeNull()
  })
})
