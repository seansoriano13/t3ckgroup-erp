import { describe, expect, it } from "vitest"

import { hasDraftContent } from "./templateApply.js"

describe("hasDraftContent", () => {
    it("is false for an untouched draft", () => {
        expect(hasDraftContent([], {})).toBe(false)
        expect(hasDraftContent([{ employeeId: null, taskDescription: "  ", checklist: null }], { title: "  " })).toBe(false)
    })

    it("sees header content", () => {
        expect(hasDraftContent([], { title: "Q3 close" })).toBe(true)
        expect(hasDraftContent([], { description: "Details" })).toBe(true)
        expect(hasDraftContent([], { dueDate: new Date("2026-10-01") })).toBe(true)
    })

    it("sees a member's employee or description", () => {
        expect(hasDraftContent([{ employeeId: "e1" }], {})).toBe(true)
        expect(hasDraftContent([{ taskDescription: "Replace the switch" }], {})).toBe(true)
    })

    // Regression: the checklist branch called parseChecklist without importing
    // it, so any member carrying a checklist threw a ReferenceError instead of
    // answering the question — the confirm-before-replace prompt never showed.
    it("reads a member's checklist instead of throwing", () => {
        const filled = JSON.stringify([{ id: "1", text: "Collect specs", checked: false }])
        const blank = JSON.stringify([{ id: "1", text: "   ", checked: false }])

        expect(hasDraftContent([{ checklist: filled }], {})).toBe(true)
        expect(hasDraftContent([{ checklist: blank }], {})).toBe(false)
    })
})
