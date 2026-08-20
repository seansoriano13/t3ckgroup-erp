import { describe, expect, it } from "vitest"

import {
    formatDate,
    formatDueDate,
    formatTaskDateTime,
    getCurrentLocalTime,
    toLocalDatetimeString,
} from "./formatDate"

/**
 * Date rendering against the inputs that actually reach it.
 *
 * Every one of these functions is called with values straight off a task row,
 * where a null timestamp is normal and a malformed one is possible. Tests run
 * pinned to Asia/Manila (vitest.config.js), so the local-time assertions below
 * are the ones production sees.
 *
 * formatDate's happy path is covered in formatDate.test.js; this file is about
 * the edges — empty values, midnight, and the round trip through the
 * datetime-local input.
 */

describe("formatDate", () => {
    it.each([
        ["null", null],
        ["undefined", undefined],
        ["an empty string", ""],
    ])("shows N/A for %s", (_label, value) => {
        expect(formatDate(value)).toBe("N/A")
    })

    it("renders a Manila morning on its own day", () => {
        expect(formatDate("2026-08-20T07:00:00+08:00")).toBe("Aug 20, 2026, 07:00 AM")
    })

    it("renders a Manila evening on its own day", () => {
        expect(formatDate("2026-08-20T23:30:00+08:00")).toBe("Aug 20, 2026, 11:30 PM")
    })

    it("zero-pads the hour", () => {
        expect(formatDate("2026-08-20T09:05:00+08:00")).toBe("Aug 20, 2026, 09:05 AM")
    })
})

describe("toLocalDatetimeString", () => {
    it("produces the value a datetime-local input expects", () => {
        expect(toLocalDatetimeString("2026-08-20T15:30:00+08:00")).toBe(
            "2026-08-20T15:30",
        )
    })

    it("zero-pads every part so the input accepts it", () => {
        expect(toLocalDatetimeString("2026-03-05T09:07:00+08:00")).toBe(
            "2026-03-05T09:07",
        )
    })

    it("keeps a Manila morning on its own day", () => {
        // Formatting through UTC would move this to the 19th and silently
        // rewrite the value the moment the form was saved.
        expect(toLocalDatetimeString("2026-08-20T07:00:00+08:00")).toBe(
            "2026-08-20T07:00",
        )
    })

    it("renders midnight rather than dropping the time", () => {
        expect(toLocalDatetimeString("2026-08-20T00:00:00+08:00")).toBe(
            "2026-08-20T00:00",
        )
    })

    it.each([
        ["null", null],
        ["undefined", undefined],
        ["an empty string", ""],
        ["an unparseable date", "sometime next week"],
    ])("returns an empty string for %s so the input clears", (_label, value) => {
        expect(toLocalDatetimeString(value)).toBe("")
    })
})

describe("getCurrentLocalTime", () => {
    it("returns a value the datetime-local input accepts", () => {
        expect(getCurrentLocalTime()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    })

    it("agrees with formatting the current moment", () => {
        expect(getCurrentLocalTime()).toBe(toLocalDatetimeString(new Date().toISOString()))
    })
})

describe("formatTaskDateTime", () => {
    it("drops the year — a task list is always about the near past", () => {
        expect(formatTaskDateTime("2026-08-20T15:30:00+08:00")).toBe("Aug 20, 3:30 PM")
    })

    it("uses a 12-hour clock", () => {
        expect(formatTaskDateTime("2026-08-20T00:30:00+08:00")).toBe("Aug 20, 12:30 AM")
        expect(formatTaskDateTime("2026-08-20T12:30:00+08:00")).toBe("Aug 20, 12:30 PM")
    })

    it.each([
        ["null", null],
        ["undefined", undefined],
        ["an empty string", ""],
    ])("has nothing to render for %s", (_label, value) => {
        expect(formatTaskDateTime(value)).toBeNull()
    })
})

describe("formatDueDate", () => {
    it("shows only the date when a due date carries no time", () => {
        // A date picked with no time comes through as local midnight; showing
        // "12:00 AM" would read as a deadline nobody set.
        expect(formatDueDate("2026-08-20T00:00:00+08:00")).toBe("Aug 20, 2026")
    })

    it("shows the time when the deadline has one", () => {
        expect(formatDueDate("2026-08-20T17:00:00+08:00")).toBe(
            "Aug 20, 2026, 5:00 PM",
        )
    })

    it("shows a time one minute past midnight", () => {
        expect(formatDueDate("2026-08-20T00:01:00+08:00")).toBe(
            "Aug 20, 2026, 12:01 AM",
        )
    })

    it("keeps the year, unlike the task timestamp", () => {
        expect(formatDueDate("2026-08-20T00:00:00+08:00")).toContain("2026")
    })

    it.each([
        ["null", null],
        ["undefined", undefined],
        ["an empty string", ""],
    ])("has nothing to render for %s", (_label, value) => {
        expect(formatDueDate(value)).toBeNull()
    })
})
