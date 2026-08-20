import { describe, expect, it } from "vitest"

import {
    OPPORTUNITY_STATUS_THEME,
    STATUS_THEME,
    TASK_STATUS,
    TASK_STATUS_THEME,
    getStatusColorAlpha,
    getStatusDotColor,
    getStatusTheme,
} from "./status"
import {
    PROCUREMENT_LABEL_THEME,
    PROCUREMENT_OUTCOME_THEME,
} from "./procurement"

/**
 * Badge colour resolution.
 *
 * One function answers for four separate vocabularies — task statuses, the
 * sales pipeline, procurement outcomes, and a tail of legacy strings — and it
 * is called from list views where a throw takes the whole page down. So the
 * two properties worth pinning are that every known value resolves to a real
 * colour, and that an unknown or malformed one falls back rather than throws.
 *
 * The vocabularies themselves are covered in status.test.js and
 * procurement.test.js; this file is about the resolution order between them.
 */
describe("getStatusTheme", () => {
    describe("task statuses", () => {
        it.each(Object.values(TASK_STATUS))("resolves %s", (status) => {
            expect(getStatusTheme(status)).toBe(TASK_STATUS_THEME[status])
        })

        it("reads a completed task as green", () => {
            expect(getStatusTheme(TASK_STATUS.COMPLETE)).toBe(STATUS_THEME.GREEN)
        })

        it("reads a declined task as red", () => {
            expect(getStatusTheme(TASK_STATUS.NOT_APPROVED)).toBe(STATUS_THEME.RED)
        })
    })

    describe("the sales pipeline", () => {
        it.each(Object.keys(OPPORTUNITY_STATUS_THEME))("resolves %s", (status) => {
            expect(getStatusTheme(status)).toBe(OPPORTUNITY_STATUS_THEME[status])
        })

        it("reads a won deal as green and a lost one as red", () => {
            expect(getStatusTheme("CLOSED_WON")).toBe(STATUS_THEME.GREEN)
            expect(getStatusTheme("CLOSED_LOST")).toBe(STATUS_THEME.RED)
        })
    })

    describe("procurement", () => {
        it.each(Object.keys(PROCUREMENT_OUTCOME_THEME))(
            "resolves the stored outcome %s",
            (outcome) => {
                expect(getStatusTheme(outcome)).toBe(PROCUREMENT_OUTCOME_THEME[outcome])
            },
        )

        it.each(Object.keys(PROCUREMENT_LABEL_THEME))(
            "resolves the display label %s too",
            (label) => {
                // A badge is sometimes handed the label rather than the value.
                expect(Object.values(STATUS_THEME)).toContain(getStatusTheme(label))
            },
        )
    })

    describe("legacy strings", () => {
        it.each([
            ["WON", STATUS_THEME.GREEN],
            ["DRAFT", STATUS_THEME.AMBER],
            ["REQUESTED", STATUS_THEME.AMBER],
            ["PENDING", STATUS_THEME.AMBER],
            ["SUBMITTED", STATUS_THEME.BLUE],
            ["ACTIVE", STATUS_THEME.BLUE],
            ["ASSIGNED", STATUS_THEME.BLUE],
            ["CANCELLED", STATUS_THEME.RED],
        ])("resolves %s to %s", (status, expected) => {
            expect(getStatusTheme(status)).toBe(expected)
        })
    })

    describe("input it should survive rather than resolve", () => {
        it.each([
            ["null", null],
            ["undefined", undefined],
            ["an empty string", ""],
            ["a number", 3],
            ["a boolean", true],
            ["an unknown status", "HALFWAY"],
            ["an object", {}],
        ])("falls back to neutral for %s", (_label, status) => {
            expect(getStatusTheme(status)).toBe(STATUS_THEME.MAUVE)
        })

        it.each([
            ["completed"],
            ["Completed"],
            ["cOmPlEtEd"],
        ])("is case-insensitive — %s still reads as complete", (status) => {
            expect(getStatusTheme(status)).toBe(STATUS_THEME.GREEN)
        })
    })

    it("always returns a colour from the palette", () => {
        const palette = Object.values(STATUS_THEME)
        for (const status of [
            ...Object.values(TASK_STATUS),
            ...Object.keys(OPPORTUNITY_STATUS_THEME),
            "WON",
            "PENDING",
            "who knows",
            null,
        ]) {
            expect(palette).toContain(getStatusTheme(status))
        }
    })
})

describe("getStatusDotColor", () => {
    it.each([
        [TASK_STATUS.COMPLETE, "bg-green-9"],
        [TASK_STATUS.INCOMPLETE, "bg-amber-9"],
        [TASK_STATUS.AWAITING_APPROVAL, "bg-blue-9"],
        [TASK_STATUS.NOT_APPROVED, "bg-red-9"],
        ["NEGOTIATION", "bg-violet-9"],
        ["PROJECT_DELIVERY", "bg-orange-9"],
        ["something unknown", "bg-mauve-9"],
    ])("paints %s with %s", (status, expected) => {
        expect(getStatusDotColor(status)).toContain(expected)
    })

    it("gives every dot a glow so the badge reads at a glance", () => {
        for (const status of Object.values(TASK_STATUS)) {
            expect(getStatusDotColor(status)).toMatch(/shadow-\[/)
        }
    })

    it("falls back rather than throwing on rubbish", () => {
        expect(getStatusDotColor(null)).toContain("bg-mauve-9")
        expect(getStatusDotColor(undefined)).toContain("bg-mauve-9")
    })
})

describe("getStatusColorAlpha", () => {
    it.each([
        [STATUS_THEME.GREEN, "bg-green-a7 shadow-green-5"],
        [STATUS_THEME.AMBER, "bg-amber-a7 shadow-amber-5"],
        [STATUS_THEME.BLUE, "bg-blue-a7 shadow-blue-5"],
        [STATUS_THEME.RED, "bg-red-a7 shadow-red-5"],
        [STATUS_THEME.VIOLET, "bg-violet-a7 shadow-violet-5"],
        [STATUS_THEME.ORANGE, "bg-orange-a7 shadow-orange-5"],
    ])("renders the %s theme as %s", (theme, expected) => {
        expect(getStatusColorAlpha(theme)).toBe(expected)
    })

    it("falls back to neutral for a theme it does not know", () => {
        expect(getStatusColorAlpha(STATUS_THEME.MAUVE)).toBe(
            "bg-mauve-a7 shadow-mauve-5",
        )
        expect(getStatusColorAlpha("chartreuse")).toBe("bg-mauve-a7 shadow-mauve-5")
        expect(getStatusColorAlpha(undefined)).toBe("bg-mauve-a7 shadow-mauve-5")
    })

    it("pairs every palette colour with a matching shadow", () => {
        for (const theme of Object.values(STATUS_THEME)) {
            const classes = getStatusColorAlpha(theme)
            const [bg, shadow] = classes.split(" ")
            expect(bg.replace("bg-", "").replace("-a7", "")).toBe(
                shadow.replace("shadow-", "").replace("-5", ""),
            )
        }
    })
})
