import { describe, expect, it } from "vitest"

import { LOG_TASK_SELECT_STYLES, PRIORITY_OPTIONS } from "./task"
import { logTaskSelectClassNames } from "../styles/selectStyles"

/**
 * The priority vocabulary the log-task form offers. It has to line up with the
 * strings the approval queue filters on — a fourth option added here that the
 * queue does not know about would be selectable and then invisible.
 */
describe("PRIORITY_OPTIONS", () => {
    it("offers exactly low, medium and high", () => {
        expect(PRIORITY_OPTIONS.map((o) => o.value)).toEqual([
            "LOW",
            "MEDIUM",
            "HIGH",
        ])
    })

    it.each([
        ["LOW", "Low"],
        ["MEDIUM", "Medium"],
        ["HIGH", "High"],
    ])("labels %s as %s", (value, label) => {
        expect(PRIORITY_OPTIONS.find((o) => o.value === value).label).toBe(label)
    })

    it("gives every option a dot colour for the dropdown", () => {
        for (const option of PRIORITY_OPTIONS) {
            expect(option.dot).toMatch(/^bg-/)
        }
    })

    it("gives each priority its own colour", () => {
        const dots = PRIORITY_OPTIONS.map((o) => o.dot)
        expect(new Set(dots).size).toBe(dots.length)
    })

    it("stores values in upper case, the way they are written to the task row", () => {
        for (const option of PRIORITY_OPTIONS) {
            expect(option.value).toBe(option.value.toUpperCase())
        }
    })
})

describe("LOG_TASK_SELECT_STYLES", () => {
    it("re-exports the shared select styling rather than restating it", () => {
        expect(LOG_TASK_SELECT_STYLES).toBe(logTaskSelectClassNames)
    })
})
