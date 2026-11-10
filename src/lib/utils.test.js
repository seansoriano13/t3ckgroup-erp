import { describe, expect, it } from "vitest"

import { cn } from "./utils"

/**
 * The class-name joiner every component in `src/components/ui` builds its
 * variants on. Its whole job is to let a caller's class win over a component's
 * default — a `className` prop that quietly loses to the base styles is the bug
 * this exists to prevent.
 */
describe("cn", () => {
    it("joins plain class names", () => {
        expect(cn("px-2", "py-1")).toBe("px-2 py-1")
    })

    it("drops falsy values so a conditional class can be inlined", () => {
        expect(cn("px-2", false, null, undefined, "", "py-1")).toBe("px-2 py-1")
    })

    it("takes the branches of a conditional object", () => {
        expect(cn("base", { active: true, disabled: false })).toBe("base active")
    })

    it("flattens an array of classes", () => {
        expect(cn(["px-2", "py-1"], "gap-1")).toBe("px-2 py-1 gap-1")
    })

    it("keeps the text-label size beside a text colour, and lets a later size replace it", () => {
        expect(cn("text-label font-bold", "text-muted-foreground")).toBe("text-label font-bold text-muted-foreground")
        expect(cn("text-label", "text-xs")).toBe("text-xs")
    })

    it("lets a later class override an earlier one in the same Tailwind group", () => {
        expect(cn("px-2", "px-4")).toBe("px-4")
    })

    it.each([
        ["padding", "p-2", "p-4", "p-4"],
        ["text colour", "text-red-500", "text-blue-500", "text-blue-500"],
        ["display", "block", "flex", "flex"],
        ["shadow", "shadow-sm", "shadow-xs", "shadow-xs"],
    ])("resolves a %s conflict in favour of the last one", (_group, a, b, expected) => {
        expect(cn(a, b)).toBe(expected)
    })

    it("keeps classes from groups that do not conflict", () => {
        expect(cn("px-2", "py-4")).toBe("px-2 py-4")
    })

    it("lets a caller's className beat a component default", () => {
        // The shape every ui/ component uses: cn(defaults, props.className).
        expect(cn("rounded-md bg-card", "rounded-2xl")).toBe("bg-card rounded-2xl")
    })

    it("returns an empty string when given nothing", () => {
        expect(cn()).toBe("")
        expect(cn(null, undefined, false)).toBe("")
    })
})
