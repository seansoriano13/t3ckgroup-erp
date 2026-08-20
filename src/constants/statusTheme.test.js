import { describe, expect, it } from "vitest"

import { STATUS_THEME } from "./statusTheme"
import { STATUS_THEME as STATUS_THEME_VIA_STATUS, getStatusTheme } from "./status"

/**
 * The palette lives on its own to break an import cycle between `status.js` and
 * `procurement.js` — whichever of those evaluated second used to read the
 * other's constants before they were initialised. These tests pin the property
 * that keeps the cycle broken: the palette depends on nothing, and both ends of
 * the status vocabulary still resolve through it.
 */
describe("STATUS_THEME", () => {
    it.each([
        ["GREEN", "green"],
        ["AMBER", "amber"],
        ["BLUE", "blue"],
        ["RED", "red"],
        ["VIOLET", "violet"],
        ["ORANGE", "orange"],
        ["MAUVE", "mauve"],
    ])("names %s as %s", (key, value) => {
        expect(STATUS_THEME[key]).toBe(value)
    })

    it("maps every name to a distinct colour", () => {
        const values = Object.values(STATUS_THEME)
        expect(new Set(values).size).toBe(values.length)
    })

    it("is re-exported unchanged from the status vocabulary", () => {
        expect(STATUS_THEME_VIA_STATUS).toBe(STATUS_THEME)
    })

    it("is fully initialised by the time status.js resolves a badge", () => {
        // A regression guard for the cycle: if the palette were read before it
        // initialised, this would come back undefined rather than a colour.
        expect(Object.values(STATUS_THEME)).toContain(getStatusTheme("COMPLETED"))
    })
})
